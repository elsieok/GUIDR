"""GUIDR HTTP API (M3 part B), built with FastAPI.

Conventions (see DECISIONS.md):
  * Coordinates in requests AND responses are 1-based inclusive. Convert to the
    internal 0-based half-open form in ONE place at the edge: start0 = start - 1, end stays.
  * Mismatch positions in responses are 1..20 (20 touches the PAM); the code uses 0..19.
  * Errors are JSON {"error": <short text>, "detail": <anything useful>}.
    404 unknown gene / chromosome / guide site; 400 bad region, bad guide location
    or bad paging values; 409 ambiguous gene name; FastAPI itself returns 422 for
    malformed or missing parameters.
"""
from __future__ import annotations

import math
import os
from bisect import bisect_left, bisect_right

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .annotations import Gene, read_genes
from .cache import LRUCache
from .index import SeedIndex
from .ranking import rank_guides, score_guide
from .scoring import mismatch_positions, offtarget_risk
from .seq import read_fasta
from .sites import SITE_LEN, enumerate_sites

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 50
REGION_GUIDE_LIMIT = 5000   # regions up to this many letters return individual guides, wider ones return bins
N_BINS = 200
_ID_KEYS = ("Name", "gene", "locus_tag", "old_locus_tag", "ID")   # same keys as annotations.find_genes

class ApiError(Exception):
    """Raise this inside an endpoint to send a JSON error response."""

    def __init__(self, status: int, error: str, detail=None) -> None:
        self.status, self.error, self.detail = status, error, detail


def register_error_handler(app: FastAPI) -> None:
    """Call once on the app so an ApiError becomes {"error": ..., "detail": ...}."""

    @app.exception_handler(ApiError)
    async def _handle(request, exc: ApiError):
        return JSONResponse(status_code=exc.status, content={"error": exc.error, "detail": exc.detail})


