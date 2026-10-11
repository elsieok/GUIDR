import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRegionLoader } from "./regionLoader";
import type { RegionResponse } from "./types";
import { requestWindow } from "./viewport";

const CHROM = 4_641_652;
const data = (tag: string) => ({ chrom: "c", start: 1, end: 100, genes: [], mode: "guides", guides: [], tag }) as unknown as RegionResponse;

function fakeApi() {
  const calls: { chrom: string; start: number; end: number; signal?: AbortSignal; resolve: (v: RegionResponse) => void; reject: (e: unknown) => void }[] = [];
  const api = {
    region: (chrom: string, start: number, end: number, signal?: AbortSignal) =>
      new Promise<RegionResponse>((resolve, reject) => { calls.push({ chrom, start, end, signal, resolve, reject }); }),
  };
  return { api, calls };
}

function setup(extra: { debounceMs?: number } = {}) {
  const { api, calls } = fakeApi();
  const onData = vi.fn();
  const onError = vi.fn();
  const loader = createRegionLoader({ api, chrom: "c", chromLen: CHROM, onData, onError, ...extra });
  return { loader, calls, onData, onError };
}
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const V1 = { start: 100_000, end: 101_000 };
const V2 = { start: 2_000_000, end: 2_001_000 };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("debounce", () => {
  it("waits 200 ms of stillness before calling the API", async () => {
    const { loader, calls } = setup();
    loader.setView(V1);
    await wait(199);
    expect(calls).toHaveLength(0);
    await wait(1);
    expect(calls).toHaveLength(1);
  });
  it("honours a custom delay", async () => {
    const { loader, calls } = setup({ debounceMs: 50 });
    loader.setView(V1);
    await wait(49);
    expect(calls).toHaveLength(0);
    await wait(1);
    expect(calls).toHaveLength(1);
  });
  it("sends one request, for the last view, when the view keeps moving", async () => {
    const { loader, calls } = setup();
    for (let i = 1; i <= 5; i++) {
      loader.setView({ start: i * 10_000, end: i * 10_000 + 1000 });
      await wait(50);
    }
    expect(calls).toHaveLength(0);
    await wait(200);
    expect(calls).toHaveLength(1);
    const w = requestWindow({ start: 50_000, end: 51_000 }, CHROM);
    expect([calls[0].chrom, calls[0].start, calls[0].end]).toEqual(["c", w.start, w.end]);
  });
});

describe("requests and results", () => {
  it("asks for the padded, grid-rounded window and reports it with the data", async () => {
    const { loader, calls, onData } = setup();
    loader.setView(V1);
    await wait(200);
    const w = requestWindow(V1, CHROM);
    expect([calls[0].start, calls[0].end]).toEqual([w.start, w.end]);
    calls[0].resolve(data("one"));
    await wait(0);
    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledWith(data("one"), w);
  });
  it("does not ask again when a small move leaves the window unchanged", async () => {
    const { loader, calls } = setup();
    loader.setView(V1);
    await wait(200);
    calls[0].resolve(data("one"));
    await wait(0);
    loader.setView({ start: 100_050, end: 101_050 });   // same padded, rounded window
    await wait(200);
    expect(calls).toHaveLength(1);
  });
  it("does not ask again while the same window is still loading", async () => {
    const { loader, calls } = setup();
    loader.setView(V1);
    await wait(200);
    loader.setView({ start: 100_050, end: 101_050 });
    await wait(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].signal?.aborted).toBe(false);
  });
});

describe("stale requests", () => {
  it("aborts the in-flight request when a different window is needed", async () => {
    const { loader, calls } = setup();
    loader.setView(V1);
    await wait(200);
    loader.setView(V2);
    await wait(200);
    expect(calls).toHaveLength(2);
    expect(calls[0].signal?.aborted).toBe(true);
    expect(calls[1].signal?.aborted).toBe(false);
  });
  it("ignores a late answer to an old request, even if the API ignores the abort", async () => {
    const { loader, calls, onData } = setup();
    loader.setView(V1);
    await wait(200);
    loader.setView(V2);
    await wait(200);
    calls[0].resolve(data("old"));      // arrives after the newer request started
    await wait(0);
    expect(onData).not.toHaveBeenCalled();
    calls[1].resolve(data("new"));
    await wait(0);
    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData.mock.calls[0][0]).toEqual(data("new"));
  });
});

describe("errors", () => {
  it("swallows an AbortError", async () => {
    const { loader, calls, onError } = setup();
    loader.setView(V1);
    await wait(200);
    calls[0].reject(new DOMException("Aborted", "AbortError"));
    await wait(0);
    expect(onError).not.toHaveBeenCalled();
  });
  it("reports other errors, and allows the same window to be retried", async () => {
    const { loader, calls, onError } = setup();
    loader.setView(V1);
    await wait(200);
    calls[0].reject(new Error("boom"));
    await wait(0);
    expect(onError).toHaveBeenCalledTimes(1);
    loader.setView(V1);
    await wait(200);
    expect(calls).toHaveLength(2);
  });
  it("does not report the failure of a request that has been replaced", async () => {
    const { loader, calls, onError } = setup();
    loader.setView(V1);
    await wait(200);
    loader.setView(V2);
    await wait(200);
    calls[0].reject(new Error("late failure"));
    await wait(0);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("cancel", () => {
  it("drops a pending request before it is sent", async () => {
    const { loader, calls } = setup();
    loader.setView(V1);
    loader.cancel();
    await wait(500);
    expect(calls).toHaveLength(0);
  });
  it("aborts an in-flight request and ignores its answer", async () => {
    const { loader, calls, onData } = setup();
    loader.setView(V1);
    await wait(200);
    loader.cancel();
    expect(calls[0].signal?.aborted).toBe(true);
    calls[0].resolve(data("late"));
    await wait(0);
    expect(onData).not.toHaveBeenCalled();
  });
});
