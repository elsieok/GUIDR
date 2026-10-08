"""Scoring rule (M3). See DECISIONS.md. A simplified heuristic, not experimentally validated.

  r (per off-target risk) = 100 * product over mismatched positions i of (20 - i) / 21 position i is the 0-based index in the 20-letter protospacer read 5'->3';
  i = 19 touches the PAM, i = 0 is the far end.
  g (guide combined risk) = (sum of r ** P_NORM) ** (1 / P_NORM)
  guide score             = 10000 / (100 + g)   (0 to 100, higher is safer)
"""
from __future__ import annotations

from typing import Iterable

from .sites import GUIDE_LEN

P_NORM = 2


def mismatch_positions(a: str, b: str) -> tuple[int, ...]:
    """Ascending 0-based positions where `a` and `b` differ, as a tuple.

    Raise ValueError if the strings have different lengths.
    Used only at scoring time, on the few sites that survived verification;
    count_mismatches (the hot loop) stays unchanged.
    """
    mismatch_pos_list = []
    if len(a) != len(b):
        raise ValueError("Guide and Sequence are not the same length")
    for i in range(len(a)):
        if a[i] != b[i]:
            mismatch_pos_list.append(i)
    mismatch_pos = tuple(mismatch_pos_list)
    return mismatch_pos


def offtarget_risk(positions: Iterable[int]) -> float:
    """r: start at 100, multiply by (20 - i) / 21 for each mismatched position i.

    - No mismatches -> exactly 100.
    - Order of positions does not matter.
    - Raise ValueError for a position outside 0..GUIDE_LEN - 1, or a repeated position.
    """
    risk = 100
    positions = tuple(positions)
    if len(set(positions)) != len(positions):
        raise ValueError("Repeated positions")
    for position in positions:
        if position < 0 or position > GUIDE_LEN - 1:
            raise ValueError("Invalid position")
        risk = risk * (GUIDE_LEN - position) / (GUIDE_LEN + 1)
    return risk


def guide_risk(risks: Iterable[float]) -> float:
    """g: the P_NORM-norm of a guide's off-target risks. No off-targets -> 0."""
    g = (sum(r ** P_NORM for r in risks)) ** (1 / P_NORM)
    return g


def guide_score(g: float) -> float:
    """G = 10000 / (100 + g). Raise ValueError if g < 0."""
    if g < 0:
        raise ValueError("Guide risk cannot be negative")
    G = 10000 / (100 + g)
    return G