def create_app(
    genome: dict[str, str],
    genes: list[Gene],
    max_mismatches: int = 3,
    gene_cache_size: int = 200,
    cache_size: int = 1000,
) -> FastAPI:
    """Build the whole app. Tests call this on a tiny made-up genome; the real server
    calls it with the real files (see app_from_env below).

    Startup work (once, inside create_app):
      1. all_sites = every site in the genome (enumerate_sites per chromosome).
      2. index = SeedIndex(all_sites, max_mismatches).
      3. Lookups you will want: a dict from site.location -> site; per chromosome,
         the sites and their sorted start positions (so a region query is two binary
         searches with bisect, not a scan).
      4. Two caches: gene_cache = LRUCache(gene_cache_size) for ranked guide lists,
         other_cache = LRUCache(cache_size) for regions and off-target answers.
      5. app = FastAPI(); register_error_handler(app).

    Endpoints (write each as a function inside create_app, decorated with @app.get):

      GET /info
        -> {"max_mismatches": int, "coordinates": "1-based, inclusive",
            "cache": {"gene_guides": gene_cache.stats(), "other": other_cache.stats()}}

      GET /genes/{name}
        -> {"name", "chrom", "start", "end", "strand"}   (start/end 1-based inclusive)
        Match like annotations.find_genes (case-insensitive on name / locus tag / ID).
        404 if none, 409 (detail = the matches) if several. Not cached.

      GET /genes/{name}/guides?limit=20&offset=0
        -> {"gene", "total", "limit", "offset",
            "items": [{"chrom", "start", "end", "strand", "protospacer", "pam", "score", "risk", "profile"}]}
        Items are the gene's candidate guides (enumerate_sites over the gene's region),
        each scored with score_guide(guide, index.query(guide), max_mismatches), ordered
        by rank_guides. limit < 1 or offset < 0 -> 400; limit > MAX_PAGE_SIZE is clamped
        (and the response reports the clamped limit). Cache the FULL ranked list in
        gene_cache under key ("gene_guides", gene.name): every page is a slice of the
        same entry, so the key must not contain limit or offset.

      GET /regions?chrom=&start=&end=
        404 unknown chromosome; 400 if start < 1, end < start or end > chromosome length.
        Sites count only if their whole 23-letter window lies inside [start, end].
        -> {"chrom", "start", "end", "genes": [gene objects overlapping the region, by start],
            "mode": "guides", "guides": [{"chrom","start","end","strand","protospacer","pam"}]}
           when end - start + 1 <= REGION_GUIDE_LIMIT (guides are UNSCORED, ordered by start), or
           "mode": "bins", "bins": [{"start", "end", "count"}]
           otherwise: width = ceil(length / N_BINS); bin i covers
           [start + i*width, min(start + (i+1)*width - 1, end)]; number of bins = ceil(length / width);
           a site counts toward the bin containing its (1-based) start. Cache in other_cache.

      GET /guides/offtargets?chrom=&start=&strand=     (start = the site's 1-based window start)
        400 if start < 1 or strand not in "+"/"-"; 404 unknown chromosome or no site there.
        -> {"guide": {site fields + "score", "risk", "profile"}, "total": n,
            "items": [{site fields + "mismatches", "positions" (1..20), "risk"}]}
        Items are index.query(guide), most dangerous first (risk r descending, ties by
        chrom/start/strand). Cache in other_cache.

    A failed request must not touch the caches.
    """
    all_sites = [s for chrom, seq in genome.items() for s in enumerate_sites(chrom, seq)]
    index = SeedIndex(all_sites, max_mismatches)
    by_location = {site.location: site for site in all_sites}
    sites_by_chrom = {chrom: [] for chrom in genome}
    for site in all_sites:
        sites_by_chrom[site.chrom].append(site)
    starts_by_chrom = {chrom: [s.start for s in sites] for chrom, sites in sites_by_chrom.items()}
    gene_cache = LRUCache(gene_cache_size)
    other_cache = LRUCache(cache_size)
    app = FastAPI()
    register_error_handler(app)

    @app.get("/info")
    def info():
        return {"max_mismatches": max_mismatches, "coordinates": "1-based, inclusive", "cache": {"gene_guides": gene_cache.stats(), "other": other_cache.stats()}}

    def gene_json(g: Gene) -> dict:
        return {"name": g.name, "chrom": g.chrom, "start": g.start + 1, "end": g.end, "strand": g.strand}

    def site_json(s) -> dict:
        return {"chrom": s.chrom, "start": s.start + 1, "end": s.end, "strand": s.strand, "protospacer": s.protospacer, "pam": s.pam}

    def scored_guide_json(sg) -> dict:
        return {**site_json(sg.site), "score": sg.score, "risk": sg.risk, "profile": list(sg.profile)}

    def find_gene(name: str) -> Gene:
        def names_of(g: Gene) -> set[str]:
            """Every name this gene answers to: its name plus its Name, gene, locus_tag, old_locus_tag, and ID values."""
            values = [g.name]
            for key in _ID_KEYS:
                values.extend(g.attributes.get(key, "").split(","))   # old_locus_tag can hold several, comma-separated
            return {v.strip().casefold() for v in values if v.strip()}

        matches = [g for g in genes if name.casefold() in names_of(g)]
        if not matches:
            raise ApiError(404, "gene not found", name)
        if len(matches) > 1:
            raise ApiError(409, "ambiguous gene name", [gene_json(g) for g in matches])
        return matches[0]

    @app.get("/genes/{name}")
    def get_gene(name: str):
        return gene_json(find_gene(name))
        
    @app.get("/genes/{name}/guides")
    def gene_guides(name: str, limit: int = DEFAULT_PAGE_SIZE, offset: int = 0):
        if limit < 1 or offset < 0:
            raise ApiError(400, "bad paging parameters", {"limit": limit, "offset": offset})
        limit = min(limit, MAX_PAGE_SIZE)
        gene = find_gene(name)
        def compute():
            guides = list(enumerate_sites(gene.chrom, genome[gene.chrom], gene.start, gene.end))
            scored_guides = list((map(lambda x: score_guide(x, index.query(x), max_mismatches), guides)))
            ranked_guides = rank_guides(scored_guides)
            return ranked_guides

        ranked = gene_cache.get_or_compute(("gene_guides", gene.name), compute)
        page = ranked[offset: offset + limit]
        return {"gene": gene.name, "total": len(ranked), "limit": limit, "offset": offset, "items": [scored_guide_json(sg) for sg in page]}

    @app.get("/regions")
    def region(chrom: str, start: int, end: int):
        if chrom not in genome:
            raise ApiError(404, "chromosome not found", chrom)
        if start < 1 or end < start or end > len(genome[chrom]):
            raise ApiError(400, "bad region", {"start": start, "end": end})

        def compute():
            lo = bisect_left(starts_by_chrom[chrom], start - 1) # index of the first start in the region
            hi = bisect_right(starts_by_chrom[chrom], end - SITE_LEN) # index of the last start in the region whose end doesn't go past the region end
            inside = sites_by_chrom[chrom][lo:hi]
            overlapping = sorted(
                (g for g in genes if g.chrom == chrom and g.start + 1 <= end and g.end >= start),
                key=lambda g: (g.start, g.name))
            result = {"chrom": chrom, "start": start, "end": end,
                      "genes": [gene_json(g) for g in overlapping]}
            length = end - start + 1
            if length <= REGION_GUIDE_LIMIT:
                result["mode"] = "guides"
                result["guides"] = [site_json(s) for s in inside]
            else:
                result["mode"] = "bins"
                width = math.ceil(length / N_BINS)
                n_bins = math.ceil(length / width)
                bins = []

                for i in range(n_bins):
                    bin_start = start + i * width
                    bin_end = min(
                        start + (i + 1) * width - 1,
                        end,
                    )

                    bin_lo = bisect_left(
                        starts_by_chrom[chrom],
                        bin_start - 1,
                        lo,
                        hi,
                    )

                    bin_hi = bisect_right(
                        starts_by_chrom[chrom],
                        bin_end - 1,
                        lo,
                        hi,
                    )

                    count = bin_hi - bin_lo

                    bins.append({
                        "start": bin_start,
                        "end": bin_end,
                        "count": count,
                    })
                result["bins"] = bins
            return result

        return other_cache.get_or_compute(("region", chrom, start, end), compute)

    @app.get("/guides/offtargets")
    def offtargets(chrom: str, start: int, strand: str):
        if start < 1:
            raise ApiError(400, "start must be at least 1", start)
        if strand not in ("+", "-"):
            raise ApiError(400, "strand must be '+' or '-'", strand)
        if chrom not in genome:
            raise ApiError(404, "chromosome not found", chrom)
        guide = by_location.get((chrom, start - 1, strand))
        if guide is None:
            raise ApiError(404, "no guide site at this location", {"chrom": chrom, "start": start, "strand": strand})

        def compute():
            hits = index.query(guide)
            rows = [] # one row per off-target
            for hit in hits:
                positions = mismatch_positions(guide.protospacer, hit.site.protospacer)
                rows.append((offtarget_risk(positions), hit, positions))
            rows.sort(key=lambda row: (-row[0], row[1].site.chrom, row[1].site.start, row[1].site.strand))
            return {
                "guide": scored_guide_json(score_guide(guide, hits, max_mismatches)),
                "total": len(rows),
                "items": [
                    {**site_json(hit.site), "mismatches": hit.mismatches,
                    "positions": [p + 1 for p in positions], "risk": risk}
                    for risk, hit, positions in rows
                ],
            }

        return other_cache.get_or_compute(("offtargets", chrom, start - 1, strand), compute)

    return app


def app_from_env() -> FastAPI:
    """Real server: GUIDR_FASTA=... GUIDR_GFF=... [GUIDR_MAX_MISMATCHES=3] \\
        uvicorn --factory guidr.api:app_from_env"""
    genome = read_fasta(os.environ["GUIDR_FASTA"])
    genes = list(read_genes(os.environ["GUIDR_GFF"]))
    return create_app(genome, genes, max_mismatches=int(os.environ.get("GUIDR_MAX_MISMATCHES", "3")))
