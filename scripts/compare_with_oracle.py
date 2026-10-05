"""Compare SeedIndex against the brute-force oracle on a real gene, and time both.

Usage (from the project root, venv active):

    python scripts/compare_with_oracle.py \
        --fasta data/GCF_000005845.2_ASM584v2_genomic.fna \
        --gff   data/GCF_000005845.2_ASM584v2_genomic.gff \
        --gene lacZ --max-mismatches 3 --oracle-sample 25

The index answers EVERY candidate guide in the gene. The slow oracle checks
`--oracle-sample` evenly spaced guides (0 = all of them; about 3 minutes for lacZ).
Exits with status 1 if the index and the oracle ever disagree.
"""
from __future__ import annotations

import argparse
import sys
import time

from guidr.annotations import find_genes
from guidr.index import SeedIndex
from guidr.offtargets import find_offtargets
from guidr.seq import read_fasta
from guidr.sites import enumerate_sites


def key(hits):
    """Order-independent form of a result, including the mismatch count."""
    return sorted((h.site.chrom, h.site.start, h.site.strand, h.mismatches) for h in hits)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--fasta", required=True)
    p.add_argument("--gff", required=True)
    p.add_argument("--gene", required=True)
    p.add_argument("--max-mismatches", type=int, default=3)
    p.add_argument("--oracle-sample", type=int, default=25, help="guides to check with the oracle (0 = all)")
    args = p.parse_args()
    k = args.max_mismatches

    genome = read_fasta(args.fasta)
    genes = find_genes(args.gff, args.gene)
    if len(genes) != 1:
        print(f"error: expected exactly one gene named {args.gene!r}, found {len(genes)}", file=sys.stderr)
        return 1
    gene = genes[0]
    candidates = list(enumerate_sites(gene.chrom, genome[gene.chrom], gene.start, gene.end))
    all_sites = [s for chrom, seq in genome.items() for s in enumerate_sites(chrom, seq)]
    print(f"{gene.name}: {len(candidates)} candidate guides; genome has {len(all_sites)} sites; max mismatches {k}")

    t = time.perf_counter()
    index = SeedIndex(all_sites, k)
    build_s = time.perf_counter() - t

    t = time.perf_counter()
    index_results = [index.query(g) for g in candidates]
    index_s = time.perf_counter() - t
    avg_candidates = sum(index.candidate_count(g) for g in candidates) / len(candidates)

    if args.oracle_sample == 0 or args.oracle_sample >= len(candidates):
        chosen = list(range(len(candidates)))
    else:
        step = len(candidates) / args.oracle_sample
        chosen = sorted({int(i * step) for i in range(args.oracle_sample)})

    disagreements = 0
    t = time.perf_counter()
    for i in chosen:
        if key(index_results[i]) != key(find_offtargets(candidates[i], all_sites, k)):
            disagreements += 1
            print(f"  MISMATCH on guide {i} at {candidates[i].location}", file=sys.stderr)
    oracle_s = time.perf_counter() - t

    index_ms = 1000 * index_s / len(candidates)
    oracle_ms = 1000 * oracle_s / len(chosen)
    print()
    print(f"index build:          {build_s:8.2f} s")
    print(f"index query:          {index_ms:8.2f} ms per guide  ({len(candidates)} guides, {index_s:.2f} s total)")
    print(f"oracle:               {oracle_ms:8.1f} ms per guide  ({len(chosen)} guides checked)")
    print(f"speedup per guide:    {oracle_ms / index_ms:8.0f}x")
    print(f"avg candidates/guide: {avg_candidates:8.0f}  (oracle verifies {len(all_sites)})")
    print(f"total off-targets:    {sum(len(r) for r in index_results)}")
    print(f"disagreements:        {disagreements} of {len(chosen)} guides checked against the oracle")
    return 1 if disagreements else 0


if __name__ == "__main__":
    raise SystemExit(main())
