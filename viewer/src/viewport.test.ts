import { describe, expect, it } from "vitest";
import {
  GUIDE_MODE_LIMIT,
  MIN_VIEW_LENGTH,
  apiToInternal,
  basesPerPixel,
  centerOn,
  clampView,
  displayMode,
  featureRect,
  internalToApi,
  panView,
  posToX,
  requestWindow,
  viewLength,
  xToPos,
  zoomView,
} from "./viewport";

// Conventions under test: a View is 0-based, half-open [start, end), in genome letters,
// and may hold fractions while the user drags. The API speaks 1-based inclusive integers.
const CHROM = 4_641_652;

function seeded(seed: number) {            // small deterministic random generator (mulberry32)
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("pixel and position conversion", () => {
  it("computes bases per pixel", () => {
    expect(basesPerPixel({ start: 0, end: 1000 }, 500)).toBe(2);
    expect(viewLength({ start: 100, end: 350 })).toBe(250);
  });

  it("maps positions to pixels and back (known values)", () => {
    const v = { start: 100, end: 300 };                 // 0.5 bases per pixel at width 400
    expect(posToX(v, 400, 200)).toBeCloseTo(200);
    expect(posToX(v, 400, 100)).toBeCloseTo(0);
    expect(xToPos(v, 400, 0)).toBeCloseTo(100);
    expect(xToPos(v, 400, 400)).toBeCloseTo(300);
  });

  it("round-trips for arbitrary views", () => {
    const rnd = seeded(1);
    for (let i = 0; i < 200; i++) {
      const start = rnd() * 1e6;
      const v = { start, end: start + 50 + rnd() * 1e5 };
      const width = 200 + Math.floor(rnd() * 1500);
      const pos = start + rnd() * viewLength(v);
      expect(xToPos(v, width, posToX(v, width, pos))).toBeCloseTo(pos, 6);
    }
  });
});

describe("clampView", () => {
  it("leaves an inside view alone", () => {
    expect(clampView({ start: 100, end: 600 }, CHROM)).toEqual({ start: 100, end: 600 });
  });
  it("shifts a view that sticks out on the left or right, keeping its length", () => {
    expect(clampView({ start: -30, end: 470 }, CHROM)).toEqual({ start: 0, end: 500 });
    expect(clampView({ start: CHROM - 100, end: CHROM + 400 }, CHROM)).toEqual({ start: CHROM - 500, end: CHROM });
  });
  it("shows the whole chromosome when the view is longer than it", () => {
    expect(clampView({ start: -5, end: CHROM * 2 }, CHROM)).toEqual({ start: 0, end: CHROM });
  });
});

describe("panView", () => {
  it("moves the view opposite to the drag, keeping its length", () => {
    const v = { start: 1000, end: 2000 };                // 2 bases per pixel at width 500
    expect(panView(v, 500, 100, CHROM)).toEqual({ start: 800, end: 1800 });
    expect(panView(v, 500, -100, CHROM)).toEqual({ start: 1200, end: 2200 });
  });
  it("stops at both ends of the chromosome", () => {
    expect(panView({ start: 0, end: 1000 }, 500, 50, CHROM)).toEqual({ start: 0, end: 1000 });
    expect(panView({ start: CHROM - 1000, end: CHROM }, 500, -50, CHROM)).toEqual({ start: CHROM - 1000, end: CHROM });
  });
});

describe("zoomView", () => {
  it("zooms in around the cursor (known values)", () => {
    const v = { start: 0, end: 1000 };
    expect(zoomView(v, 1000, 500, 0.5, CHROM)).toEqual({ start: 250, end: 750 });
    expect(zoomView(v, 1000, 0, 0.5, CHROM)).toEqual({ start: 0, end: 500 });
    expect(zoomView(v, 1000, 1000, 0.5, CHROM)).toEqual({ start: 500, end: 1000 });
  });
  it("keeps the base under the cursor fixed", () => {
    const rnd = seeded(2);
    for (let i = 0; i < 200; i++) {
      const length = 1000 + rnd() * 50_000;
      const start = 1_000_000 + rnd() * 1_000_000;      // far from both chromosome ends
      const v = { start, end: start + length };
      const width = 400 + Math.floor(rnd() * 1200);
      const x = rnd() * width;
      const factor = rnd() < 0.5 ? 0.5 + rnd() * 0.4 : 1.1 + rnd() * 0.5;
      const z = zoomView(v, width, x, factor, CHROM);
      expect(xToPos(z, width, x)).toBeCloseTo(xToPos(v, width, x), 4);
      expect(viewLength(z)).toBeCloseTo(length * factor, 4);
    }
  });
  it("never zooms in past the minimum length", () => {
    const z = zoomView({ start: 100, end: 160 }, 600, 300, 0.1, CHROM);
    expect(viewLength(z)).toBe(MIN_VIEW_LENGTH);
    expect(z).toEqual({ start: 105, end: 155 });
  });
  it("never zooms out past the chromosome and stays inside it", () => {
    expect(zoomView({ start: 0, end: CHROM }, 800, 300, 2, CHROM)).toEqual({ start: 0, end: CHROM });
    expect(zoomView({ start: 0, end: 1000 }, 1000, 0, 2, CHROM)).toEqual({ start: 0, end: 2000 });
    expect(zoomView({ start: 0, end: 1000 }, 1000, 500, 2, CHROM)).toEqual({ start: 0, end: 2000 });
  });
});

describe("API coordinates (1-based inclusive) and the view (0-based half-open)", () => {
  it("converts both ways", () => {
    expect(apiToInternal(1, 10)).toEqual({ start: 0, end: 10 });
    expect(apiToInternal(101, 123)).toEqual({ start: 100, end: 123 });
    expect(internalToApi({ start: 0, end: 10 })).toEqual({ start: 1, end: 10 });
  });
  it("rounds a fractional view outward so the request covers it", () => {
    expect(internalToApi({ start: 0.5, end: 10.2 })).toEqual({ start: 1, end: 11 });
    expect(internalToApi({ start: 99.9, end: 200 })).toEqual({ start: 100, end: 200 });
  });
  it("round-trips integer coordinates", () => {
    for (const [a, b] of [[1, 23], [363231, 366305], [4_641_630, CHROM]]) {
      expect(internalToApi(apiToInternal(a, b))).toEqual({ start: a, end: b });
    }
  });
});

describe("featureRect", () => {
  it("draws a 23-letter site at the right pixel and width", () => {
    const r = featureRect({ start: 0, end: 1000 }, 1000, 101, 123);
    expect(r.x).toBeCloseTo(100);
    expect(r.width).toBeCloseTo(23);
  });
  it("keeps tiny features visible, with a configurable minimum", () => {
    const v = { start: 0, end: 1_000_000 };
    expect(featureRect(v, 1000, 101, 123).width).toBe(1);
    expect(featureRect(v, 1000, 101, 123, 3).width).toBe(3);
  });
  it("does not clip features that start left of the view", () => {
    const r = featureRect({ start: 500, end: 1500 }, 1000, 401, 600);
    expect(r.x).toBeCloseTo(-100);
    expect(r.width).toBeCloseTo(200);
  });
});

describe("displayMode (must agree with the server's 5,000-letter switch)", () => {
  it("uses guides up to 5,000 letters and bins above", () => {
    expect(GUIDE_MODE_LIMIT).toBe(5000);
    expect(displayMode({ start: 0, end: 5000 })).toBe("guides");
    expect(displayMode({ start: 0, end: 5001 })).toBe("bins");
  });
  it("judges a fractional view by the API window it would request", () => {
    expect(displayMode({ start: 0.5, end: 5000.5 })).toBe("bins");   // requests 1..5001
  });
});

describe("requestWindow", () => {
  it("pads by 25% and rounds outward to the grid", () => {
    expect(requestWindow({ start: 1234.2, end: 2234.7 }, CHROM)).toEqual({ start: 501, end: 2500 });
    expect(requestWindow({ start: 100_000, end: 300_000 }, CHROM)).toEqual({ start: 50_001, end: 350_000 });
  });
  it("stays inside the chromosome near its ends", () => {
    expect(requestWindow({ start: 0, end: 800 }, CHROM)).toEqual({ start: 1, end: 1000 });
    const w = requestWindow({ start: CHROM - 652, end: CHROM }, CHROM);
    expect(w.end).toBe(CHROM);
    expect(w.start).toBeLessThan(CHROM - 652 + 1);
  });
  it("shrinks the padding so a nearly-5,000 view still asks for guides", () => {
    // 25% padding would give a 6,000+ letter request and flip the server into bins.
    expect(requestWindow({ start: 10_000, end: 14_990 }, CHROM)).toEqual({ start: 9996, end: 14_995 });
  });
  it("holds its invariants for many views", () => {
    const rnd = seeded(3);
    const lengths = [60, 500, 3000, 4000, 4900, 4999, 5000, 5001, 6000, 12_000, 250_000];
    for (let i = 0; i < 400; i++) {
      const length = lengths[Math.floor(rnd() * lengths.length)];
      const start = rnd() * (CHROM - length);
      const view = { start, end: start + length };
      const w = requestWindow(view, CHROM);
      const needed = internalToApi(view);
      const requested = w.end - w.start + 1;
      expect(Number.isInteger(w.start) && Number.isInteger(w.end)).toBe(true);
      expect(w.start).toBeGreaterThanOrEqual(1);
      expect(w.end).toBeLessThanOrEqual(CHROM);
      expect(w.start).toBeLessThanOrEqual(needed.start);          // covers the whole view
      expect(w.end).toBeGreaterThanOrEqual(needed.end);
      if (displayMode(view) === "guides") expect(requested).toBeLessThanOrEqual(GUIDE_MODE_LIMIT);
      else expect(requested).toBeGreaterThan(GUIDE_MODE_LIMIT);   // the server must return bins
    }
  });
  it("works on a chromosome shorter than the guide limit", () => {
    expect(requestWindow({ start: 0, end: 3000 }, 3000)).toEqual({ start: 1, end: 3000 });
  });
});

describe("centerOn (jump to an off-target)", () => {
  it("centers a 23-letter site in a 200-letter view", () => {
    const v = centerOn(CHROM, 1001, 1023);
    expect(v.start).toBeCloseTo(911.5);
    expect(v.end).toBeCloseTo(1111.5);
  });
  it("clamps at both ends of the chromosome", () => {
    expect(centerOn(CHROM, 1, 23)).toEqual({ start: 0, end: 200 });
    expect(centerOn(CHROM, CHROM - 22, CHROM)).toEqual({ start: CHROM - 200, end: CHROM });
  });
  it("never uses a view shorter than the minimum", () => {
    const v = centerOn(CHROM, 1001, 1023, 10);
    expect(viewLength(v)).toBe(MIN_VIEW_LENGTH);
    expect((v.start + v.end) / 2).toBeCloseTo(1011.5);
  });
});
