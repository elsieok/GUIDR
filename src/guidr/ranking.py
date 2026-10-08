"""Guide scoring and ranking (M3). Replaces the M1 placeholder."""
from __future__ import annotations

from dataclasses import dataclass

from .offtargets import OffTarget
from .scoring import guide_risk, guide_score, mismatch_positions, offtarget_risk
from .sites import Site


@dataclass(frozen=True)
class ScoredGuide:
    site: Site
    profile: tuple[int, ...]  # profile[k] = number of off-targets with exactly k mismatches
    risk: float               # g: the guide's combined risk
    score: float              # 10000 / (100 + g); higher is safer


def score_guide(guide: Site, offtargets: list[OffTarget], max_mismatches: int) -> ScoredGuide:
    """Build a ScoredGuide from a guide and its off-targets.

    - profile: as in M1, counts of off-targets at exactly 0, 1, ..., max_mismatches mismatches.
    - For each off-target: positions = mismatch_positions(guide.protospacer, hit.site.protospacer), then g = offtarget_risk(positions).
    (A site's protospacer is already read 5'->3' on its own targeted strand, so reverse-strand sites need no special handling here.)
    - g = guide_risk(all the g values), G = guide_score(g).
    """
    risks = []
    profile_list = [0] * (max_mismatches + 1)
    for offtarget in offtargets:
        mismatch_pos = mismatch_positions(guide.protospacer, offtarget.site.protospacer)
        risks.append(offtarget_risk(mismatch_pos))
        profile_list[offtarget.mismatches] += 1
    g = guide_risk(risks)
    G = guide_score(g)
    profile = tuple(profile_list)
    scored_guide = ScoredGuide(guide, profile, g, G)
    return scored_guide

def rank_guides(scored: list[ScoredGuide]) -> list[ScoredGuide]:
    """Highest score first; ties broken by (chrom, start, strand) ascending.

    Must be deterministic: the same guides in any input order give the same output.
    """
    ordered_scored = sorted(scored, key=lambda s: (-s.score, s.site.chrom, s.site.start, s.site.strand))
    return ordered_scored
