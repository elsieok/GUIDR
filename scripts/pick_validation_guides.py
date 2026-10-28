"""Pick guides to check against CRISPOR (or Cas-OFFinder) and print everything the comparison needs.

Usage (project root, venv active):
    python scripts/pick_validation_guides.py \
        --fasta data/GCF_000005845.2_ASM584v2_genomic.fna \
        --gff   data/GCF_000005845.2_ASM584v2_genomic.gff --gene lacZ --risky 4 --clean 2

For each chosen guide it prints: the location, the guide and PAM, GUIDR's off-targets (counts per
mismatch number and their locations), and a stretch of forward-strand genome sequence to paste into the tool.
"Risky" guides are the ones with off-targets (the interesting test); "clean" guides have none.
"""
from __future__ import annotations

import argparse
import sys

from guidr.annotations import find_genes
from guidr.index import SeedIndex
from guidr.ranking import rank_guides, score_guide
from guidr.seq import read_fasta
from guidr.sites import enumerate_sites

MAX_MISMATCHES = 3
CONTEXT = 50   # letters of genome sequence kept on each side of the guide


def where(site) -> str:
    return f"{site.chrom}:{site.start + 1:,}-{site.end:,} ({site.strand})"   # 1-based inclusive, like the viewer


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--fasta", required=True)
    p.add_argument("--gff", required=True)
    p.add_argument("--gene", required=True)
    p.add_argument("--risky", type=int, default=4, help="how many guides WITH off-targets (lowest scores first)")
    p.add_argument("--clean", type=int, default=2, help="how many guides WITHOUT off-targets")
    args = p.parse_args()

    genome = read_fasta(args.fasta)
    genes = find_genes(args.gff, args.gene)
    if len(genes) != 1:
        print(f"error: expected exactly one gene named {args.gene!r}, found {len(genes)}", file=sys.stderr)
        return 1
    gene = genes[0]
    seq = genome[gene.chrom]

    candidates = list(enumerate_sites(gene.chrom, seq, gene.start, gene.end))
    all_sites = [s for chrom, q in genome.items() for s in enumerate_sites(chrom, q)]
    index = SeedIndex(all_sites, MAX_MISMATCHES)

    hits_of, scored = {}, []
    for guide in candidates:
        hits_of[guide.location] = index.query(guide)
        scored.append(score_guide(guide, hits_of[guide.location], MAX_MISMATCHES))
    ranked = rank_guides(scored)                                       # best (safest) first
    risky = list(reversed([g for g in ranked if sum(g.profile) > 0]))[: args.risky]
    clean = [g for g in ranked if sum(g.profile) == 0][: args.clean]

    total_hits = sum(sum(g.profile) for g in scored)
    print(f"{gene.name}: {len(candidates)} candidate guides, {total_hits} off-targets within {MAX_MISMATCHES} mismatches in total\n")
    number = 0
    for label, group in (("has off-targets", risky), ("no off-targets", clean)):
        for sg in group:
            number += 1
            site = sg.site
            print(f"=== Guide {number} ({label}) ===")
            print(f"Location (1-based): {where(site)}")
            print(f"Guide + PAM, 5'->3' on its own strand: {site.protospacer} {site.pam}")
            print(f"GUIDR off-targets with 0 / 1 / 2 / 3 mismatches: {' / '.join(map(str, sg.profile))}   (score {sg.score:.1f})")
            for hit in sorted(hits_of[site.location], key=lambda h: (h.mismatches, h.site.start)):
                print(f"    {hit.mismatches} mismatch(es)  {where(hit.site)}  {hit.site.protospacer} {hit.site.pam}")
            window = seq[max(0, site.start - CONTEXT): site.end + CONTEXT]
            print(f"Paste into the tool ({len(window)} letters of forward-strand sequence containing the guide):")
            print(window + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
