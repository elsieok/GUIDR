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

M1 brte force
| Run | Guides | Total time | User CPU |
|-----|--------|-----------|----------|
| 1   | 1      | 3.572 s   | 3.25 s   |
| 2   | 25     | 13.327 s  | 12.83 s  |
| 3   | 415 (full gene) | 172.16 s | 171.35 s |

## M2 results (E. coli, SeedIndex, max 3 mismatches)

### Raw runs (lacZ, wall-clock total, `time guidr ... > /dev/null`)

| Run | Guides | Oracle total | Index total |
|-----|--------|--------------|-------------|
| 1   | 1      | 3.572 s      | 3.551 s     |
| 2   | 25     | 13.327 s     | 3.473 s     |
| 3   | 415    | 172.16 s     | 5.092 s     |

lacZ: 415 candidate guides; genome has 542072 sites; max mismatches 3

index build:              0.57 s
index query:              3.59 ms per guide  (415 guides, 1.49 s total)
oracle:                  408.9 ms per guide  (25 guides checked)
speedup per guide:         114x
avg candidates/guide:     2820  (oracle verifies 542072)
total off-targets:    23
disagreements:        0 of 25 guides checked against the oracle

lacZ: 415 candidate guides; genome has 542072 sites; max mismatches 3

index build:              0.57 s
index query:              3.58 ms per guide  (415 guides, 1.48 s total)
oracle:                  410.1 ms per guide  (415 guides checked)
speedup per guide:         115x
avg candidates/guide:     2820  (oracle verifies 542072)
total off-targets:    23
disagreements:        0 of 415 guides checked against the oracle

### Derived
- Per guide: ~4.2 ms (from runs 2 and 3) vs ~406 ms oracle, about 98x faster
- Full lacZ run: 172 s -> 5.1 s (about 34x). Remaining time is mostly fixed cost (~3.4 s: load genome, enumerate sites, build index)
- From compare_with_oracle.py: index build ___ s, avg candidates/guide ___ (estimate 2,116), disagreements: 0
- Run-to-run noise is about 0.1 s, so single runs of a few ms are not reliable
- Note: the index has about 2 million entries


## M2 Preparation Questions:
1. The pigeonhole guarantee. A guide has 20 letters and may differ from an off-target in up to 3. If you split it into 4 pieces of 5, why must at least one piece match exactly? Write the argument in one or two sentences.
There will be at least one piece with no mismatches because the errors can only appear in at most 3 out of 4 of the pieces.

2. What the index maps. What are the keys and values? One table per piece position, or one shared table? What does each entry point to?

The piece is the key, and the bucket is the value
One table per piece position

Take a 4-letter guide ACGT, allow 1 mismatch, so split it into 2 pieces: AC and GT. Here are five sites (s3 is the guide itself):
s0 ACGA    s1 TCGT    s2 GGCC    s3 ACGT    s4 TTTT
Build, once, before any guide exists. Make one table per piece position, from every site:
table 0 (letters 0-1):  AC -> [s0, s3]   TC -> [s1]   GG -> [s2]   TT -> [s4]
table 1 (letters 2-3):  GA -> [s0]   GT -> [s1, s3]   CC -> [s2]   TT -> [s4]
Query for guide ACGT:
Look up AC in table 0, giving [s0, s3]. Look up GT in table 1, giving [s1, s3].
Merge into a set: {s0, s1, s3}. A set removes duplicates, so s3 is only checked once.
Skip s3, because it's the guide's own location.
Verify the rest with count_mismatches: s0 has 1 mismatch (keep), s1 has 1 (keep).
s2 and s4 were never touched, which is where the speedup comes from.


3. Odd splits. 20 letters divides evenly into 4 pieces, but --max-mismatches 5 needs 6 pieces. How do you split then?
20 divides by 4 nicely but if it was something like 6 then it could be number of letters mod m pieces and we add one letter to a piece for every integer remainder so it could be someting like 4 4 3 3 3 3. the index and the query must use the same split, or the buckets won't line up with the lookups

