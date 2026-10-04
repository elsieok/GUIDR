import gzip

import pytest

from guidr.seq import read_fasta, revcomp


def test_revcomp_known_value():
    assert revcomp("AACGT") == "ACGTT"


def test_revcomp_is_its_own_inverse():
    s = "GATTACAGATTACAGATTAC"
    assert revcomp(revcomp(s)) == s


def test_read_fasta_multi_record_uppercases_and_joins_lines(tmp_path):
    f = tmp_path / "g.fa"
    f.write_text(">one first record\nacgt\nACGT\n\n>two\nGGCC\n")
    assert read_fasta(f) == {"one": "ACGTACGT", "two": "GGCC"}


def test_read_fasta_gzip(tmp_path):
    f = tmp_path / "g.fa.gz"
    with gzip.open(f, "wt") as fh:
        fh.write(">c\nACGT\n")
    assert read_fasta(f) == {"c": "ACGT"}


def test_read_fasta_rejects_duplicate_names(tmp_path):
    f = tmp_path / "g.fa"
    f.write_text(">a\nAC\n>a\nGT\n")
    with pytest.raises(ValueError):
        read_fasta(f)
