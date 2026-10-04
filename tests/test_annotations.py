from guidr.annotations import find_genes, read_genes

GFF = (
    "##gff-version 3\n"
    "chr1\tsrc\tregion\t1\t500\t.\t+\t.\tID=chr1:1..500\n"
    "chr1\tsrc\tgene\t11\t40\t.\t+\t.\tID=gene-b0001;Name=geneA;gene=geneA;locus_tag=b0001\n"
    "chr1\tsrc\tCDS\t11\t40\t.\t+\t0\tID=cds-1;Parent=gene-b0001;Name=geneA\n"
    "chr1\tsrc\tgene\t101\t160\t.\t-\t.\tID=gene-b0002;Name=geneB;locus_tag=b0002\n"
)


def write(tmp_path):
    f = tmp_path / "a.gff"
    f.write_text(GFF)
    return f


def test_only_gene_features_are_read(tmp_path):
    assert [g.name for g in read_genes(write(tmp_path))] == ["geneA", "geneB"]


def test_coordinates_become_zero_based_half_open(tmp_path):
    (g,) = find_genes(write(tmp_path), "geneA")
    # GFF says 11..40 (1-based, inclusive) -> 30 letters at [10, 40).
    assert (g.chrom, g.start, g.end, g.strand) == ("chr1", 10, 40, "+")
    assert g.end - g.start == 30


def test_lookup_is_case_insensitive_and_accepts_locus_tag(tmp_path):
    f = write(tmp_path)
    assert find_genes(f, "GENEA")[0].name == "geneA"
    assert find_genes(f, "b0002")[0].name == "geneB"


def test_unknown_gene_returns_empty(tmp_path):
    assert find_genes(write(tmp_path), "nope") == []
