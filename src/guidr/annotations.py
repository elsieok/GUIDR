"""Minimal GFF3 reader: just enough to find a gene's coordinates.

GFF3 coordinates are 1-based and inclusive; we convert to 0-based half-open
right here at the file boundary so the rest of the code never sees GFF's convention.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterator
from urllib.parse import unquote

from .seq import open_text

_ID_KEYS = ("Name", "gene", "locus_tag", "old_locus_tag", "ID")


@dataclass(frozen=True)
class Gene:
    name: str
    chrom: str
    start: int      # 0-based
    end: int        # exclusive
    strand: str
    attributes: dict = field(compare=False, hash=False, default_factory=dict)


def _parse_attributes(text: str) -> dict[str, str]:
    attrs: dict[str, str] = {}
    for part in text.strip().split(";"):
        if "=" in part:
            key, value = part.split("=", 1)
            attrs[key.strip()] = unquote(value.strip())
    return attrs


def read_genes(path) -> Iterator[Gene]:
    """Yield every feature of type 'gene' in a (optionally gzipped) GFF3 file."""
    with open_text(path) as fh:
        for line in fh:
            if line.startswith("#") or not line.strip():
                continue
            cols = line.rstrip("\n").split("\t")
            if len(cols) < 9 or cols[2] != "gene":
                continue
            attrs = _parse_attributes(cols[8])
            name = (
                attrs.get("Name")
                or attrs.get("gene")
                or attrs.get("locus_tag")
                or attrs.get("ID", "?")
            )
            yield Gene(
                name=name,
                chrom=cols[0],
                start=int(cols[3]) - 1,
                end=int(cols[4]),
                strand=cols[6],
                attributes=attrs,
            )


def find_genes(path, query: str) -> list[Gene]:
    """All genes whose Name/gene/locus_tag/ID equals `query` (case-insensitive)."""
    q = query.casefold()
    found = []
    for gene in read_genes(path):
        for key in _ID_KEYS:
            value = gene.attributes.get(key, "")
            if any(v.strip().casefold() == q for v in value.split(",")):
                found.append(gene)
                break
    return found
