Scope decisions to lock in now
Genome: E. coli K-12 (about 4.6M letters, public on NCBI), with gene annotations from the matching GFF file. It indexes in seconds, so you iterate fast. Yeast is a stretch goal.
Nuclease: the standard Cas9 setup, a 20-letter guide followed by an "NGG" motif.
Off-target definition: substitution mismatches only, up to 3 or 4. Skip insertions and deletions in v1.
Stack: Python for the brute-force oracle. A systems language you're comfortable with (Go, Rust, or C++) for the fast index. A small HTTP API. React with canvas for the viewer.
One design idea worth building around: off-target sites must sit next to the "NGG" motif, so you only need to index those sites (on both strands), which is a small fraction of all positions. That makes the index much smaller and faster, and it's a good design-doc talking point.


# Milestones
Week 0 (a few hours): setup. Repo, data download, spec, and a DECISIONS.md.

## M1, week 1: slow but correct CLI.
Parse the genome and annotations.
Enumerate candidate guides for a gene.
Brute-force scan both strands for near-matches.
Print a ranked table.
Demo: guides --gene lacZ prints results. This is your test oracle for everything after.

## M2, week 2: the fast index.
Index the motif-adjacent sites, plus a seed index for approximate lookup. With 3 allowed mismatches, split the guide into 4 pieces and at least one must match exactly.
Differential tests: thousands of random queries must match the oracle exactly.
Benchmark query latency, index size, and build time.
Stretch: an FM-index with backtracking for comparison.

## M3, week 3: scoring and API.
A simple, documented scoring rule that penalizes mismatches more heavily near the motif. Label it clearly as simplified.
Endpoints for gene search, region data, guides for a gene, and off-targets for a guide.
Add caching for region requests.

## M4, week 4: the genome viewer.
Canvas tracks: ruler, genes, and guides colored by score.
Pan and zoom, with aggregation at low zoom so you never draw thousands of marks.
Click a guide for the side panel, then jump to each off-target location.

## M5, week 5: validate and measure.
Compare your off-target results with Cas-OFFinder or CRISPOR on the same genome.
Run API latency tests and record cache hit rate and time-to-render.
Deploy and record a 60-second demo video.

## M6, week 6: buffer and polish.
README with an architecture diagram and tradeoffs.
The "How I used AI" section.
A write-up for your blog covering the index design and benchmarks.

# Cut line if you fall behind
Drop in this order: deployment, yeast, FM-index, viewer polish. After M3 you already have a solid backend project, and after M4 you have the full demo. Each milestone ends in something that runs, so you're never stuck with half-built pieces.

# Resume numbers to collect as you go
Index build time and size, versus the brute-force baseline
Median and p99 query latency for off-target search
Speedup over the oracle
Agreement with Cas-OFFinder (for example, "identical hits on N guides")
Viewer time-to-first-render and cache hit rate

# First concrete steps
Create the repo and download the E. coli genome and annotation files.
Write the one-page spec.
Write the brute-force scanner, starting with reverse-complement and coordinate tests.