4. Query steps. Given a guide, list what happens: split, look up, collect candidates, then what? How do you avoid checking the same site twice, and where does the self-exclusion go?
Split the guide into max_mismatches + 1 pieces.
For each piece, look up its bucket in the table for that position.
Merge the buckets into a set of sites (identified by location or index, not by sequence).
Remove the guide's own location from the set.
For each remaining site, call count_mismatches on the whole protospacer, and keep the site as an OffTarget if it's within the limit.
Self-exclusion is by location, the same rule as the oracle. An identical sequence at a different location must still be returned as a 0-mismatch hit, and it will be, because it shares every bucket with the guide.


5. Cost estimate. There are 4^5 = 1,024 possible 5-letter keys and 542,072 sites (possible windows are valid sites, meaning a 20-letter protospacer with an NGG next to it, counting both strands). About how many candidates will one guide's lookups return? How does that compare to the 542,072 you check now?
in a real life example, there are 542072 difference places that could be a match (20 base long sequences followed by an NGG). then we split each site in 4 groups of 5-letters and split the guide as well into pieces.

we then have four tables, one for each piece position in the sites ([0:5], [5:10], [10:15], [15:20]) and we put at most 1024 (4^5=1,024) 5-letter possible sequences at position [0:5] into table 1, at most 1024 possible 5-letter sequences at position [5:10] into table 2, etc (some combinations may not appear in a position) and each possible combination is a bucket.

after that we then say If there are total 542072 total pieces at position [0:5] of the site, each possibility on average will appear 529 times (542072/1024=529.367). kind of like if I had 20 bags with 2 balls each and there are 2 possible colours of balls. there are total 4 combinations of colours the two balls can be and so on average each combination on colours must appear about 5 times across the 20 bags.

This means that for each piece of the guide I will search the table that represents the same position. I will the find the one out of the maximum 1024 combinations of the site piece which matches the guide piece if it exists (and it will since the guide itself also appears and we have to skip that one) which also reveals which of the 542072 sites that piece is present (in that position) which is again on average in total 529. That means on average I will have to verify only 2116 (4*529) possible site candidates instead of the whole 542072.

256 (542072/2116 =256.178) times less candidates are verified with indexing vs brute force alone

6. Interface. What does the new code look like from the outside? For example, something that is built once from all_sites, then answers query(guide, max_mismatches). Keep cli.py changes small.
The outside of a piece of code is how the rest of the program uses it: what you call, what you give it, and what you get back. It now has to build the tables (index) first once before searching for whatever (given your searching the same genome).

Build (once per run): index = SeedIndex(all_sites, max_mismatches). Input: the list of every Site in the genome, plus the mismatch limit. Output: an index object holding the tables.
Query (once per guide): hits = index.query(guide). Input: one Site. Output: a list[OffTarget], the same type find_offtargets returns, in no guaranteed order.
Measurement hook: index.candidate_count(guide) returns how many distinct sites the lookups produced, so I can measure the real candidate count against the ~2,116 estimate.
Changes in cli.py: two lines. Build the index after all_sites exists, and replace find_offtargets(guide, all_sites, args.max_mismatches) with index.query(guide). Scoring, ranking, and printing don't change.
Why max_mismatches goes in the constructor, not query: it sets the number of pieces (k + 1), which decides where every site is cut when the tables are built. A different limit means different cuts, so it needs a different index.
Why this interface: the return type matches the oracle's, so the index is a drop-in replacement and the tests can compare the two directly.


7. Testing. What exactly will you compare against the oracle, and on what inputs?
I would test the faster indexed version with the oracle and the same inputs, but I will use a set to ensure I don't get any false negatives due to a difference in order

8. What is the seed trade off? Say we wanted 4 mismatches instead of 3? 
There would be 256 (4^4) total possible combinations. That would mean on average each combination would appear about 2117 (542072/256) times. Then around 10587 (2117*5 tables) candidates would have to be verified. 542072/8469 is only 51 times less candidates


