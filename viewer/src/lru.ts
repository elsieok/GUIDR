/**
 * Least-recently-used cache for the viewer (client side).
 *
 * Keeps at most `maxEntries` items; when full, the LEAST RECENTLY USED item is evicted.
 * Counts hits and misses so the viewer can report a hit rate.
 *
 * Hint: a JavaScript Map remembers insertion order. To mark a key as "most recent", delete it and
 * set it again; the oldest key is `map.keys().next().value`.
 */
export class LRUCache<K, V> {
  private readonly cache = new Map<K, V>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly maxEntries: number) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("maxEntries must be an integer greater than 0")
    }
  }

  /** The cached value (a hit: count it and mark the key most recent) or undefined (a miss: count it).
   *  Use map.has(key), not truthiness, so cached values like 0, "" and [] still count as hits. */
  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      this.misses++;
      return undefined;
    }

    this.hits++

    const value = this.cache.get(key)!;

    // Refresh recency: delete and reinsert the accessed entry.
    this.cache.delete(key);
    this.cache.set(key, value);

    return value;
  }

  /** Insert or update `key`, mark it most recent, and evict the oldest entries while over capacity.
   *  Does not touch hits or misses. */
  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    this.cache.set(key, value);

    if (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value!;
      this.cache.delete(oldestKey);
    }

    return;
  }

  /** Membership test. Must NOT change recency or the counters. */
  has(key: K): boolean {
    return this.cache.has(key)
  }

  get size(): number {
    return this.cache.size
  }

  stats(): { hits: number; misses: number; size: number; maxEntries: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      maxEntries: this.maxEntries
    };
  }
}
