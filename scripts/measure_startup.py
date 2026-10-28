"""Start the GUIDR server as a subprocess and report how long it takes to be ready and how much memory it uses.

Usage (project root, venv active):
    python scripts/measure_startup.py --fasta data/GCF_000005845.2_ASM584v2_genomic.fna \
                                      --gff   data/GCF_000005845.2_ASM584v2_genomic.gff --runs 3
"""
from __future__ import annotations

import argparse
import os
import statistics
import subprocess
import sys
import time

import httpx


def one_run(fasta: str, gff: str, port: int, timeout: float) -> tuple[float, float]:
    env = {**os.environ, "GUIDR_FASTA": fasta, "GUIDR_GFF": gff, "GUIDR_STATIC_DIR": "none"}
    start = time.perf_counter()
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "--factory", "guidr.server:server_from_env", "--port", str(port)],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        while time.perf_counter() - start < timeout:
            if proc.poll() is not None:
                raise RuntimeError("the server exited early; run the uvicorn command by hand to see why")
            try:
                if httpx.get(f"http://127.0.0.1:{port}/api/info", timeout=1).status_code == 200:
                    ready = time.perf_counter() - start
                    rss_kb = float(subprocess.check_output(["ps", "-o", "rss=", "-p", str(proc.pid)]).decode().strip())
                    return ready, rss_kb / 1024
            except httpx.HTTPError:
                pass
            time.sleep(0.1)
        raise TimeoutError(f"not ready after {timeout:.0f} s")
    finally:
        proc.terminate()
        proc.wait(timeout=10)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--fasta", required=True)
    p.add_argument("--gff", required=True)
    p.add_argument("--runs", type=int, default=3)
    p.add_argument("--port", type=int, default=8091)
    p.add_argument("--timeout", type=float, default=180)
    args = p.parse_args()
    runs = [one_run(args.fasta, args.gff, args.port, args.timeout) for _ in range(args.runs)]
    for i, (t, mb) in enumerate(runs, 1):
        print(f"run {i}: ready in {t:.1f} s, resident memory {mb:.0f} MB")
    print(f"median: ready in {statistics.median(t for t, _ in runs):.1f} s, resident memory {statistics.median(mb for _, mb in runs):.0f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
