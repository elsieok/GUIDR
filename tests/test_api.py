"""Acceptance tests for the GUIDR HTTP API.

The tests build the app on a tiny made-up genome (6 guide sites with known off-targets)
and compare responses against the brute-force oracle and the scoring code.

Conventions under test: coordinates in requests and responses are 1-based inclusive;
mismatch positions in responses are 1..20 with 20 touching the PAM; errors are JSON
{"error": ..., "detail": ...}; gene guides are paged (default 20, max 50, clamped).
"""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")
from fastapi.testclient import TestClient  # noqa: E402

from guidr.annotations import Gene  # noqa: E402
from guidr.api import create_app  # noqa: E402
from guidr.offtargets import find_offtargets  # noqa: E402
from guidr.ranking import rank_guides, score_guide  # noqa: E402
from guidr.scoring import mismatch_positions, offtarget_risk  # noqa: E402
from guidr.seq import revcomp  # noqa: E402
from guidr.sites import enumerate_sites  # noqa: E402

K = 3
P = "GATTACAGATTACAGATTAC"
Q = "ACGTACGTACGTACGTACGT"
SPACER = "T" * 10


def mutate(seq, positions):
    out = list(seq)
    for p in positions:
        out[p] = "A" if out[p] != "A" else "T"
    return "".join(out)


def fwd(protospacer, pam="TGG"):
    return protospacer + pam


PIECES = [
    fwd(P),                              # site 0: guide P
    fwd(mutate(P, [2])),                 # site 1: 1 mismatch from P (index 2)
    fwd(Q),                              # site 2: unrelated guide Q
    fwd(mutate(P, [17, 18])),            # site 3: 2 mismatches from P, near the PAM
    revcomp(mutate(P, [10]) + "TGG"),    # site 4: reverse strand, 1 mismatch from P (index 10)
    fwd(mutate(Q, [0, 1, 2, 3])),        # site 5: 4 mismatches from Q (beyond the limit)
]
BODY = SPACER + SPACER.join(PIECES) + SPACER      # 208 letters; piece i occupies [10 + 33 i, 33 + 33 i)
GENOME = {"c": BODY + "T" * 12000}
CHROM_LEN = len(GENOME["c"])
SITE_STARTS_1BASED = [11 + 33 * i for i in range(6)]
GENES = [Gene("geneA", "c", 0, 70, "+"), Gene("geneB", "c", 70, CHROM_LEN, "-")]
ALL_SITES = list(enumerate_sites("c", GENOME["c"]))
assert [s.start + 1 for s in ALL_SITES] == SITE_STARTS_1BASED  # fixture sanity


@pytest.fixture
def client():
    return TestClient(create_app(GENOME, GENES))


def cache_stats(client):
    return client.get("/info").json()["cache"]


def expected_ranked(gene):
    cands = list(enumerate_sites(gene.chrom, GENOME[gene.chrom], gene.start, gene.end))
    return rank_guides([score_guide(c, find_offtargets(c, ALL_SITES, K), K) for c in cands])


def check_item(item, sg):
    s = sg.site
    assert (item["chrom"], item["start"], item["end"], item["strand"]) == (s.chrom, s.start + 1, s.end, s.strand)
    assert (item["protospacer"], item["pam"]) == (s.protospacer, s.pam)
    assert item["score"] == pytest.approx(sg.score)
    assert item["risk"] == pytest.approx(sg.risk)
    assert item["profile"] == list(sg.profile)


# ---------------------------------------------------------------- /info
def test_info_reports_settings():
    c = TestClient(create_app(GENOME, GENES, max_mismatches=2))
    body = c.get("/info").json()
    assert body["max_mismatches"] == 2
    assert "1-based" in body["coordinates"]
    assert set(body["cache"]) == {"gene_guides", "other"}


def test_default_max_mismatches_is_3(client):
    assert client.get("/info").json()["max_mismatches"] == 3


