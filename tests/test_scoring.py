"""Acceptance tests for the M3 scoring rule (see DECISIONS.md).

Rule: per off-target risk r = 100 * product over mismatched positions i of (20 - i) / 21
(position 19 touches the PAM); guide risk g = sqrt(sum of r^2) (p = 2);
guide score = 10000 / (100 + g); ranking = highest score first, ties by (chrom, start, strand).
"""
import math
import random

import pytest

from guidr.offtargets import count_mismatches, find_offtargets
from guidr.ranking import ScoredGuide, rank_guides, score_guide
from guidr.scoring import guide_risk, guide_score, mismatch_positions, offtarget_risk
from guidr.seq import revcomp
from guidr.sites import GUIDE_LEN, Site, enumerate_sites

P = "GATTACAGATTACAGATTAC"  # 20 letters, no "GG"/"CC" (no stray sites in test genomes)
SPACER = "T" * 10


# ---------------------------------------------------------------- helpers
def mutate(seq, positions):
    out = list(seq)
    for p in positions:
        out[p] = "A" if out[p] != "A" else "T"
    return "".join(out)


def fwd(protospacer, pam="TGG"):
    return protospacer + pam


def build_genome(pieces):
    return SPACER + SPACER.join(pieces) + SPACER


def expected_g(positions):
    g = 100.0
    for i in positions:
        g *= (20 - i) / 21
    return g


def score_for(*off_target_pieces, k=3):
    """Build a genome with guide P plus the given off-target windows; score guide P."""
    genome = build_genome([fwd(P), *off_target_pieces])
    sites = list(enumerate_sites("c", genome))
    guide = sites[0]
    assert guide.protospacer == P
    return score_guide(guide, find_offtargets(guide, sites, k), k)


# ---------------------------------------------------------------- mismatch_positions
def test_mismatch_positions_known_values():
    assert mismatch_positions("ACGTACGT", "ACGTACGT") == ()
    assert mismatch_positions("ACGTACGT", "TCGTACGA") == (0, 7)


def test_mismatch_positions_returns_a_tuple():
    assert isinstance(mismatch_positions("AC", "AG"), tuple)


def test_mismatch_positions_rejects_different_lengths():
    with pytest.raises(ValueError):
        mismatch_positions("ACG", "AC")


def test_mismatch_positions_agrees_with_the_oracles_counter():
    rng = random.Random(5)
    for _ in range(200):
        a = "".join(rng.choice("ACGT") for _ in range(20))
        b = "".join(rng.choice("ACGT") for _ in range(20))
        assert len(mismatch_positions(a, b)) == count_mismatches(a, b, 20)


# ---------------------------------------------------------------- offtarget_risk (g)
def test_perfect_match_has_risk_100():
    assert offtarget_risk(()) == 100


def test_risk_known_values():
    assert offtarget_risk((0,)) == pytest.approx(100 * 20 / 21)
    assert offtarget_risk((19,)) == pytest.approx(100 / 21)
    assert offtarget_risk((0, 1, 2)) == pytest.approx(73.86, abs=0.01)
    assert offtarget_risk((8, 9, 10)) == pytest.approx(14.25, abs=0.01)
    assert offtarget_risk((17, 18, 19)) == pytest.approx(0.0648, abs=0.001)


def test_risk_matches_the_formula_for_random_position_sets():
    rng = random.Random(1)
    for _ in range(200):
        positions = rng.sample(range(20), rng.randint(0, 20))
        assert offtarget_risk(positions) == pytest.approx(expected_g(positions), rel=1e-9)


def test_risk_ignores_the_order_of_positions():
    assert offtarget_risk((3, 9, 15)) == pytest.approx(offtarget_risk((15, 3, 9)))


def test_adding_a_mismatch_always_lowers_risk():
    rng = random.Random(2)
    for _ in range(200):
        base = set(rng.sample(range(20), rng.randint(0, 19)))
        extra = rng.choice([i for i in range(20) if i not in base])
        assert offtarget_risk(base | {extra}) < offtarget_risk(base)


def test_moving_a_mismatch_toward_the_pam_lowers_risk():
    for i in range(19):
        assert offtarget_risk((i + 1,)) < offtarget_risk((i,))
    rng = random.Random(3)
    for _ in range(200):
        base = set(rng.sample(range(20), rng.randint(1, 10)))
        movable = [i for i in base if i < 19 and i + 1 not in base]
        if movable:
            i = rng.choice(movable)
            moved = (base - {i}) | {i + 1}
            assert offtarget_risk(moved) < offtarget_risk(base)


def test_risk_stays_in_range_even_with_every_position_mismatched():
    assert 0 < offtarget_risk(range(20)) <= 100


def test_risk_rejects_bad_positions():
    for bad in [(-1,), (20,), (3, 3)]:
        with pytest.raises(ValueError):
            offtarget_risk(bad)


# ---------------------------------------------------------------- guide_risk (G)
def test_no_off_targets_means_zero_risk():
    assert guide_risk([]) == 0


