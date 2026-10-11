import { describe, expect, it } from "vitest";
import { hitTest, type HitRect } from "./hitTest";

const r = (x: number, y: number, width: number, height: number, item: string): HitRect<string> => ({ x, y, width, height, item });

describe("hitTest", () => {
  it("returns the item whose rectangle contains the point", () => {
    const rects = [r(10, 10, 20, 10, "a"), r(100, 10, 20, 10, "b")];
    expect(hitTest(rects, 15, 15)).toBe("a");
    expect(hitTest(rects, 110, 15)).toBe("b");
  });
  it("returns undefined when nothing is hit, and for an empty list", () => {
    expect(hitTest([r(10, 10, 20, 10, "a")], 200, 200)).toBeUndefined();
    expect(hitTest([], 5, 5)).toBeUndefined();
  });
  it("prefers the item drawn last (on top) when rectangles overlap", () => {
    const rects = [r(0, 0, 100, 100, "under"), r(40, 40, 20, 20, "over")];
    expect(hitTest(rects, 50, 50)).toBe("over");
    expect(hitTest(rects, 5, 5)).toBe("under");
  });
  it("treats the edges as inside", () => {
    const rects = [r(10, 10, 20, 10, "a")];
    expect(hitTest(rects, 10, 10, 0)).toBe("a");
    expect(hitTest(rects, 30, 20, 0)).toBe("a");
    expect(hitTest(rects, 30.01, 20, 0)).toBeUndefined();
  });
  it("pads every side by 2 pixels by default so thin features can be clicked", () => {
    const rects = [r(100, 50, 0, 10, "thin")];        // a zero-width feature
    expect(hitTest(rects, 98, 55)).toBe("thin");
    expect(hitTest(rects, 102, 55)).toBe("thin");
    expect(hitTest(rects, 100, 48)).toBe("thin");
    expect(hitTest(rects, 100, 62)).toBe("thin");
    expect(hitTest(rects, 97.9, 55)).toBeUndefined();
    expect(hitTest(rects, 102.1, 55)).toBeUndefined();
    expect(hitTest(rects, 100, 62.1)).toBeUndefined();
  });
  it("accepts a custom padding", () => {
    const rects = [r(100, 50, 0, 10, "thin")];
    expect(hitTest(rects, 105, 55, 5)).toBe("thin");
    expect(hitTest(rects, 106, 55, 5)).toBeUndefined();
  });
  it("works with negative coordinates (features left of the canvas)", () => {
    expect(hitTest([r(-50, 0, 20, 10, "left")], -40, 5)).toBe("left");
  });
});
