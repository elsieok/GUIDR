"""Production entry point: the API under /api and the built viewer (static files) at /.

One process, one origin: the viewer's calls to /api/... reach the API without any CORS setup.

Run:  GUIDR_FASTA=... GUIDR_GFF=... [GUIDR_STATIC_DIR=viewer/dist] [GUIDR_MAX_MISMATCHES=3] \\
          uvicorn --factory guidr.server:server_from_env --host 0.0.0.0 --port 8080
"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .annotations import Gene, read_genes
from .api import create_app
from .seq import read_fasta


def create_server(
    genome: dict[str, str],
    genes: list[Gene],
    static_dir: str | Path | None = None,
    max_mismatches: int = 3,
    gene_cache_size: int = 200,
    cache_size: int = 1000,
) -> FastAPI:
    """The API mounted at /api, plus the viewer at / when `static_dir` is an existing folder."""
    root = FastAPI(title="GUIDR")
    api = create_app(genome, genes, max_mismatches, gene_cache_size, cache_size)
    root.mount("/api", api)                                   # the API keeps its own routes and error handling
    if static_dir is not None and Path(static_dir).is_dir():  # mounted last: "/" matches everything not under /api
        root.mount("/", StaticFiles(directory=str(static_dir), html=True), name="viewer")
    return root


def server_from_env() -> FastAPI:
    genome = read_fasta(os.environ["GUIDR_FASTA"])
    genes = list(read_genes(os.environ["GUIDR_GFF"]))
    return create_server(
        genome,
        genes,
        static_dir=os.environ.get("GUIDR_STATIC_DIR", "viewer/dist"),
        max_mismatches=int(os.environ.get("GUIDR_MAX_MISMATCHES", "3")),
    )
