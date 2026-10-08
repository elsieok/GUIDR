"""Seed index for fast off-target search (M2).

Same answers as `offtargets.find_offtargets`, much faster when many guides are
queried against the same list of sites.

Design (see DECISIONS.md):
  * With k = max_mismatches, cut every 20-letter protospacer into k + 1 pieces.
  * Pigeonhole: k mismatches can spoil at most k pieces, so any true off-target
    matches at least one piece EXACTLY.
  * One table per piece position. Key: the piece's letters. Value (a bucket):
    the sites whose protospacer has those letters at that position.
  * Build once from all sites. Then, per guide: cut it the same way, look up one
    bucket per table, merge into a set, drop the guide's own location, and verify
    each survivor with count_mismatches on the full 20 letters.
"""
from __future__ import annotations

from .offtargets import OffTarget, count_mismatches
from .sites import GUIDE_LEN, Site
from collections import defaultdict

def piece_bounds(length: int, pieces: int) -> list[tuple[int, int]]:
    """Split `length` letters into `pieces` consecutive half-open ranges [start, end).

    - The ranges cover 0..length exactly: no gaps, no overlap.
    - Sizes differ by at most 1, and the longer pieces come first.
      Example: piece_bounds(20, 6) has sizes 4, 4, 3, 3, 3, 3.
    - Raise ValueError unless 1 <= pieces <= length.

    The index and the query must use this same function, or the buckets
    won't line up with the lookups.
    """
    if pieces < 1:
        raise ValueError("Number of pieces must be at least 1")
    
    if pieces > length:
        raise ValueError("Number of pieces must be less than the length of the guide sequence being searched")

    sizes = [length // pieces] * pieces
    remainder = length % pieces
    for i in range(remainder):
        sizes[i] += 1

    bounds = []
    start = 0

    for size in sizes:
        end = start + size
        bounds.append((start, end))
        start = end

    return bounds

class SeedIndex:
  def __init__(self, sites: list[Site], max_mismatches: int) -> None:
    """Build the tables once from every site.
    - Raise ValueError if max_mismatches < 0, or if k + 1 pieces cannot fit in a GUIDE_LEN-letter guide.
    - Hint: store indices into `sites` in the buckets (small and cheap to merge), not copies of the Site objects.
    """
    if max_mismatches < 0:
        raise ValueError("max_mismatches cannot be negative.")

    if max_mismatches >= GUIDE_LEN:
        raise ValueError("max_mismatches must be less than the length of the guide sequence being searched")
    
    self.sites = sites
    self.max_mismatches = max_mismatches
    self.bounds = piece_bounds(GUIDE_LEN, max_mismatches + 1)
    self.tables = [defaultdict(list) for _ in self.bounds]

    for i, site in enumerate(self.sites):
        for table, (start, end) in zip(self.tables, self.bounds):
            table[site.protospacer[start:end]].append(i)    

  def find_candidates(self, guide: Site) -> set[int]:
      candidates: set[int] = set()
      guide_pieces = [
          guide.protospacer[start:end]
          for start, end in self.bounds
      ]
  
      for piece, table in zip(guide_pieces, self.tables):
          if piece in table:
              candidates.update(table[piece])

      return candidates
      
  def candidate_count(self, guide: Site) -> int:
    """Number of DISTINCT sites the lookups return, before verification.
    Includes the guide's own location if it is in the index. Used to measure the real candidate count against the ~2,100 estimate.
    """
    distinct_sites = self.find_candidates(guide)
    return len(distinct_sites)

  def query(self, guide: Site) -> list[OffTarget]:
      """Every site within max_mismatches of the guide (same result as the oracle).

      Steps: cut guide.protospacer into pieces -> look up one bucket per table ->
      merge into a set -> drop guide.location -> verify each survivor with
      count_mismatches(..., self.max_mismatches) -> return OffTarget objects.
      The guide may or may not be in the index. Result order does not matter.
      """
      hits = []
      for i in self.find_candidates(guide):
          site = self.sites[i]
          if site.location == guide.location:       # the guide is not its own off-target
              continue
          mm = count_mismatches(guide.protospacer, site.protospacer, self.max_mismatches)
          if mm is not None:                        # None = over the limit; 0 is a real hit
              hits.append(OffTarget(site, mm))
      return hits
