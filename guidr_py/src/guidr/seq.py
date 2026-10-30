"""Sequence helpers: reverse complement and FASTA reading."""
from __future__ import annotations

import gzip
from pathlib import Path

ACGT = frozenset("ACGT")
_COMPLEMENT = str.maketrans("ACGT", "TGCA")


def revcomp(seq: str) -> str:
    """Reverse complement of an uppercase ACGT string."""
    return seq.translate(_COMPLEMENT)[::-1]


def open_text(path):
    """Open a plain or .gz text file for reading."""
    path = Path(path)
    if path.suffix == ".gz":
        return gzip.open(path, "rt")
    return open(path, "rt")


def read_fasta(path) -> dict[str, str]:
    """Read a FASTA file into {record_name: UPPERCASE_SEQUENCE}.

    The record name is the first word of the header line.
    """
    parts: dict[str, list[str]] = {}
    name = None
    with open_text(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            if line.startswith(">"):
                name = line[1:].split()[0]
                if name in parts:
                    raise ValueError(f"duplicate FASTA record name: {name}")
                parts[name] = []
            else:
                if name is None:
                    raise ValueError("FASTA sequence data before first header")
                parts[name].append(line.upper())
    return {n: "".join(p) for n, p in parts.items()}