def test_info_lists_chromosomes_with_lengths(client):
    assert client.get("/info").json()["chromosomes"] == [{"name": "c", "length": CHROM_LEN}]


# ---------------------------------------------------------------- /genes/{name}
def test_gene_lookup_also_matches_locus_tag_and_id():
    genes = [Gene("geneA", "c", 0, 70, "+", {"locus_tag": "b0001", "ID": "gene-b0001"})]
    c = TestClient(create_app(GENOME, genes))
    assert c.get("/genes/b0001").json()["name"] == "geneA"
    assert c.get("/genes/GENE-B0001").json()["name"] == "geneA"
    assert c.get("/genes/b9999").status_code == 404


def test_overlapping_genes_with_the_same_start_are_ordered_by_name():
    genes = [Gene("zeta", "c", 0, 70, "+"), Gene("alpha", "c", 0, 70, "-")]
    body = TestClient(create_app(GENOME, genes)).get(
        "/regions", params={"chrom": "c", "start": 1, "end": 100}).json()
    assert [g["name"] for g in body["genes"]] == ["alpha", "zeta"]
    
def test_gene_lookup_uses_one_based_inclusive_coordinates(client):
    assert client.get("/genes/geneA").json() == {"name": "geneA", "chrom": "c", "start": 1, "end": 70, "strand": "+"}
    assert client.get("/genes/geneB").json() == {"name": "geneB", "chrom": "c", "start": 71, "end": CHROM_LEN, "strand": "-"}


def test_gene_lookup_is_case_insensitive(client):
    assert client.get("/genes/GENEA").json()["name"] == "geneA"


def test_unknown_gene_is_404_with_a_json_error(client):
    r = client.get("/genes/nope")
    assert r.status_code == 404
    assert isinstance(r.json()["error"], str)


def test_ambiguous_gene_name_is_409():
    genes = [Gene("dup", "c", 0, 70, "+"), Gene("dup", "c", 70, 120, "-")]
    r = TestClient(create_app(GENOME, genes)).get("/genes/dup")
    assert r.status_code == 409


# ---------------------------------------------------------------- /genes/{name}/guides
@pytest.mark.parametrize("gene", GENES, ids=lambda g: g.name)
def test_gene_guides_match_the_oracle_and_ranking(client, gene):
    body = client.get(f"/genes/{gene.name}/guides").json()
    expected = expected_ranked(gene)
    assert body["gene"] == gene.name
    assert body["total"] == len(expected)
    assert len(body["items"]) == len(expected)
    for item, sg in zip(body["items"], expected):
        check_item(item, sg)


def test_pages_are_slices_of_one_stable_ranking(client):
    full = client.get("/genes/geneB/guides", params={"limit": 50}).json()["items"]
    page1 = client.get("/genes/geneB/guides", params={"limit": 2, "offset": 0}).json()
    page2 = client.get("/genes/geneB/guides", params={"limit": 2, "offset": 2}).json()
    assert page1["total"] == page2["total"] == len(full) == 4
    assert page1["items"] + page2["items"] == full
    assert (page2["limit"], page2["offset"]) == (2, 2)


def test_default_page_size_is_20(client):
    assert client.get("/genes/geneA/guides").json()["limit"] == 20


def test_limit_above_the_maximum_is_clamped_to_50(client):
    assert client.get("/genes/geneA/guides", params={"limit": 200}).json()["limit"] == 50


def test_offset_past_the_end_gives_an_empty_page_but_keeps_the_total(client):
    body = client.get("/genes/geneA/guides", params={"offset": 99}).json()
    assert body["items"] == [] and body["total"] == 2


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": -5}, {"offset": -1}])
def test_nonsense_paging_values_are_400(client, params):
    assert client.get("/genes/geneA/guides", params=params).status_code == 400


def test_non_integer_paging_value_is_422(client):
    assert client.get("/genes/geneA/guides", params={"limit": "abc"}).status_code == 422


def test_guides_for_unknown_gene_is_404(client):
    assert client.get("/genes/nope/guides").status_code == 404


