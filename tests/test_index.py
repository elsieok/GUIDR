"""Acceptance tests for the M2 seed index.

The oracle (find_offtargets) is the ground truth: the index must return exactly
the same off-targets, only faster. Results are compared as sorted lists of
(chrom, start, strand, mismatches), so order never matters but the mismatch
count is checked too.
"""
import random

import pytest

from guidr.index import SeedIndex, piece_bounds
from guidr.offtargets import find_offtargets
from guidr.seq import revcomp
from guidr.sites import GUIDE_LEN, Site, enumerate_sites

P = "GATTACAGATTACAGATTAC"  # 20 letters, no "GG"/"CC" (so test genomes get no stray sites)
SPACER = "T" * 10


# ---------------------------------------------------------------- helpers
def mutate(seq, positions):
    """Change the given positions to a different base (only ever to A or T)."""
    out = list(seq)
    for p in positions:
        out[p] = "A" if out[p] != "A" else "T"
    return "".join(out)


def fwd(protospacer, pam="TGG"):
    return protospacer + pam


def build_genome(pieces):
    return SPACER + SPACER.join(pieces) + SPACER


def key(hits):
    return sorted((h.site.chrom, h.site.start, h.site.strand, h.mismatches) for h in hits)


def plant(rng, protospacer, n_mismatches):
    """A copy of `protospacer` with exactly n_mismatches random substitutions."""
    out = list(protospacer)
    for p in rng.sample(range(GUIDE_LEN), n_mismatches):
        out[p] = rng.choice([c for c in "ACGT" if c != out[p]])
    return "".join(out)


# ---------------------------------------------------------------- piece_bounds
@pytest.mark.parametrize("pieces", range(1, 21))
def test_piece_bounds_cover_the_guide_exactly(pieces):
    bounds = piece_bounds(20, pieces)
    assert len(bounds) == pieces
    assert bounds[0][0] == 0 and bounds[-1][1] == 20
    for (_, end), (next_start, _) in zip(bounds, bounds[1:]):
        assert end == next_start  # no gaps, no overlap
    sizes = [b - a for a, b in bounds]
    assert min(sizes) >= 1
    assert max(sizes) - min(sizes) <= 1
    assert sizes == sorted(sizes, reverse=True)  # the extra letters go to the first pieces


def test_piece_bounds_known_values():
    assert piece_bounds(20, 1) == [(0, 20)]
    assert piece_bounds(20, 4) == [(0, 5), (5, 10), (10, 15), (15, 20)]
    assert [b - a for a, b in piece_bounds(20, 6)] == [4, 4, 3, 3, 3, 3]


def test_piece_bounds_rejects_impossible_splits():
    with pytest.raises(ValueError):
        piece_bounds(20, 0)
    with pytest.raises(ValueError):
        piece_bounds(20, 21)


def test_index_rejects_invalid_max_mismatches():
    with pytest.raises(ValueError):
        SeedIndex([], -1)
    with pytest.raises(ValueError):
        SeedIndex([], GUIDE_LEN)  # would need 21 pieces of a 20-letter guide


# ---------------------------------------------------------------- behaviour
def test_empty_index_returns_nothing():
    guide = Site("c", 0, "+", P, "TGG")
    assert SeedIndex([], 3).query(guide) == []


def test_handbuilt_genome_both_strands_and_self_exclusion():
    genome = build_genome([
        fwd(P),                             # the guide itself
        fwd(mutate(P, [0, 5])),             # 2 mismatches
        revcomp(mutate(P, [19]) + "TGG"),   # 1 mismatch, reverse strand
        fwd(mutate(P, [1, 2, 3, 4, 5])),    # 5 mismatches: beyond the limit
        fwd(P, "AGG"),                      # identical copy elsewhere: 0 mismatches
    ])
    sites = list(enumerate_sites("c", genome))
    guide = sites[0]
    hits = SeedIndex(sites, 3).query(guide)
    assert sorted(h.mismatches for h in hits) == [0, 1, 2]
    assert guide.location not in {h.site.location for h in hits}
    assert {h.site.strand for h in hits} == {"+", "-"}
    assert key(hits) == key(find_offtargets(guide, sites, 3))


