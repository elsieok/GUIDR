import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi } from "./api";

// A fake fetch: records every URL and answers from a table of {status, body}.
function fakeFetch(routes: (url: string) => { status?: number; body?: unknown; text?: string }) {
  const calls: { url: string; signal?: AbortSignal | null }[] = [];
  const fn = vi.fn(async (input: string, init?: RequestInit) => {
    calls.push({ url: input, signal: init?.signal });
    const r = routes(input);
    const status = r.status ?? 200;
    return new Response(r.text ?? JSON.stringify(r.body ?? {}), { status });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const region = { chrom: "c", start: 1, end: 100, genes: [], mode: "guides", guides: [] };

describe("URLs", () => {
  it("uses /api by default and a custom base when given", async () => {
    const a = fakeFetch(() => ({ body: { max_mismatches: 3 } }));
    await createApi({ fetchFn: a.fn }).info();
    expect(a.calls[0].url).toBe("/api/info");
    const b = fakeFetch(() => ({ body: {} }));
    await createApi({ fetchFn: b.fn, baseUrl: "http://x:8000" }).info();
    expect(b.calls[0].url).toBe("http://x:8000/info");
  });

  it("encodes gene names in the path", async () => {
    const f = fakeFetch(() => ({ body: {} }));
    await createApi({ fetchFn: f.fn }).gene("lac Z");
    expect(f.calls[0].url).toBe("/api/genes/lac%20Z");
  });

  it("sends paging parameters, defaulting to 50 per page from offset 0", async () => {
    const f = fakeFetch(() => ({ body: { items: [], total: 0 } }));
    const api = createApi({ fetchFn: f.fn });
    await api.geneGuides("lacZ");
    await api.geneGuides("lacZ", 10, 20);
    expect(f.calls.map((c) => c.url)).toEqual([
      "/api/genes/lacZ/guides?limit=50&offset=0",
      "/api/genes/lacZ/guides?limit=10&offset=20",
    ]);
  });

  it("builds region and off-target queries, encoding + as %2B", async () => {
    const f = fakeFetch(() => ({ body: {} }));
    const api = createApi({ fetchFn: f.fn });
    await api.region("c", 1, 100);
    await api.offTargets("NC_000913.3", 363233, "+");
    expect(f.calls[0].url).toBe("/api/regions?chrom=c&start=1&end=100");
    expect(f.calls[1].url).toBe("/api/guides/offtargets?chrom=NC_000913.3&start=363233&strand=%2B");
  });
});

describe("errors", () => {
  it("throws ApiError with the status and the JSON error body", async () => {
    const f = fakeFetch(() => ({ status: 404, body: { error: "gene not found", detail: "nope" } }));
    const err = await createApi({ fetchFn: f.fn }).gene("nope").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.body).toEqual({ error: "gene not found", detail: "nope" });
    expect(err.message).toBe("gene not found");
  });

  it("copes with an error response that is not JSON", async () => {
    const f = fakeFetch(() => ({ status: 500, text: "Internal Server Error" }));
    const err = await createApi({ fetchFn: f.fn }).gene("x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
    expect(err.body).toBeNull();
  });

  it("does not cache failures", async () => {
    let status = 404;
    const f = fakeFetch(() => (status === 404 ? { status, body: { error: "x", detail: null } } : { body: region }));
    const api = createApi({ fetchFn: f.fn });
    await api.region("c", 1, 100).catch(() => undefined);
    status = 200;
    expect(await api.region("c", 1, 100)).toEqual(region);
    expect(f.calls).toHaveLength(2);
  });
});

describe("client cache", () => {
  it("answers a repeated request without calling fetch, and counts hits and misses", async () => {
    const f = fakeFetch(() => ({ body: region }));
    const api = createApi({ fetchFn: f.fn });
    await api.region("c", 1, 100);
    await api.region("c", 1, 100);
    await api.region("c", 1, 101);                  // different parameters: a new entry
    expect(f.calls).toHaveLength(2);
    expect(api.cacheStats()).toMatchObject({ hits: 1, misses: 2, size: 2 });
  });

  it("never caches /info (its cache statistics change)", async () => {
    const f = fakeFetch(() => ({ body: {} }));
    const api = createApi({ fetchFn: f.fn });
    await api.info();
    await api.info();
    expect(f.calls).toHaveLength(2);
  });

  it("evicts the least recently used entries when full", async () => {
    const f = fakeFetch(() => ({ body: region }));
    const api = createApi({ fetchFn: f.fn, cacheSize: 1 });
    await api.region("c", 1, 100);
    await api.region("c", 1, 200);
    await api.region("c", 1, 100);                  // evicted by the request in between
    expect(f.calls).toHaveLength(3);
  });
});

describe("allGeneGuides", () => {
  it("loops over pages of 50 until the total is reached, then serves repeats from the cache", async () => {
    const total = 120;
    const f = fakeFetch((url) => {
      const offset = Number(new URL(url, "http://x").searchParams.get("offset"));
      const n = Math.max(0, Math.min(50, total - offset));
      return { body: { gene: "g", total, limit: 50, offset, items: Array.from({ length: n }, (_, i) => ({ id: offset + i })) } };
    });
    const api = createApi({ fetchFn: f.fn });
    const all = await api.allGeneGuides("g");
    expect(all).toHaveLength(120);
    expect(all.map((x: any) => x.id)).toEqual(Array.from({ length: 120 }, (_, i) => i));
    expect(f.calls.map((c) => new URL(c.url, "http://x").searchParams.get("offset"))).toEqual(["0", "50", "100"]);
    await api.allGeneGuides("g");
    expect(f.calls).toHaveLength(3);
  });

  it("makes a single request when everything fits in one page", async () => {
    const f = fakeFetch(() => ({ body: { gene: "g", total: 2, limit: 50, offset: 0, items: [{ id: 1 }, { id: 2 }] } }));
    expect(await createApi({ fetchFn: f.fn }).allGeneGuides("g")).toHaveLength(2);
    expect(f.calls).toHaveLength(1);
  });
});

describe("aborting", () => {
  it("passes the signal to fetch and rejects with AbortError, caching nothing", async () => {
    const calls: (AbortSignal | null | undefined)[] = [];
    const slow = (async (_url: string, init?: RequestInit) => {
      calls.push(init?.signal);
      return new Promise<Response>((resolve, reject) => {
        const t = setTimeout(() => resolve(new Response(JSON.stringify(region))), 50);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as unknown as typeof fetch;
    const api = createApi({ fetchFn: slow });
    const ctrl = new AbortController();
    const pending = api.region("c", 1, 100, ctrl.signal);
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(calls[0]).toBe(ctrl.signal);
    expect(await api.region("c", 1, 100)).toEqual(region);   // not cached: fetches again
    expect(calls).toHaveLength(2);
  });
});
