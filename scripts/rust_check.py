import random, time
from guidr.index import PySeedIndex, RustSeedIndex, SeedIndex
from guidr.sites import enumerate_sites, py_enumerate_sites

print("SeedIndex in use:", SeedIndex.__name__)
if SeedIndex is not RustSeedIndex:
    raise SystemExit("Rust extension not in use (import fell back to Python).")

def timed(fn):
    t = time.perf_counter(); out = fn(); return out, time.perf_counter() - t

rng = random.Random(1)
genome = "".join(rng.choices("ACGT", k=4_600_000))
py_sites, t_py = timed(lambda: list(py_enumerate_sites("c", genome)))
rs_sites, t_rs = timed(lambda: list(enumerate_sites("c", genome)))
print(f"enumerate_sites  python {t_py:5.2f}s  rust {t_rs:5.2f}s  ({t_py/t_rs:.1f}x)")
py_idx, t_py = timed(lambda: PySeedIndex(py_sites, 3))
rs_idx, t_rs = timed(lambda: RustSeedIndex(rs_sites, 3))
print(f"index build      python {t_py:5.2f}s  rust {t_rs:5.2f}s  ({t_py/t_rs:.1f}x)")
guides = py_sites[:300]
_, t_py = timed(lambda: [py_idx.query(g) for g in guides])
_, t_rs = timed(lambda: rs_idx.query_many(guides))
print(f"300 queries      python {t_py:5.2f}s  rust {t_rs:5.2f}s  ({t_py/t_rs:.1f}x)")