def test_single_off_target_risk_is_itself():
    assert guide_risk([40]) == pytest.approx(40)


def test_guide_risk_is_the_p2_norm():
    assert guide_risk([40, 10, 5]) == pytest.approx(math.sqrt(1725))


def test_guide_risk_lies_between_the_max_and_the_sum():
    rng = random.Random(4)
    for _ in range(200):
        risks = [rng.uniform(0.001, 100) for _ in range(rng.randint(1, 30))]
        g = guide_risk(risks)
        assert max(risks) <= g * (1 + 1e-12)
        assert g <= sum(risks) * (1 + 1e-12)


def test_adding_an_off_target_never_lowers_guide_risk():
    rng = random.Random(6)
    for _ in range(200):
        risks = [rng.uniform(0.001, 100) for _ in range(rng.randint(0, 20))]
        assert guide_risk(risks + [rng.uniform(0.001, 100)]) >= guide_risk(risks)


def test_guide_risk_ignores_order():
    assert guide_risk([40, 10, 5]) == pytest.approx(guide_risk([5, 40, 10]))


# ---------------------------------------------------------------- guide_score
def test_score_known_values():
    assert guide_score(0) == 100
    assert guide_score(100) == 50
    assert guide_score(900) == 10


def test_score_strictly_decreases_as_risk_grows():
    scores = [guide_score(g) for g in range(0, 1001, 10)]
    assert all(a > b for a, b in zip(scores, scores[1:]))


def test_score_stays_in_range():
    for g in [0, 1, 50, 1e6]:
        assert 0 < guide_score(g) <= 100


def test_score_rejects_negative_risk():
    with pytest.raises(ValueError):
        guide_score(-1)


# ---------------------------------------------------------------- score_guide (integration)
def test_guide_with_no_off_targets_scores_100():
    sg = score_for()
    assert sg.risk == 0 and sg.score == 100 and sg.profile == (0, 0, 0, 0)


def test_far_end_mismatches_are_riskier_than_pam_side_mismatches():
    far = score_for(fwd(mutate(P, [0, 1, 2])))
    near = score_for(fwd(mutate(P, [16, 17, 18])))
    assert far.profile == near.profile == (0, 0, 0, 1)
    assert far.risk == pytest.approx(expected_g([0, 1, 2]))
    assert near.risk == pytest.approx(expected_g([16, 17, 18]))
    assert far.score == pytest.approx(10000 / (100 + expected_g([0, 1, 2])))
    assert near.score > far.score  # the PAM-side off-target is the safer one


def test_reverse_strand_positions_are_read_five_to_three_on_the_targeted_strand():
    sg = score_for(revcomp(mutate(P, [19]) + "TGG"))  # mismatch at protospacer index 19, other strand
    assert sg.profile == (0, 1, 0, 0)
    assert sg.risk == pytest.approx(100 / 21)


def test_adding_an_off_target_lowers_the_score():
    one = score_for(fwd(mutate(P, [5])))
    two = score_for(fwd(mutate(P, [5])), fwd(mutate(P, [12])))
    assert two.risk > one.risk
    assert two.score < one.score


def test_profile_counts_off_targets_by_mismatch_count():
    sg = score_for(
        fwd(P, "AGG"),                 # identical copy elsewhere: 0 mismatches
        fwd(mutate(P, [3])),           # 1 mismatch
        fwd(mutate(P, [1, 8])),        # 2 mismatches
        fwd(mutate(P, [4, 15])),       # 2 mismatches
    )
    assert sg.profile == (1, 1, 2, 0)


# ---------------------------------------------------------------- rank_guides
def scored(start, score, chrom="c"):
    return ScoredGuide(Site(chrom, start, "+", P, "TGG"), (0, 0, 0, 0), 0.0, score)


def where(ranked):
    return [(g.site.chrom, g.site.start) for g in ranked]


def test_rank_puts_highest_score_first_and_breaks_ties_by_genome_position():
    guides = [scored(300, 50.0), scored(200, 90.0), scored(100, 90.0), scored(50, 70.0, "b")]
    assert where(rank_guides(guides)) == [("c", 100), ("c", 200), ("b", 50), ("c", 300)]


def test_rank_ties_across_chromosomes_use_chrom_name_then_start():
    guides = [scored(5, 80.0, "c"), scored(10, 80.0, "b"), scored(1, 80.0, "b")]
    assert where(rank_guides(guides)) == [("b", 1), ("b", 10), ("c", 5)]


def test_rank_is_deterministic_for_any_input_order():
    guides = [scored(s, sc) for s, sc in [(10, 60.0), (20, 60.0), (30, 95.0), (40, 20.0), (50, 95.0)]]
    expected = where(rank_guides(guides))
    rng = random.Random(7)
    for _ in range(20):
        shuffled = guides[:]
        rng.shuffle(shuffled)
        assert where(rank_guides(shuffled)) == expected
