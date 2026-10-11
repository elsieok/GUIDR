import { describe, expect, it } from "vitest";
import { formatPosition, niceTicks, tickStep } from "./ticks";

describe("formatPosition", () => {
  it("adds thousands separators", () => {
    expect(formatPosition(0)).toBe("0");
    expect(formatPosition(999)).toBe("999");
    expect(formatPosition(1000)).toBe("1,000");
    expect(formatPosition(1234567)).toBe("1,234,567");
    expect(formatPosition(4641652)).toBe("4,641,652");
  });
});

describe("tickStep", () => {
  it("picks the smallest 1, 2 or 5 times a power of ten that gives at most the target number of ticks", () => {
    expect(tickStep(1000, 8)).toBe(200);          // 125 per tick wanted -> 200
    expect(tickStep(100, 10)).toBe(10);
    expect(tickStep(60, 8)).toBe(10);             // 7.5 wanted -> 10
    expect(tickStep(4_641_652, 8)).toBe(1_000_000);
    expect(tickStep(400, 8)).toBe(50);            // exactly 50 wanted -> 50
    expect(tickStep(3000, 8)).toBe(500);          // 375 wanted -> 500
  });
  it("never goes below 1 letter", () => {
    expect(tickStep(4, 8)).toBe(1);
  });
  it("rejects nonsense", () => {
    expect(() => tickStep(0)).toThrow(RangeError);
    expect(() => tickStep(100, 0)).toThrow(RangeError);
  });
});

describe("niceTicks", () => {
  it("returns ticks at multiples of the step, with 1-based labels and 0-based drawing positions", () => {
    const t = niceTicks({ start: 0, end: 1000 });
    expect(t.map((x) => x.label)).toEqual(["200", "400", "600", "800", "1,000"]);
    expect(t.map((x) => x.pos)).toEqual([199, 399, 599, 799, 999]);
  });
  it("handles a view that starts mid-chromosome with fractions", () => {
    const t = niceTicks({ start: 150.5, end: 1150.5 });
    expect(t.map((x) => x.label)).toEqual(["200", "400", "600", "800", "1,000"]);
  });
  it("formats big positions", () => {
    const t = niceTicks({ start: 1_000_000, end: 1_001_000 });
    expect(t[0].label).toBe("1,000,200");
  });
  it("holds its invariants for many views", () => {
    for (const len of [50, 123, 1000, 5000, 77_777, 4_641_652]) {
      for (const start of [0, 12_345.6, 1_000_000]) {
        const v = { start, end: start + len };
        const ticks = niceTicks(v, 8);
        const step = tickStep(len, 8);
        expect(ticks.length).toBeGreaterThanOrEqual(1);
        expect(ticks.length).toBeLessThanOrEqual(16);
        for (const tk of ticks) {
          expect(tk.pos).toBeGreaterThanOrEqual(Math.floor(v.start));
          expect(tk.pos).toBeLessThan(Math.ceil(v.end));
          expect((tk.pos + 1) % step).toBe(0);
        }
        for (let i = 1; i < ticks.length; i++) expect(ticks[i].pos - ticks[i - 1].pos).toBe(step);
      }
    }
  });
});
