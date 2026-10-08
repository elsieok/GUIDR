"""LRU cache for the API (M3 part B).

Keeps at most `max_entries` items. When full, the LEAST RECENTLY USED item is
evicted. Counts hits and misses so the API can report a hit rate.
"""
from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Callable, Hashable, TypeVar, cast

_MISSING = object()
T = TypeVar("T")


class LRUCache:
    def __init__(self, max_entries: int) -> None:
        """Raise ValueError if max_entries < 1.

        Hint: an OrderedDict keeps insertion order; `move_to_end(key)` marks a key as
        most recent and `popitem(last=False)` removes the oldest one. A lock
        (threading.RLock) protects every operation, because API requests can run in
        different threads. Keep `hits` and `misses` counters.
        """
        if max_entries < 1:
            raise ValueError("max_entries must be greater than 0")

        
        self.cache = OrderedDict()
        self.cache_lock = threading.RLock()
        self.max_entries = max_entries
        self.hits = 0
        self.misses = 0

    def get(self, key: Hashable, default=None):
        """Return the cached value (a hit: count it and mark the key most recent),
        or `default` (a miss: count it)."""
        with self.cache_lock:
            if key not in self.cache:
                self.misses += 1
                return default

            self.hits += 1
            self.cache.move_to_end(key)

            return self.cache[key]

    def put(self, key: Hashable, value) -> None:
        """Insert or update `key`, mark it most recent, and evict the least recently
        used entries while the cache is over capacity. Does not touch hits/misses."""
        with self.cache_lock:
            if key in self.cache:
                self.cache[key] = value
                self.cache.move_to_end(key)
                return None

            if len(self.cache) >= self.max_entries:
                self.cache.popitem(last=False)

            self.cache[key] = value
            return None

    def get_or_compute(self, key: Hashable, compute: Callable[[], T]) -> T:
        """Return the cached value, or call `compute()` once, store and return its result.

        - Counts exactly one hit or one miss per call.
        - If several threads ask for the same missing key at the same moment,
          `compute` must run only ONCE (the others wait, then get a hit).
          The simplest way: hold the lock while computing. Trade-off to note in
          DECISIONS.md: other requests wait during a slow compute.
        """
        with self.cache_lock:
            cache_result = self.get(key, _MISSING)

            if cache_result is not _MISSING:
                return cast(T, cache_result)

            value = compute()
            self.put(key, value)
            return value

    def __len__(self) -> int:
        with self.cache_lock:
            return len(self.cache)
    
    def __contains__(self, key: Hashable) -> bool:
        """Membership test. Must NOT change recency or the counters."""
        with self.cache_lock:
            return key in self.cache

    def stats(self) -> dict:
        """{"hits": int, "misses": int, "size": int, "max_entries": int}"""
        with self.cache_lock:
            return {"hits": self.hits, "misses": self.misses, "size": len(self.cache), "max_entries": self.max_entries}
