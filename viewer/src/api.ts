import { LRUCache } from "./lru";
import type {
  ApiErrorBody, Gene, GenePage, Info, OffTargetsResponse, RegionResponse, ScoredGuide, Strand,
} from "./types";

const PAGE = 50;

/** Thrown for any non-2xx response. `body` is the server's {error, detail}, or null if it was not JSON. */
export class ApiError extends Error {
  status: number;
  body: ApiErrorBody | null   // null if not json

  constructor(public status: number, public body: ApiErrorBody | null) {
    super(body?.error ?? `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body
  }
}

export interface ApiOptions {
  baseUrl?: string;     // default "/api" (the dev proxy strips it before the request reaches FastAPI)
  fetchFn?: typeof fetch; // default: the global fetch. Tests pass a fake.
  cacheSize?: number;   // entries in the client cache; default 200
}

/**
 * A typed client for the GUIDR API with a client-side cache.
 *
 * Rules:
 *  - URL = baseUrl + path + "?" + query. Build the query with URLSearchParams (so "+" in a strand
 *    becomes %2B and nothing needs hand-encoding). Encode gene names in the path with
 *    encodeURIComponent. Query order follows the order of the keys you pass (see the tests).
 *  - Cache every successful GET answer in an LRUCache keyed by the full URL (path AND query),
 *    EXCEPT info(): its cache statistics change, so it is always fetched. A cache hit must not call fetch.
 *  - On a non-2xx response throw ApiError(status, parsed JSON body or null if the body is not JSON).
 *    Never cache a failure.
 *  - Pass the AbortSignal through to fetch. An aborted request rejects with the AbortError
 *    and caches nothing.
 *
 * Methods (paths and parameters):
 *  info()                              GET /info
 *  gene(name)                          GET /genes/{name}
 *  geneGuides(name, limit=50, offset=0) GET /genes/{name}/guides?limit=&offset=
 *  allGeneGuides(name)                 loops geneGuides pages of 50 (offset 0, 50, 100, ...) until
 *                                      offset >= total; returns all items in order. It goes through
 *                                      geneGuides, so each page is cached.
 *  region(chrom, start, end)           GET /regions?chrom=&start=&end=
 *  offTargets(chrom, start, strand)    GET /guides/offtargets?chrom=&start=&strand=
 *  cacheStats()                        the cache's stats() (hits, misses, size, maxEntries)
 * Every method takes an optional AbortSignal as its last argument.
 */
export function createApi(options: ApiOptions = {}) {
  const baseUrl = options.baseUrl ?? "/api";
  // Wrap the global fetch in an arrow function. Passing `fetch` on its own can throw "Illegal invocation" because it loses the object it belongs to.
  const fetchFn: typeof fetch = options.fetchFn ?? ((input, init) => fetch(input, init));
  const cache = new LRUCache<string, unknown>(options.cacheSize ?? 200);

  async function request<T>(
    path: string, 
    query: Record<string, string | number> = {},  // an object like { chrom: "c", start: 1 }
    signal?: AbortSignal,  // lets the caller cancel the request
    cached = true,
  ): Promise<T> {
    // Turn {chrom:"c", start:1} into "chrom=c&start=1". URLSearchParams also encodes "+" as "%2B".
    const qs = new URLSearchParams(
      Object.entries(query).map(([k, v]) => [k, String(v)]),  // pairs like ["start", "1"]
    ).toString();
    const url = `${baseUrl}${path}${qs ? "?" + qs : ""}`;      // add "?" only if there is a query
    
    if (cached) {
      const hit = cache.get(url);
      if (hit !== undefined) return hit as T;
    }

    const res = await fetchFn(url, { signal });

    if (!res.ok) {
      let body: ApiErrorBody | null = null;
      try {
        body = (await res.json()) as ApiErrorBody;
      } catch {
        // the body wasn't JSON (e.g. plain "Internal Server Error"); leave body as null
      }
      throw new ApiError(res.status, body);
    }

    const data = (await res.json()) as T;
    if (cached)
      cache.set(url, data);
    return data
  }
  // One page of a gene's guides. It goes through `request`, so every page is cached.
  const geneGuides = (name: string, limit = PAGE, offset = 0, signal?: AbortSignal) => request<GenePage>(`/genes/${encodeURIComponent(name)}/guides`, { limit, offset }, signal);
  // encodeURIComponent makes a gene name safe inside a path ("lac Z" becomes "lac%20Z")
  
  return {
    info: (signal?: AbortSignal) => request<Info>("/info", {}, signal, false),

    gene: (name: string, signal?: AbortSignal) => request<Gene>(`/genes/${encodeURIComponent(name)}`, {}, signal),

    geneGuides,

    // fetch every page and joinn them
    async allGeneGuides(name: string, signal?: AbortSignal): Promise<ScoredGuide[]> {
      const items: ScoredGuide[] = [];
      let offset = 0;
      for (;;) {
        const page = await geneGuides(name, PAGE, offset, signal);
        items.push(...page.items);
        offset += PAGE;
        if (offset >= page.total) return items
      }
    },

    region: (chrom: string, start: number, end: number, signal?: AbortSignal) => request<RegionResponse>("/regions", { chrom, start, end }, signal),
    // `{ chrom, start, end }` is shorthand for `{ chrom: chrom, start: start, end: end }`

    offTargets: (chrom: string, start: number, strand: Strand, signal?: AbortSignal) => request<OffTargetsResponse>("/guides/offtargets", { chrom, start, strand }, signal),

    cacheStats: () => cache.stats()
  };
}
