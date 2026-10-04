"""Brute-force off-target search. This is the ORACLE.

It is deliberately simple and slow: compare the guide against every site in the
genome. Faster implementations (M2) must return exactly the same answers.
Substitution mismatches only (Hamming distance); no insertions/deletions in v1.
"""
from __future__ import annotations

from dataclasses import dataclass

from .sites import Site


@dataclass(frozen=True)
class OffTarget:
    site: Site
    mismatches: int


def count_mismatches(a: str, b: str, limit: int) -> int | None:
    """Hamming distance of equal-length strings, or None once it exceeds `limit`."""
    mm = 0
    for x, y in zip(a, b):
        if x != y:
            mm += 1
            if mm > limit:
                return None
    return mm


def find_offtargets(
    guide: Site, sites: list[Site], max_mismatches: int = 3
) -> list[OffTarget]:
    """Every site (both strands, NGG PAM) within `max_mismatches` of the guide.

    The guide's own location is excluded. An identical sequence elsewhere in the
    genome IS reported (0 mismatches): that is the worst kind of off-target.
    """
    hits = []
    for site in sites:
        if site.location == guide.location:
            continue
        mm = count_mismatches(guide.protospacer, site.protospacer, max_mismatches)
        if mm is not None:
            hits.append(OffTarget(site, mm))
    return hits
