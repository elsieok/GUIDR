import { describe, expect, it } from "vitest";
import { LRUCache } from "./lru";

describe("LRUCache (client)", () => {
  it("rejects a capacity below one", () => {
    expect(() => new LRUCache<string, number>(0)).toThrow(RangeError);
  });

  it("stores and returns values, counting hits and misses", () => {
    const c = new LRUCache<string, number>(2);
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    expect(c.get("zzz")).toBeUndefined();
    expect(c.stats()).toEqual({ hits: 1, misses: 1, size: 1, maxEntries: 2 });
  });

  it("returns falsy cached values as hits", () => {
    const c = new LRUCache<string, number | string | unknown[]>(3);
    c.set("zero", 0);
    c.set("empty", "");
    c.set("list", []);
    expect(c.get("zero")).toBe(0);
    expect(c.get("empty")).toBe("");
    expect(c.get("list")).toEqual([]);
    expect(c.stats().hits).toBe(3);
  });

  it("evicts the least recently used entry", () => {
    const c = new LRUCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");              // "a" is now more recent than "b"
    c.set("c", 3);           // "b" must go
    expect(c.has("b")).toBe(false);
    expect(c.has("a") && c.has("c")).toBe(true);
    expect(c.size).toBe(2);
  });

  it("updating an existing key refreshes it without growing the cache", () => {
    const c = new LRUCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("a", 10);          // "b" is now the oldest
    c.set("c", 3);
    expect(c.get("a")).toBe(10);
    expect(c.has("b")).toBe(false);
    expect(c.size).toBe(2);
  });

  it("has() changes neither recency nor the counters", () => {
    const c = new LRUCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.has("a")).toBe(true);   // must NOT refresh "a"
    c.set("c", 3);                   // so "a" (the oldest) is evicted
    expect(c.has("a")).toBe(false);
    expect(c.stats().hits + c.stats().misses).toBe(0);
  });
});