# ---------------------------------------------------------------- /regions
def region(client, start, end, chrom="c"):
    return client.get("/regions", params={"chrom": chrom, "start": start, "end": end})


def test_small_region_returns_genes_and_unscored_guides(client):
    body = region(client, 1, 100).json()
    assert body["mode"] == "guides" and "bins" not in body
    assert [g["name"] for g in body["genes"]] == ["geneA", "geneB"]
    assert [g["start"] for g in body["guides"]] == [11, 44, 77]  # windows fully inside [1, 100]
    assert all("score" not in g for g in body["guides"])
    first = body["guides"][0]
    assert (first["chrom"], first["end"], first["strand"], first["protospacer"], first["pam"]) == ("c", 33, "+", P, "TGG")


def test_region_boundaries_are_inclusive_and_whole_windows_only(client):
    assert len(region(client, 11, 33).json()["guides"]) == 1   # exactly the first site's window
    assert region(client, 12, 33).json()["guides"] == []
    assert region(client, 11, 32).json()["guides"] == []


def test_genes_overlapping_a_region(client):
    assert [g["name"] for g in region(client, 150, 200).json()["genes"]] == ["geneB"]
    assert [g["start"] for g in region(client, 150, 200).json()["guides"]] == [176]
    far = region(client, 5000, 5100).json()
    assert [g["name"] for g in far["genes"]] == ["geneB"] and far["guides"] == []


def test_wide_region_returns_200_bins_that_tile_the_region(client):
    body = region(client, 1, 12000).json()
    assert body["mode"] == "bins" and "guides" not in body
    bins = body["bins"]
    assert len(bins) == 200
    assert bins[0]["start"] == 1 and bins[-1]["end"] == 12000
    for a, b in zip(bins, bins[1:]):
        assert b["start"] == a["end"] + 1
    assert sum(b["count"] for b in bins) == 6
    assert [b["count"] for b in bins[:4]] == [2, 2, 2, 0]   # bin width 60; site starts 11,44 | 77,110 | 143,176


def test_bins_still_tile_the_region_when_the_length_is_not_a_multiple_of_200(client):
    body = region(client, 1, 12001).json()          # width = ceil(12001 / 200) = 61
    bins = body["bins"]
    assert len(bins) <= 200
    assert bins[0]["start"] == 1 and bins[-1]["end"] == 12001
    for a, b in zip(bins, bins[1:]):
        assert b["start"] == a["end"] + 1
    assert all(b["end"] - b["start"] + 1 <= 61 for b in bins)
    assert sum(b["count"] for b in bins) == 6


def test_the_guide_to_bin_switch_happens_above_5000_letters(client):
    assert region(client, 1, 5000).json()["mode"] == "guides"
    assert region(client, 1, 5001).json()["mode"] == "bins"


@pytest.mark.parametrize("start,end", [(0, 100), (50, 49), (1, CHROM_LEN + 1)])
def test_bad_regions_are_400(client, start, end):
    r = region(client, start, end)
    assert r.status_code == 400 and isinstance(r.json()["error"], str)


def test_unknown_chromosome_is_404(client):
    assert region(client, 1, 100, chrom="zzz").status_code == 404


def test_missing_region_parameter_is_422(client):
    assert client.get("/regions", params={"chrom": "c", "start": 1}).status_code == 422


# ---------------------------------------------------------------- /guides/offtargets
def offtargets(client, start, strand="+", chrom="c"):
    return client.get("/guides/offtargets", params={"chrom": chrom, "start": start, "strand": strand})


