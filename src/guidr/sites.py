"""Enumerate every Cas9 target site (20-letter protospacer + NGG PAM), both strands.

Coordinates: internally 0-based, half-open [start, end), in forward-strand
coordinates, for BOTH strands. A site's window is always the 23 forward-strand
letters it occupies, whichever strand it targets.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator

from .seq import ACGT, revcomp

GUIDE_LEN = 20
PAM_LEN = 3
SITE_LEN = GUIDE_LEN + PAM_LEN


@dataclass(frozen=True)
class Site:
    chrom: str
    start: int          # 0-based start of the 23-letter window (forward coordinates)
    strand: str         # "+" or "-": which strand the guide/PAM are read from
    protospacer: str    # 20 letters, 5'->3' on the targeted strand
    pam: str            # 3 letters, 5'->3' on the targeted strand (matches NGG)

    @property
    def end(self) -> int:
        return self.start + SITE_LEN

    @property
    def location(self) -> tuple[str, int, str]:
        return (self.chrom, self.start, self.strand)


def enumerate_sites(
    chrom: str, seq: str, start: int = 0, end: int | None = None
) -> Iterator[Site]:
    """Yield every valid site whose whole 23-letter window lies inside [start, end).

    Windows containing anything other than A/C/G/T are skipped.

    Forward strand: window = protospacer(20) + PAM(3); PAM = NGG, so the last
    two letters are "GG".
    Reverse strand: the target sits on the opposite strand, so the forward text
    shows the reverse complement of (protospacer + PAM): "CCN" followed by the
    reverse-complemented protospacer. We detect it by "CC" at the window start,
    then reverse-complement the window to read protospacer and PAM 5'->3'.
    """
    if end is None:
        end = len(seq)
    first = max(start, 0)
    last = min(end, len(seq)) - SITE_LEN  # last valid window start
    for i in range(first, last + 1):
        w = seq[i : i + SITE_LEN]
        if w[21:] == "GG" and ACGT.issuperset(w):
            yield Site(chrom, i, "+", w[:GUIDE_LEN], w[GUIDE_LEN:])
        if w[:2] == "CC" and ACGT.issuperset(w):
            rc = revcomp(w)
            yield Site(chrom, i, "-", rc[:GUIDE_LEN], rc[GUIDE_LEN:])
