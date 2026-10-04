from guidr.seq import revcomp
from guidr.sites import SITE_LEN, Site, enumerate_sites

# 20 letters, contains no "GG" and no "CC", so test genomes built from it
# contain no accidental extra sites.
P = "GATTACAGATTACAGATTAC"
assert len(P) == 20


def test_forward_strand_site():
    seq = "TTTT" + P + "TGG" + "TTTT"
    assert list(enumerate_sites("c", seq)) == [Site("c", 4, "+", P, "TGG")]


def test_reverse_strand_site():
    # The forward text shows the reverse complement of (protospacer + PAM).
    seq = "TTTT" + revcomp(P + "AGG") + "TTTT"
    assert list(enumerate_sites("c", seq)) == [Site("c", 4, "-", P, "AGG")]


def test_one_window_can_be_a_site_on_both_strands():
    w = "CC" + "A" * 19 + "GG"
    assert len(w) == SITE_LEN
    assert list(enumerate_sites("c", w)) == [
        Site("c", 0, "+", "CC" + "A" * 18, "AGG"),
        Site("c", 0, "-", "CC" + "T" * 18, "TGG"),
    ]


def test_site_window_must_lie_entirely_inside_region():
    seq = "TTTT" + P + "TGG" + "TTTT"  # the site occupies [4, 27)
    assert list(enumerate_sites("c", seq, start=5)) == []
    assert list(enumerate_sites("c", seq, end=26)) == []
    assert len(list(enumerate_sites("c", seq, start=4, end=27))) == 1


def test_windows_with_ambiguous_bases_are_skipped():
    seq = "TTTT" + P[:5] + "N" + P[6:] + "TGG" + "TTTT"
    assert list(enumerate_sites("c", seq)) == []


def test_site_end_is_half_open():
    s = next(enumerate_sites("c", "TTTT" + P + "TGG" + "TTTT"))
    assert (s.start, s.end) == (4, 27)
