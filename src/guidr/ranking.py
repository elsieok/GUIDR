"""Placeholder ranking (replaced by a documented scoring rule in M3).

A guide's profile is how many off-targets it has at exactly 0, 1, 2, ...
mismatches. Profiles compare lexicographically, so a guide with one 1-mismatch
off-target ranks worse than a guide with many 3-mismatch off-targets: close
matches matter most.
"""
from __future__ import annotations

from dataclasses import dataclass

from .offtargets import OffTarget
from .sites import Site


@dataclass(frozen=True)
class ScoredGuide:
    site: Site
    profile: tuple[int, ...]  # profile[k] = number of off-targets with exactly k mismatches


def score_guide(
    guide: Site, offtargets: list[OffTarget], max_mismatches: int
) -> ScoredGuide:
    counts = [0] * (max_mismatches + 1)
    for hit in offtargets:
        counts[hit.mismatches] += 1
    return ScoredGuide(guide, tuple(counts))


def rank_guides(scored: list[ScoredGuide]) -> list[ScoredGuide]:
    """Best first: fewest close off-targets, then genome order for stable output."""
    return sorted(scored, key=lambda g: (g.profile, g.site.chrom, g.site.start, g.site.strand))