def test_guide_that_is_not_in_the_index_still_works():
    genome = build_genome([fwd(P), fwd(mutate(P, [3]))])
    sites = list(enumerate_sites("c", genome))
    outsider = Site("other", 0, "+", P, "TGG")  # location not present in `sites`
    hits = SeedIndex(sites, 2).query(outsider)
    assert sorted(h.mismatches for h in hits) == [0, 1]


@pytest.mark.parametrize("k", [1, 2, 3, 4, 5])
def test_pigeonhole_worst_case_one_mismatch_per_piece(k):
    """k mismatches spread over k different pieces must still be found."""
    bounds = piece_bounds(GUIDE_LEN, k + 1)
    for spare in range(k + 1):               # the one piece left clean
        for edge in ("first", "last"):       # mismatch at the start or end of each spoiled piece
            positions = [
                (a if edge == "first" else b - 1)
                for i, (a, b) in enumerate(bounds) if i != spare
            ]
            genome = build_genome([fwd(P), fwd(mutate(P, positions))])
            sites = list(enumerate_sites("c", genome))
            hits = SeedIndex(sites, k).query(sites[0])
            assert [h.mismatches for h in hits] == [k], (k, spare, edge)


@pytest.mark.parametrize("k", [1, 2, 3, 4, 5])
def test_k_plus_one_mismatches_are_not_reported(k):
    bounds = piece_bounds(GUIDE_LEN, k + 1)
    positions = [a for a, _ in bounds]  # one mismatch in every piece = k + 1 mismatches
    genome = build_genome([fwd(P), fwd(mutate(P, positions))])
    sites = list(enumerate_sites("c", genome))
    assert SeedIndex(sites, k).query(sites[0]) == []


def test_candidate_count_measures_lookups_before_verification():
    genome = build_genome([
        fwd(P),                            # the guide (appears in every bucket it looks up)
        fwd(mutate(P, [0, 5])),            # 2 mismatches: candidate and hit
        fwd(mutate(P, [1, 2, 3, 4, 5])),   # 5 mismatches but pieces 2 and 3 clean: candidate, rejected
        fwd("ACGTACGTACGTACGTACGT"),       # shares no piece with P: never a candidate
    ])
    sites = list(enumerate_sites("c", genome))
    index = SeedIndex(sites, 3)
    guide = sites[0]
    assert len(sites) == 4
    assert index.candidate_count(guide) == 3   # distinct sites, guide itself included
    assert len(index.query(guide)) == 1


# ---------------------------------------------------------------- differential
@pytest.mark.parametrize("k", [0, 1, 2, 3, 4, 6, 10])
def test_matches_oracle_on_random_genome_with_planted_near_copies(k):
    rng = random.Random(1000 + k)  # fixed seed: failures are reproducible
    base = "".join(rng.choice("ACGT") for _ in range(20_000))
    seeds = [s.protospacer for s in rng.sample(list(enumerate_sites("c", base)), 6)]

    # For every seed, plant copies with 0, 1, ..., k+1 mismatches on random strands,
    # so there are hits exactly at the limit and just beyond it.
    planted = []
    for protospacer in seeds:
        for n in range(k + 2):
            window = plant(rng, protospacer, n) + rng.choice(["AGG", "CGG", "GGG", "TGG"])
            planted.append(window if rng.random() < 0.5 else revcomp(window))
    genome = base + "".join("TTTTT" + w for w in planted)

    sites = list(enumerate_sites("c", genome))
    index = SeedIndex(sites, k)
    seed_set = set(seeds)
    guides = [s for s in sites if s.protospacer in seed_set] + rng.sample(sites, 20)

    total_hits, hit_at_limit = 0, False
    for guide in guides:
        got = index.query(guide)
        assert key(got) == key(find_offtargets(guide, sites, k))
        total_hits += len(got)
        hit_at_limit = hit_at_limit or any(h.mismatches == k for h in got)
    assert total_hits > 0 and hit_at_limit  # guard against a vacuous pass
