"""Command-line interface: guidr --fasta G.fna --gff G.gff --gene lacZ"""
from __future__ import annotations

import argparse
import sys

from .annotations import find_genes
from .offtargets import find_offtargets
from .ranking import ScoredGuide, rank_guides, score_guide
from .seq import read_fasta
from .sites import enumerate_sites


def format_table(ranked: list[ScoredGuide], max_mismatches: int, top: int) -> str:
    header = ["rank", "location", "strand", "guide (5'->3')", "PAM"] + [
        f"{k}mm" for k in range(max_mismatches + 1)
    ]
    rows = [header]
    for rank, g in enumerate(ranked[:top], start=1):
        s = g.site
        # Display convention (1-based, inclusive) only at the output edge.
        loc = f"{s.chrom}:{s.start + 1}-{s.end}"
        rows.append([str(rank), loc, s.strand, s.protospacer, s.pam] + [str(c) for c in g.profile])
    widths = [max(len(r[i]) for r in rows) for i in range(len(header))]
    return "\n".join("  ".join(c.ljust(w) for c, w in zip(r, widths)).rstrip() for r in rows)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="guidr", description=__doc__)
    p.add_argument("--fasta", required=True, help="genome FASTA (.fna or .fna.gz)")
    p.add_argument("--gff", required=True, help="annotations GFF3 (.gff or .gff.gz)")
    p.add_argument("--gene", required=True, help="gene name or locus tag, e.g. lacZ")
    p.add_argument("--max-mismatches", type=int, default=3)
    p.add_argument("--top", type=int, default=20, help="rows to print")
    p.add_argument(
        "--max-guides", type=int, default=None,
        help="only evaluate the first N candidate guides (quick runs)",
    )
    args = p.parse_args(argv)

    genome = read_fasta(args.fasta)
    genes = find_genes(args.gff, args.gene)
    if not genes:
        print(f"error: gene {args.gene!r} not found in {args.gff}", file=sys.stderr)
        return 1
    if len(genes) > 1:
        where = ", ".join(f"{g.chrom}:{g.start + 1}-{g.end}" for g in genes)
        print(f"error: {args.gene!r} is ambiguous ({where})", file=sys.stderr)
        return 1
    gene = genes[0]
    if gene.chrom not in genome:
        print(f"error: {gene.chrom!r} is in the GFF but not the FASTA", file=sys.stderr)
        return 1

    candidates = list(enumerate_sites(gene.chrom, genome[gene.chrom], gene.start, gene.end))
    if args.max_guides is not None:
        candidates = candidates[: args.max_guides]
    print(
        f"gene {gene.name} ({gene.chrom}:{gene.start + 1}-{gene.end}, {gene.strand} strand): "
        f"{len(candidates)} candidate guides",
        file=sys.stderr,
    )

    all_sites = [s for chrom, seq in genome.items() for s in enumerate_sites(chrom, seq)]
    print(f"genome has {len(all_sites)} NGG sites (both strands)", file=sys.stderr)

    scored = []
    for n, guide in enumerate(candidates, start=1):
        hits = find_offtargets(guide, all_sites, args.max_mismatches)
        scored.append(score_guide(guide, hits, args.max_mismatches))
        if n % 25 == 0:
            print(f"  scanned {n}/{len(candidates)} guides", file=sys.stderr)

    print(format_table(rank_guides(scored), args.max_mismatches, args.top))
    print(
        "\nColumns = off-target sites with exactly k mismatches (NGG PAM, both strands).\n"
        "Ranking is a placeholder: fewer close matches ranks higher.",
        file=sys.stderr,
    )
    return 0
