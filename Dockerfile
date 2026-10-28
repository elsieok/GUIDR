# One image that serves both the viewer and the API (one origin, no CORS).
# Build from the repository root:   docker build -t guidr .
# Run it locally:                   docker run --rm -p 8080:8080 guidr    ->  http://localhost:8080

# ---- stage 1: build the viewer (Node is only needed here, not in the final image)
FROM node:22-slim AS viewer
WORKDIR /viewer
COPY viewer/ ./
# Throw away any node_modules that came from the Mac, then install fresh for Linux and build.
RUN rm -rf node_modules dist && npm ci && npm run build

# ---- stage 2: the Python server
FROM python:3.12-slim
WORKDIR /app

# The E. coli K-12 MG1655 genome and annotation (public NCBI RefSeq files), downloaded at build time.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ARG NCBI=https://ftp.ncbi.nlm.nih.gov/genomes/all/GCF/000/005/845/GCF_000005845.2_ASM584v2
RUN mkdir data \
    && curl -fsSL -o data/genome.fna.gz "$NCBI/GCF_000005845.2_ASM584v2_genomic.fna.gz" \
    && curl -fsSL -o data/genome.gff.gz "$NCBI/GCF_000005845.2_ASM584v2_genomic.gff.gz"

COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir ".[api]"

COPY --from=viewer /viewer/dist ./static

ENV GUIDR_FASTA=data/genome.fna.gz \
    GUIDR_GFF=data/genome.gff.gz \
    GUIDR_STATIC_DIR=static \
    GUIDR_MAX_MISMATCHES=3

EXPOSE 8080
# The first start takes a few seconds: load the genome, find all sites, build the index.
CMD ["uvicorn", "--factory", "guidr.server:server_from_env", "--host", "0.0.0.0", "--port", "8080"]
