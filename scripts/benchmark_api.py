"""Benchmark a running GUIDR server and print a Markdown results table for the README.

Usage (project root, venv active; needs httpx, which the dev extras install):
    python scripts/benchmark_api.py --base-url http://127.0.0.1:8080/api
    python scripts/benchmark_api.py --base-url https://YOUR-SERVICE.run.app/api --genes lacZ,lacY,lacA

Cold  = the first time the server sees a request, so it has to compute the answer.
Warm  = the same request again, answered from the server's cache.
For honest cold numbers, start the server fresh (or pass a new --seed) before running.
Times are measured by this script, so they include network time: run it on the same machine as the
server to measure the server itself, and against the deployed URL to measure what a visitor sees.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

DEFAULT_GENES = "lacZ,lacY,lacA,araC,recA,rpoB,dnaK,gyrA,ftsZ,thrA"


def percentile(sorted_ms: list[float], p: float) -> float:
    """Nearest-rank percentile of an already sorted list."""
    if not sorted_ms:
        return float("nan")
    rank = math.ceil(p / 100 * len(sorted_ms))
    return sorted_ms[max(0, min(len(sorted_ms) - 1, rank - 1))]


class Phase:
    def __init__(self, name: str) -> None:
        self.name, self.times, self.errors = name, [], 0

    def stats(self) -> dict:
        s = sorted(self.times)
        return {"phase": self.name, "n": len(s), "errors": self.errors, "p50_ms": percentile(s, 50),
                "p95_ms": percentile(s, 95), "p99_ms": percentile(s, 99), "max_ms": s[-1] if s else float("nan")}


def timed_get(client: httpx.Client, path: str, params: dict | None = None):
    """(milliseconds, parsed JSON or None if the request failed)."""
    start = time.perf_counter()
    try:
        response = client.get(path, params=params or {})
        body = response.json() if response.status_code == 200 else None
    except (httpx.HTTPError, ValueError):
        body = None
    return (time.perf_counter() - start) * 1000, body


def run(phase: Phase, client: httpx.Client, requests: list[tuple[str, dict]]) -> Phase:
    for path, params in requests:
        ms, body = timed_get(client, path, params)
        if body is None:
            phase.errors += 1
        else:
            phase.times.append(ms)
    return phase


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base-url", default="http://127.0.0.1:8000", help="the API's base URL (include /api for the combined server)")
    p.add_argument("--genes", default=DEFAULT_GENES, help="comma-separated gene names to use")
    p.add_argument("--n", type=int, default=50, help="requests per phase")
    p.add_argument("--threads", type=int, default=8, help="parallel clients in the load phase")
    p.add_argument("--seed", type=int, default=None, help="random seed (default: from the clock, so windows are new each run)")
    p.add_argument("--timeout", type=float, default=120.0)
    p.add_argument("--json", default=None, help="also write the results to this JSON file")
    args = p.parse_args()
    seed = args.seed if args.seed is not None else int(time.time())
    rnd = random.Random(seed)

    client = httpx.Client(base_url=args.base_url, timeout=args.timeout)
    t = time.perf_counter()
    try:
        info = client.get("/info").json()
    except (httpx.HTTPError, ValueError) as exc:
        print(f"error: cannot reach {args.base_url}/info ({exc})", file=sys.stderr)
        return 1
    first_ms = (time.perf_counter() - t) * 1000
    chrom, length = info["chromosomes"][0]["name"], info["chromosomes"][0]["length"]

    genes = []
    lookup = Phase("GET /genes/{name}")
    for name in [g.strip() for g in args.genes.split(",") if g.strip()]:
        ms, body = timed_get(client, f"/genes/{name}")
        if body is None:
            print(f"warning: gene {name!r} not found, skipping", file=sys.stderr)
        else:
            genes.append(name)
            lookup.times.append(ms)
    if not genes:
        print("error: none of the genes exist on this server", file=sys.stderr)
        return 1

    phases = [run(Phase("GET /info"), client, [("/info", {})] * args.n)]
    run(lookup, client, [(f"/genes/{rnd.choice(genes)}", {}) for _ in range(args.n)])
    phases.append(lookup)

    cold = run(Phase("GET /genes/{name}/guides (cold)"), client, [(f"/genes/{g}/guides", {"limit": 50, "offset": 0}) for g in genes])
    warm = run(Phase("GET /genes/{name}/guides (warm)"), client, [(f"/genes/{g}/guides", {"limit": 50, "offset": o}) for g in genes for o in (0, 50)])
    phases += [cold, warm]

    narrow = []
    for _ in range(args.n):
        s = rnd.randint(1, max(1, length - 3000))
        narrow.append(("/regions", {"chrom": chrom, "start": s, "end": min(length, s + 2999)}))
    phases.append(run(Phase("GET /regions, 3 kb (cold)"), client, narrow))
    phases.append(run(Phase("GET /regions, 3 kb (warm)"), client, narrow))

    wide = []
    for _ in range(max(5, args.n // 5)):
        span = rnd.randint(min(100_000, length // 2), length)
        s = rnd.randint(1, length - span + 1)
        wide.append(("/regions", {"chrom": chrom, "start": s, "end": s + span - 1}))
    phases.append(run(Phase("GET /regions, 0.1-4.6 Mb (cold, bins)"), client, wide))
    phases.append(run(Phase("GET /regions, 0.1-4.6 Mb (warm, bins)"), client, wide))

    _, response = timed_get(client, f"/genes/{genes[0]}/guides", {"limit": 50, "offset": 0},)

    if response is None:
        raise RuntimeError("Failed to fetch gene guides: API returned no JSON response")

    if not isinstance(response, dict) or not isinstance(response.get("items"), list):
        raise RuntimeError(f"Unexpected gene guides response: {response!r}")

    guides = response["items"][: args.n]
    offs = [("/guides/offtargets", {"chrom": g["chrom"], "start": g["start"], "strand": g["strand"]}) for g in guides]
    phases.append(run(Phase("GET /guides/offtargets (cold)"), client, offs))
    phases.append(run(Phase("GET /guides/offtargets (warm)"), client, offs))

    # ---- load: many clients at once, all requests warm
    pool = [(f"/genes/{g}/guides", {"limit": 50, "offset": 0}) for g in genes] + narrow[:20] + offs[:20]
    per_thread = max(20, args.n * 2)
    chunks = [[pool[rnd.randrange(len(pool))] for _ in range(per_thread)] for _ in range(args.threads)]

    def worker(paths):
        with httpx.Client(base_url=args.base_url, timeout=args.timeout) as c:
            return [timed_get(c, path, params) for path, params in paths]

    started = time.perf_counter()
    with ThreadPoolExecutor(args.threads) as pool_ex:
        results = [r for chunk in pool_ex.map(worker, chunks) for r in chunk]
    elapsed = time.perf_counter() - started
    load = Phase(f"mixed warm load, {args.threads} parallel clients")
    for ms, body in results:
        (load.times.append(ms) if body is not None else setattr(load, "errors", load.errors + 1))
    phases.append(load)

    after = client.get("/info").json()["cache"]
    rate = lambda c: c["hits"] / (c["hits"] + c["misses"]) if c["hits"] + c["misses"] else float("nan")  # noqa: E731

    print(f"Server: {args.base_url}   chromosome {chrom} ({length:,} letters)   seed {seed}")
    print(f"First request to /info: {first_ms:.0f} ms (a large number here means the server had to wake up)\n")
    print("| Phase | n | errors | p50 ms | p95 ms | p99 ms | max ms |")
    print("|---|---:|---:|---:|---:|---:|---:|")
    for ph in phases:
        s = ph.stats()
        print(f"| {s['phase']} | {s['n']} | {s['errors']} | {s['p50_ms']:.1f} | {s['p95_ms']:.1f} | {s['p99_ms']:.1f} | {s['max_ms']:.1f} |")
    print(f"\nLoad throughput: {len(load.times) / elapsed:.0f} requests/s with {args.threads} parallel clients")
    print(f"Server cache hit rate (this server's lifetime): gene guides {rate(after['gene_guides']):.0%} "
          f"({after['gene_guides']['hits']} hits / {after['gene_guides']['misses']} misses); "
          f"regions + off-targets {rate(after['other']):.0%} ({after['other']['hits']} hits / {after['other']['misses']} misses)")
    if args.json:
        with open(args.json, "w") as fh:
            json.dump({"base_url": args.base_url, "seed": seed, "first_request_ms": first_ms,
                       "phases": [ph.stats() for ph in phases], "requests_per_s": len(load.times) / elapsed, "cache": after}, fh, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
