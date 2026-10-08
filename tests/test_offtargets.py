import random

from guidr.offtargets import count_mismatches, find_offtargets
# from guidr.ranking import rank_guides, score_guide
from guidr.seq import revcomp
from guidr.sites import enumerate_sites

P = "GATTACAGATTACAGATTAC"  # no "GG"/"CC", see test_sites.py
SPACER = "T" * 10


def mutate(seq, positions):
    """Substitute the given positions (always changes the base, only to A/T)."""
    out = list(seq)
    for p in positions:
        out[p] = "A" if out[p] != "A" else "T"
    return "".join(out)


def fwd(protospacer, pam="TGG"):
    return protospacer + pam


def rev(protospacer, pam="TGG"):
    return revcomp(protospacer + pam)


def build_genome(pieces):
    return SPACER + SPACER.join(pieces) + SPACER


def test_count_mismatches():
    assert count_mismatches("ACGT", "ACGT", 3) == 0
    assert count_mismatches("ACGT", "AGGA", 3) == 2
    assert count_mismatches("AAAA", "TTTT", 3) is None
    assert count_mismatches("AAAA", "TTTT", 4) == 4


def test_off_targets_on_both_strands_with_self_excluded():
    genome = build_genome([
        fwd(P),                         # the guide itself
        fwd(mutate(P, [0, 5])),         # 2 mismatches
        rev(mutate(P, [19])),           # 1 mismatch, reverse strand
        fwd(mutate(P, [1, 2, 3, 4, 5])),  # 5 mismatches: beyond the limit
        fwd(P, "AGG"),                  # identical copy elsewhere: 0 mismatches
    ])
    sites = list(enumerate_sites("c", genome))
    assert len(sites) == 5
    guide = sites[0]
    assert guide.protospacer == P

    hits = find_offtargets(guide, sites, max_mismatches=3)
    assert sorted(h.mismatches for h in hits) == [0, 1, 2]
    assert guide.location not in {h.site.location for h in hits}
    assert {h.site.strand for h in hits} == {"+", "-"}


def naive_hamming(a, b):
    return sum(x != y for x, y in zip(a, b))


def test_matches_naive_reference_on_random_genome():
    """Differential test: early-exit search vs. a deliberately naive full comparison."""
    rng = random.Random(1234)  # fixed seed: any failure is reproducible
    genome = "".join(rng.choice("ACGT") for _ in range(30_000))
    sites = list(enumerate_sites("c", genome))
    max_mm = 10  # loose limit so random sequence actually produces hits
    total_hits = 0
    for guide in rng.sample(sites, 8):
        expected = sorted(
            (s.start, s.strand, naive_hamming(guide.protospacer, s.protospacer))
            for s in sites
            if s.location != guide.location
            and naive_hamming(guide.protospacer, s.protospacer) <= max_mm
        )
        got = sorted(
            (h.site.start, h.site.strand, h.mismatches)
            for h in find_offtargets(guide, sites, max_mm)
        )
        assert got == expected
        total_hits += len(got)
    assert total_hits > 0  # guard against a vacuous pass

"""
def test_ranking_prefers_fewer_close_matches():
    genome = build_genome([fwd(P), fwd(mutate(P, [0]))])  # P has a 1-mismatch neighbour
    sites = list(enumerate_sites("c", genome))
    scored = [score_guide(g, find_offtargets(g, sites, 3), 3) for g in sites]
    ranked = rank_guides(scored)
    # Both guides see exactly one 1-mismatch off-target (each other), so profiles tie
    # and the order falls back to genome position.
    assert [g.profile for g in ranked] == [(0, 1, 0, 0), (0, 1, 0, 0)]
    assert ranked[0].site.start < ranked[1].site.start


def test_ranking_orders_by_profile_lexicographically():
    from guidr.ranking import ScoredGuide
    from guidr.sites import Site

    s = Site("c", 0, "+", P, "TGG")
    worse = ScoredGuide(s, (0, 1, 0, 0))    # one 1-mismatch off-target
    better = ScoredGuide(s, (0, 0, 0, 9))   # nine 3-mismatch off-targets
    assert rank_guides([worse, better])[0] is better
"""