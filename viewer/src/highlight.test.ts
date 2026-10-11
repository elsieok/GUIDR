import { describe, expect, it } from "vitest";
import { highlightSegments } from "./highlight";

describe("highlightSegments (positions are 1-based)", () => {
  it("returns one plain segment when nothing mismatches", () => {
    expect(highlightSegments("GATTACA", [])).toEqual([{ text: "GATTACA", mismatch: false }]);
  });
  it("marks a single position", () => {
    expect(highlightSegments("GATTACA", [3])).toEqual([
      { text: "GA", mismatch: false }, { text: "T", mismatch: true }, { text: "TACA", mismatch: false },
    ]);
  });
  it("merges neighbouring marked positions into one segment", () => {
    expect(highlightSegments("GATTACA", [2, 3])).toEqual([
      { text: "G", mismatch: false }, { text: "AT", mismatch: true }, { text: "TACA", mismatch: false },
    ]);
  });
  it("handles the first and the last letter", () => {
    expect(highlightSegments("GATTACA", [1, 7])).toEqual([
      { text: "G", mismatch: true }, { text: "ATTAC", mismatch: false }, { text: "A", mismatch: true },
    ]);
  });
  it("marks every letter as one segment when all positions mismatch", () => {
    expect(highlightSegments("GATTACA", [1, 2, 3, 4, 5, 6, 7])).toEqual([{ text: "GATTACA", mismatch: true }]);
  });
  it("accepts unsorted and repeated positions", () => {
    expect(highlightSegments("GATTACA", [5, 3, 3])).toEqual([
      { text: "GA", mismatch: false }, { text: "T", mismatch: true }, { text: "T", mismatch: false },
      { text: "A", mismatch: true }, { text: "CA", mismatch: false },
    ]);
  });
  it("rejects positions outside 1..length", () => {
    expect(() => highlightSegments("GATTACA", [0])).toThrow(RangeError);
    expect(() => highlightSegments("GATTACA", [8])).toThrow(RangeError);
    expect(() => highlightSegments("GATTACA", [1.5])).toThrow(RangeError);
  });
  it("returns nothing for an empty sequence, and the pieces always spell the sequence", () => {
    expect(highlightSegments("", [])).toEqual([]);
    const seq = "GATTACAGATTACAGATTAC";
    const segs = highlightSegments(seq, [3, 4, 9, 20]);
    expect(segs.map((s) => s.text).join("")).toBe(seq);
    expect(segs.filter((s) => s.mismatch).map((s) => s.text).join("")).toBe("TT" + "A" + "C");
  });
});
