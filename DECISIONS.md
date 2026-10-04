# Decisions

Short log of choices and why. Add to it as you go.

## M1

- **Oracle first.** `offtargets.find_offtargets` compares a guide against every site. It is slow
  on purpose; its job is to be obviously correct so M2's fast index can be tested against it.
- **Coordinates:** 0-based, half-open `[start, end)` everywhere internally. Conversion happens
  only at the edges: GFF input (1-based inclusive) and the printed table (1-based inclusive).
- **Both strands.** A site's window is always the 23 forward-strand letters it occupies.
  Forward: window ends in `GG`. Reverse: window starts with `CC` (reverse complement of `NGG`);
  we reverse-complement the window to read protospacer and PAM 5'->3'.
- **PAM:** `NGG` only (standard SpCas9). Real Cas9 also tolerates `NAG` weakly; out of scope for v1.
- **Mismatches:** substitutions only (Hamming distance), up to `--max-mismatches` (default 3).
  No insertions/deletions in v1.
- **Ambiguous bases:** any 23-letter window containing something other than A/C/G/T is skipped.
- **Candidate guides for a gene:** every site whose whole 23-letter window lies inside the gene's
  coordinates, on either strand, regardless of the gene's own strand.
- **Self-exclusion:** a guide's own location (chrom, start, strand) is not its own off-target.
  An identical sequence at a different location IS reported (0 mismatches).
- **Ranking is a placeholder:** lexicographic comparison of the per-mismatch-count profile
  (fewer close matches is better). Replaced by a documented scoring rule in M3.
- **Dependencies:** standard library only for the core. pytest for tests.

## Baseline (E. coli K-12 MG1655, pure-Python oracle, max 3 mismatches)

- Genome: 542,072 NGG sites (both strands)
- lacZ: 415 candidate guides
- Fixed cost (load genome + enumerate sites): ~3.2 s
- Per guide: ~406 ms
- Full lacZ run: 172 s (2:52)
- Machine: MacBook Air, Python 3.14.6

### Raw runs (lacZ, wall-clock total)

| Run | Guides | Total time | User CPU |
|-----|--------|-----------|----------|
| 1   | 1      | 3.572 s   | 3.25 s   |
| 2   | 25     | 13.327 s  | 12.83 s  |
| 3   | 415 (full gene) | 172.16 s | 171.35 s |
