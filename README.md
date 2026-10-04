# GUIDR

CRISPR guide RNA design with genome-wide off-target search and (later) an interactive genome viewer.

**Status:** M1 done: brute-force oracle + CLI. M2 will add the fast index and must match the oracle exactly.

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest
```

## Get the data (E. coli K-12 MG1655, NCBI RefSeq)

```bash
cd data
curl -O https://ftp.ncbi.nlm.nih.gov/genomes/all/GCF/000/005/845/GCF_000005845.2_ASM584v2/GCF_000005845.2_ASM584v2_genomic.fna.gz
curl -O https://ftp.ncbi.nlm.nih.gov/genomes/all/GCF/000/005/845/GCF_000005845.2_ASM584v2/GCF_000005845.2_ASM584v2_genomic.gff.gz
```

(If a URL 404s, find the files via the NCBI Datasets page for assembly GCF_000005845.2.)

## Run

```bash
guidr \
  --fasta data/GCF_000005845.2_ASM584v2_genomic.fna.gz \
  --gff   data/GCF_000005845.2_ASM584v2_genomic.gff.gz \
  --gene lacZ --max-guides 25
```

Drop `--max-guides` to evaluate every candidate in the gene (slow on purpose: this is the oracle).
Output columns `0mm`..`3mm` are off-target sites with exactly that many mismatches.
