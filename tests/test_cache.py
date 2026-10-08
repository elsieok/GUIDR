"""Acceptance tests for the LRU cache used by the API."""
import threading
import time

import pytest

from guidr.cache import LRUCache


def test_rejects_capacity_below_one():
    with pytest.raises(ValueError):
        LRUCache(0)


def test_put_then_get_returns_the_value_and_counts_a_hit():
    cache = LRUCache(2)
    cache.put("a", 1)
    assert cache.get("a") == 1
    assert cache.stats()["hits"] == 1 and cache.stats()["misses"] == 0


def test_missing_key_returns_the_default_and_counts_a_miss():
    cache = LRUCache(2)
    assert cache.get("nope") is None
    assert cache.get("nope", "fallback") == "fallback"
    assert cache.stats()["misses"] == 2 and cache.stats()["hits"] == 0


def test_evicts_the_least_recently_used_entry():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.get("a")          # "a" is now more recent than "b"
    cache.put("c", 3)       # over capacity: "b" must go
    assert "b" not in cache
    assert "a" in cache and "c" in cache and len(cache) == 2


def test_putting_an_existing_key_updates_it_without_growing_and_refreshes_it():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("a", 10)      # update + refresh: "b" is now the oldest
    cache.put("c", 3)
    assert cache.get("a") == 10
    assert "b" not in cache and len(cache) == 2


def test_contains_does_not_touch_recency_or_counters():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    assert "a" in cache     # must NOT refresh "a"
    cache.put("c", 3)       # so "a" (the oldest) is evicted
    assert "a" not in cache and "b" in cache
    assert cache.stats()["hits"] == 0 and cache.stats()["misses"] == 0


def test_get_or_compute_computes_once_then_hits():
    cache = LRUCache(2)
    calls = []

    def compute():
        calls.append(1)
        return "value"

    assert cache.get_or_compute("k", compute) == "value"
    assert cache.get_or_compute("k", compute) == "value"
    assert len(calls) == 1
    assert cache.stats()["misses"] == 1 and cache.stats()["hits"] == 1


def test_get_or_compute_recomputes_after_eviction():
    cache = LRUCache(1)
    calls = []
    for key in ["x", "y", "x"]:
        cache.get_or_compute(key, lambda k=key: calls.append(k) or k)
    assert calls == ["x", "y", "x"]
    assert cache.stats()["hits"] == 0 and cache.stats()["misses"] == 3


def test_stats_reports_size_and_capacity():
    cache = LRUCache(3)
    cache.put("a", 1)
    assert cache.stats() == {"hits": 0, "misses": 0, "size": 1, "max_entries": 3}


def test_counters_stay_exact_under_concurrent_use():
    cache = LRUCache(10)
    errors = []

    def worker(offset):
        try:
            for i in range(500):
                cache.get_or_compute((i + offset) % 20, lambda: "v")
        except Exception as exc:  # pragma: no cover
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(t,)) for t in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
    assert len(cache) <= 10
    assert cache.stats()["hits"] + cache.stats()["misses"] == 8 * 500


def test_racing_requests_for_one_missing_key_compute_it_only_once():
    """Cache stampede guard: 8 threads ask for the same missing key at the same moment."""
    cache = LRUCache(10)
    calls = []
    start = threading.Barrier(8)

    def slow_compute():
        calls.append(1)
        time.sleep(0.05)   # long enough for the other threads to arrive
        return "value"

    results = []

    def worker():
        start.wait()
        results.append(cache.get_or_compute("k", slow_compute))

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    assert results == ["value"] * 8
    assert len(calls) == 1
    assert cache.stats()["misses"] == 1 and cache.stats()["hits"] == 7
