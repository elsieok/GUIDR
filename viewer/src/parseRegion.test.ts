import { describe, expect, it } from "vitest";
import { parseRegion } from "./parseRegion";

describe("parseRegion", () => {
  it("reads a region with a chromosome, with or without thousands separators", () => {
    expect(parseRegion("NC_000913.3:1,000-2,000", "x")).toEqual({ chrom: "NC_000913.3", start: 1000, end: 2000 });
    expect(parseRegion("c:5-10", "x")).toEqual({ chrom: "c", start: 5, end: 10 });
  });
  it("uses the current chromosome when none is typed, and accepts .. as a separator", () => {
    expect(parseRegion("1000..2000", "cur")).toEqual({ chrom: "cur", start: 1000, end: 2000 });
    expect(parseRegion("  7 - 9 ", "cur")).toEqual({ chrom: "cur", start: 7, end: 9 });
  });
  it("rejects text that is not a region", () => {
    expect(() => parseRegion("lacZ", "c")).toThrow(/region like/);
    expect(() => parseRegion("", "c")).toThrow();
  });
  it("rejects start below 1 and end before start", () => {
    expect(() => parseRegion("0-10", "c")).toThrow(/start <= end/);
    expect(() => parseRegion("10-5", "c")).toThrow(/start <= end/);
  });
});