## M3 Design Questions
Part A: scoring rule (replaces the placeholder in ranking.py)

1. Take two guides that each have exactly one off-target with 3 mismatches:
Guide A: all 3 mismatches are in the PAM-side 12 letters.
Guide B: all 3 mismatches are at the far end.
The current ranking treats them as identical.
Which guide is safer, and why? Answer in your own words, plus one sentence on how a scoring rule should treat the two.

Guide A is safer since cas9 is less likely to accidentally cut when mismatched occur near the PAM. A scoring rule should show that both have danger of being cut, ut guide A has less chance than guide B.

2. Should mismatch position matter? In real Cas9, mismatches near the PAM (the last roughly 10 to 12 letters of the protospacer) are generally tolerated less than distal ones. Using positions means off-target results need to carry which positions mismatched (count_mismatches currently returns only a count).

Yes, it makes it more realistic. Perhaps a change would be that the count_mismatches returns a tuple (to avoid potential accidental changes to the data) of the indices where the mismatch occurs instead of the count

** Don't change what count_mismatches returns:
It runs about 2,800 times per guide in the hot loop and exits early on rejected sites. Building tuples there would slow the index you just sped up.
The index and 44 tests depend on it returning a count or None.
Positions are only needed for the few sites that survive verification, such as the 23 off-targets across all of lacZ. Add a separate function used only at scoring time

3. How do all of a guide's off-targets combine into one score or ordering (for example a sum of per-off-target penalties mapped to 0 to 100), and how are ties broken?

g = (∑_(i=1)^n (r_i)^p)^(1/p) higher p penalises high individual off targets, lower p penalises multiple off targets. can test different ones to find best compromise.
Ties are broken with place on the actual genome

4. Which ordering rules must always hold (for example a 0-mismatch off-target must outrank any number of 3-mismatch ones)? These become property tests.

A perfect match scores the maximum.
Adding a mismatch never raises an off-target's risk.
Moving a mismatch toward the PAM never raises it.
Adding an off-target never improves a guide's score.
Scores stay within 0 to 100, and results are deterministic.

5. State the limits plainly: simplified rule, not experimentally validated; NGG only; substitutions only; no on-target efficiency model. No ML.

Since we have no real data from experiments of how cas9 deals with mismatches to create ML models, we'll just a simple, transparent heuristic that ranks sites. Once this project is finished, I will read some papers to potentially provide some experimental data that can be used to create a more accurate grading system as a next step. NGG only, substitutions only (no bulges or indels), no on-target efficiency, tested on one genome, and scores are relative rankings, not probabilities, so a risk of 40 does not mean a 40% chance of cutting.

Part B: HTTP API
* The server builds the index once at startup and keeps it in memory. This is where M2 pays off: about 4 ms per guide, versus about 3.4 s of fixed cost for each CLI run.
* Endpoints to design: gene search; region data (genes and guides in [start, end) for the viewer, at a zoom level); guides for a gene (scored and ranked); off-targets for one guide.
* Decide: JSON response shapes, pagination and limits, error handling, and the coordinate convention exposed at the API edge (internal is 0-based half-open; document what the API returns).
* Caching: LRU for region and guide requests; record the cache hit rate.
Framework is an open choice (for example FastAPI or Flask); test with the framework's test client.
Measure: p50 and p99 latency per endpoint, throughput, cache hit rate (resume numbers).

1. What does the viewer need from the server? List each endpoint with its URL, inputs, and what it returns. Think of four: look up a gene, get the features and guides in a genomic region, get a gene's ranked guides, and get one guide's off-targets.

Look up a gene: @app.get("/genes/{name}")
  input: name
  output: name, chrom, start, end, and strand
