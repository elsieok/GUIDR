import { describe, expect, it } from "vitest";
import { BUCKET_COLORS, binAlpha, scoreBucket, scoreColor } from "./scoreColor";

describe("scoreBucket", () => {
  it("95 and above is good", () => {
    expect(scoreBucket(100)).toBe("good");
    expect(scoreBucket(95)).toBe("good");
  });
  it("70 up to 95 is caution", () => {
    expect(scoreBucket(94.99)).toBe("caution");
    expect(scoreBucket(70)).toBe("caution");
  });
  it("below 70 is poor", () => {
    expect(scoreBucket(69.99)).toBe("poor");
    expect(scoreBucket(0)).toBe("poor");
  });
  it("matches the scores the real scoring rule produces", () => {
    expect(scoreBucket(99.74)).toBe("good");      // three mismatches next to the PAM
    expect(scoreBucket(57.5)).toBe("poor");       // three mismatches at the far end
    expect(scoreBucket(85)).toBe("caution");
  });
});

describe("scoreColor", () => {
  it("uses the color of the bucket", () => {
    expect(scoreColor(100)).toBe(BUCKET_COLORS.good);
    expect(scoreColor(80)).toBe(BUCKET_COLORS.caution);
    expect(scoreColor(10)).toBe(BUCKET_COLORS.poor);
  });
  it("uses three different colors", () => {
    expect(new Set(Object.values(BUCKET_COLORS)).size).toBe(3);
  });
});

describe("binAlpha", () => {
  it("is 0 for an empty bin or when there is nothing to scale against", () => {
    expect(binAlpha(0, 10)).toBe(0);
    expect(binAlpha(5, 0)).toBe(0);
    expect(binAlpha(-1, 10)).toBe(0);
  });
  it("runs from 0.15 for a tiny count to 1 for the busiest bin", () => {
    expect(binAlpha(10, 10)).toBeCloseTo(1);
    expect(binAlpha(1, 1000)).toBeCloseTo(0.15 + 0.85 / 1000);
    expect(binAlpha(5, 10)).toBeCloseTo(0.575);
  });
  it("never goes above 1 and grows with the count", () => {
    expect(binAlpha(50, 10)).toBeCloseTo(1);
    expect(binAlpha(3, 10)).toBeLessThan(binAlpha(4, 10));
  });
});