def test_offtargets_of_the_first_guide(client):
    body = offtargets(client, 11).json()
    assert body["total"] == 3
    items = body["items"]
    assert [i["start"] for i in items] == [44, 143, 110]          # most dangerous first
    assert [i["mismatches"] for i in items] == [1, 1, 2]
    assert [i["positions"] for i in items] == [[3], [11], [18, 19]]  # 1-based; 20 touches the PAM
    assert [i["strand"] for i in items] == ["+", "-", "+"]
    assert items[0]["risk"] == pytest.approx(100 * 18 / 21)
    assert body["guide"]["start"] == 11
    assert body["guide"]["profile"] == [0, 2, 1, 0]
    assert body["guide"]["score"] == pytest.approx(
        score_guide(ALL_SITES[0], find_offtargets(ALL_SITES[0], ALL_SITES, K), K).score)


@pytest.mark.parametrize("site", ALL_SITES, ids=lambda s: f"{s.start + 1}{s.strand}")
def test_offtargets_match_the_oracle_for_every_site(client, site):
    body = offtargets(client, site.start + 1, site.strand).json()
    rows = []
    for h in find_offtargets(site, ALL_SITES, K):
        positions = mismatch_positions(site.protospacer, h.site.protospacer)
        rows.append((offtarget_risk(positions), h.site.start, h.site.strand, h.mismatches, [p + 1 for p in positions]))
    rows.sort(key=lambda r: (-r[0], "c", r[1], r[2]))
    assert body["total"] == len(rows)
    for item, (risk, start0, strand, mm, positions) in zip(body["items"], rows):
        assert (item["start"], item["strand"], item["mismatches"], item["positions"]) == (start0 + 1, strand, mm, positions)
        assert item["risk"] == pytest.approx(risk)
    assert (site.start + 1, site.strand) not in {(i["start"], i["strand"]) for i in body["items"]}


def test_a_reverse_strand_site_can_be_the_guide(client):
    body = offtargets(client, 143, "-").json()
    assert body["guide"]["strand"] == "-" and body["guide"]["protospacer"] == mutate(P, [10])


def test_offtargets_errors(client):
    assert offtargets(client, 12).status_code == 404                 # no site starts here
    assert offtargets(client, 11, chrom="zzz").status_code == 404
    assert offtargets(client, 11, strand="x").status_code == 400
    assert offtargets(client, 0).status_code == 400


# ---------------------------------------------------------------- caching through the API
def test_gene_guide_pages_share_one_cache_entry(client):
    client.get("/genes/geneA/guides", params={"limit": 1, "offset": 0})
    client.get("/genes/geneA/guides", params={"limit": 1, "offset": 1})
    s = cache_stats(client)["gene_guides"]
    assert (s["hits"], s["misses"], s["size"]) == (1, 1, 1)


def test_repeated_offtarget_requests_hit_the_cache(client):
    offtargets(client, 11)
    offtargets(client, 11)
    s = cache_stats(client)["other"]
    assert (s["hits"], s["misses"]) == (1, 1)


def test_repeated_region_requests_hit_the_cache_and_new_regions_miss(client):
    region(client, 1, 100)
    region(client, 1, 100)
    region(client, 1, 101)
    s = cache_stats(client)["other"]
    assert (s["hits"], s["misses"]) == (1, 2)


def test_other_cache_evicts_least_recently_used_entries():
    c = TestClient(create_app(GENOME, GENES, cache_size=1))
    offtargets(c, 11)
    offtargets(c, 44)
    offtargets(c, 11)   # evicted by the request in between
    s = cache_stats(c)["other"]
    assert (s["hits"], s["misses"]) == (0, 3)


def test_gene_cache_is_separate_and_has_its_own_size():
    c = TestClient(create_app(GENOME, GENES, gene_cache_size=1))
    for name in ["geneA", "geneB", "geneA"]:
        c.get(f"/genes/{name}/guides")
    s = cache_stats(c)["gene_guides"]
    assert (s["hits"], s["misses"]) == (0, 3)
    assert cache_stats(c)["other"]["misses"] == 0


def test_failed_requests_do_not_touch_the_caches(client):
    client.get("/genes/nope/guides")
    offtargets(client, 12)
    region(client, 0, 100)
    assert cache_stats(client)["gene_guides"]["misses"] == 0
    assert cache_stats(client)["other"]["misses"] == 0