Get the features and guides in a genomic region: @app.get("/regions?chrom=&start=&end=")
  input: chrom, start, end
  output: genes overlapping the region, plus guides. Genomic sites occur about once every 8 letters, so a 100 kb region holds roughly 12,000 of them, which is far too many to draw or send. For wide regions the server should return counts per bin (for example, guides per 1,000 letters), and switch to individual guides only below some region size
Get a gene's ranked guides: @app.get("/genes/{name}/guides?limit=&offset=")
  input: name plus limit and offset
  output: page of guides
Get one guide's off-targets: @app.get("/guides/offtargets?chrom=&start=&strand=")
  input: chrom, start, and strand
  output: list, most dangerous first, with each off-target's location, strand, sequence, mismatch count, mismatch positions, and r

2. What is loaded at startup, and what about the mismatch limit? The index is built for one max_mismatches value. If a request asks for a different one, do you reject it, build another index on demand, or fix one value at startup?

The genome, genes, sites and index are loaded at startup. We allowing the user to choose a value and fix it at startup, and make the default 3 if they don't put anything. from there, requests can't change it 

3. What coordinates does the API use? Internally we use 0-based, half-open. A viewer or a user might expect 1-based inclusive, as in GFF and the printed table. Pick one for the API and say how a request like "positions 100 to 200" is read.

The API will use 1-based inclusive. It would be read as 99 - 200 under our backend's 0-based, half-open format

4. What are the default and maximum page sizes, and does the response include total?

Default is 20, maximum is 50. Yes the reposnse includes total so the client knows how many pages exist. If they give a bad value (eg. limit = 200) clamp to max value

5. What do you cache, by what key, when is something evicted, and roughly how many entries does the cache hold before evicting?

Cache the guides with key ("gene_guides", "lacZ")
Cache guide's off targets with key (chrom, start, strand)
Cache a region ((chrom, start, end) plus anything else that changes the output, such as the bin size)

Evict on LRU policy

Guide's should be filled lazily and be kept in their own LRU with a 200 gene cap. For the rest of the entries, it will hold 1000 entries, but we can reconfigure this later for better efficiency later if needed

Record hits and misses, and expose them in /info or /stats.
If requests can run concurrently, a shared cache needs a lock.

6. What should the server return for an unknown gene, a bad region, or a region that's too large?

Uknown gene: 404 (not found)
Bad region: 400 (bad request)
Oversized region: 400 (bad request)

### Scoring rule (M3, placeholder heuristic)

- Mismatch position i: 0-based index in the 20-letter protospacer, read 5'->3'.
  i = 19 touches the PAM; i = 0 is the far end.
- Per off-target risk: g = 100 * product over mismatched positions i of (20 - i) / 21.
  (21, not 20, so no factor is 0: a PAM-side mismatch lowers g a lot but never
  forces it to exactly 0.)
- Guide combined risk: g = sqrt(sum of r^2) over the guide's off-targets (p = 2).
- Guide score: 100 / (100 + g). Higher is safer. A guide with no off-targets scores the maximum.
- Ranking: highest score first; ties broken by (chrom, start, strand) ascending.

Properties (tested):
- A perfect match has r = 100.
- Adding a mismatch never raises r; moving a mismatch toward the PAM never raises r.
- 0 < r <= 100.
- max(r) <= g <= sum(r). Adding an off-target never lowers g, so it never raises the score.
- A higher g always gives a lower score. Results are deterministic.
- Dropped on purpose: "a 0-mismatch off-target beats any number of 3-mismatch ones"
  (an additive combination can't guarantee it).

Limits: a simplified heuristic, not experimentally validated; NGG PAM only;
substitutions only (no bulges or indels); no on-target efficiency model; one genome tested;
the linear position ramp is a placeholder. Scores are relative rankings, not probabilities.

OrderedDict plus an RLock: get, put, and get_or_compute are all O(1).
Holding the lock during compute() guarantees one computation per missing key under concurrent requests. The cost is that a slow compute (such as the 1.5 s gene scoring) blocks every other cache user for that time. Per-key locks would remove that, at the price of more complexity.
