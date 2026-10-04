from guidr.cli import main

P = "GATTACAGATTACAGATTAC"


def make_inputs(tmp_path):
    genome = "TTTT" + P + "TGG" + "TTTT"  # 31 letters, one forward site at [4, 27)
    fa = tmp_path / "g.fa"
    fa.write_text(f">c test genome\n{genome}\n")
    gff = tmp_path / "g.gff"
    gff.write_text(f"c\tsrc\tgene\t1\t{len(genome)}\t.\t+\t.\tID=g1;Name=toy\n")
    return fa, gff


def test_end_to_end_prints_ranked_table(tmp_path, capsys):
    fa, gff = make_inputs(tmp_path)
    rc = main(["--fasta", str(fa), "--gff", str(gff), "--gene", "toy"])
    out = capsys.readouterr().out
    assert rc == 0
    assert P in out and "TGG" in out
    assert "c:5-27" in out  # display coords are 1-based inclusive: [4, 27) -> 5..27


def test_unknown_gene_is_a_clean_error(tmp_path, capsys):
    fa, gff = make_inputs(tmp_path)
    rc = main(["--fasta", str(fa), "--gff", str(gff), "--gene", "nope"])
    assert rc == 1
    assert "not found" in capsys.readouterr().err
