# One image that serves both the viewer and the API (one origin, no CORS).
# Build from the repository root:   docker build -t guidr .
# Run it locally:                   docker run --rm -p 8080:8080 guidr    ->  http://localhost:8080

# ---- stage 1: build the viewer (unchanged)
FROM node:22-slim AS viewer
WORKDIR /viewer
COPY guidr_ts/viewer/ ./
RUN rm -rf node_modules dist && npm ci && npm run build

# ---- stage 2: build the Rust extension into a wheel (the toolchain stays in this stage)
FROM python:3.12-slim AS wheel
RUN apt-get update && apt-get install -y --no-install-recommends curl build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"
RUN pip install --no-cache-dir maturin
WORKDIR /build
COPY guidr_cargo/ ./guidr_cargo/
COPY guidr_py/ ./guidr_py/
WORKDIR /build/guidr_py
RUN maturin build --release --out /wheels

# ---- stage 3: the Python server (no Rust in the final image)
FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ARG NCBI=https://ftp.ncbi.nlm.nih.gov/genomes/all/GCF/000/005/845/GCF_000005845.2_ASM584v2
RUN mkdir data \
 && curl -fsSL -o data/genome.fna.gz "$NCBI/GCF_000005845.2_ASM584v2_genomic.fna.gz" \
 && curl -fsSL -o data/genome.gff.gz "$NCBI/GCF_000005845.2_ASM584v2_genomic.gff.gz"

COPY --from=wheel /wheels /wheels
RUN pip install --no-cache-dir "$(ls /wheels/*.whl)[api]"

COPY --from=viewer /viewer/dist ./static

ENV GUIDR_FASTA=data/genome.fna.gz \
    GUIDR_GFF=data/genome.gff.gz \
    GUIDR_STATIC_DIR=static \
    GUIDR_MAX_MISMATCHES=3

EXPOSE 8080
# The first start takes a few seconds: load the genome, find all sites, build the index.
CMD ["uvicorn", "--factory", "guidr.server:server_from_env", "--host", "0.0.0.0", "--port", "8080"]
