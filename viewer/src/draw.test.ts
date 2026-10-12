import { describe, expect, it } from "vitest";
import { GENE_COLORS, LAYOUT, drawScene, guideY, siteKey } from "./draw";
import { BUCKET_COLORS, UNSCORED_COLOR, scoreColor } from "./scoreColor";
import type { Gene, RegionResponse, ScoredGuide, Site } from "./types";
import { featureRect } from "./viewport";

// A fake canvas context that records every filled rectangle and its color.
function recorder() {
  const fills: { style: string; x: number; y: number; w: number; h: number }[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop === "fillRect") return (x: number, y: number, w: number, h: number) => fills.push({ style: String(target.fillStyle), x, y, w, h });
      if (prop === "measureText") return () => ({ width: 0 });
      return prop in target ? target[prop] : () => undefined;
    },
    set(target, prop: string, value) { target[prop] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, fills };
}

const view = { start: 0, end: 1000 };
const W = 1000;
const site = (start: number, strand: "+" | "-" = "+"): Site => ({ chrom: "c", start, end: start + 22, strand, protospacer: "A".repeat(20), pam: "TGG" });
const geneP: Gene = { name: "geneP", chrom: "c", start: 101, end: 400, strand: "+" };
const geneM: Gene = { name: "geneM", chrom: "c", start: 501, end: 800, strand: "-" };
const guidesRegion = (guides: Site[]): RegionResponse => ({ chrom: "c", start: 1, end: 1000, genes: [geneP, geneM], mode: "guides", guides });

const draw = (region: RegionResponse | null, scores = new Map<string, ScoredGuide>(), selectedGuideKey: string | null = null) => {
  const { ctx, fills } = recorder();
  const hits = drawScene({ ctx, width: W, view, region, scores, selectedGuideKey, selectedGeneName: null });
  return { hits, fills };
};

describe("siteKey", () => {
  it("is chrom:start:strand in API coordinates", () => {
    expect(siteKey(site(101, "-"))).toBe("c:101:-");
  });
});

describe("drawScene", () => {
  it("draws nothing clickable before the first answer arrives", () => {
    expect(draw(null).hits).toEqual([]);
  });

  it("draws genes on their strand's row, in the strand's color, and makes them clickable", () => {
    const { hits, fills } = draw(guidesRegion([]));
    const p = hits.find((h) => h.item.type === "gene" && h.item.gene.name === "geneP")!;
    const m = hits.find((h) => h.item.type === "gene" && h.item.gene.name === "geneM")!;
    const rect = featureRect(view, W, 101, 400, 1);
    expect([p.x, p.width, p.y]).toEqual([rect.x, rect.width, LAYOUT.genePlusY]);
    expect(m.y).toBe(LAYOUT.geneMinusY);
    expect(fills.find((f) => f.y === LAYOUT.genePlusY)?.style).toBe(GENE_COLORS["+"]);
    expect(fills.find((f) => f.y === LAYOUT.geneMinusY)?.style).toBe(GENE_COLORS["-"]);
  });

  it("draws unscored guides in the neutral color, + strand above the center line and - strand below", () => {
    const { hits, fills } = draw(guidesRegion([site(101, "+"), site(301, "-")]));
    const guides = hits.filter((h) => h.item.type === "guide");
    expect(guides).toHaveLength(2);
    const plus = guides.find((h) => h.item.type === "guide" && h.item.site.strand === "+")!;
    const minus = guides.find((h) => h.item.type === "guide" && h.item.site.strand === "-")!;
    const r = featureRect(view, W, 101, 123, 3);
    expect([plus.x, plus.width, plus.y]).toEqual([r.x, r.width, guideY("+")]);
    expect(plus.y + LAYOUT.guideHeight).toBeLessThan(LAYOUT.guideCenterY);
    expect(minus.y).toBeGreaterThan(LAYOUT.guideCenterY);
    const guideFills = fills.filter((f) => f.y === guideY("+") || f.y === guideY("-"));
    expect(guideFills.every((f) => f.style === UNSCORED_COLOR)).toBe(true);
  });

  it("colors a guide by its score once it is known", () => {
    const g = site(101);
    const scores = new Map([[siteKey(g), { ...g, score: 99, risk: 1, profile: [0, 0, 0, 0] }]]);
    const { fills } = draw(guidesRegion([g]), scores);
    expect(fills.find((f) => f.y === guideY("+"))?.style).toBe(scoreColor(99));
    expect(scoreColor(99)).toBe(BUCKET_COLORS.good);
  });

  it("keeps a tiny guide at least 3 pixels wide, and skips guides that are off screen", () => {
    const zoomedOut = { start: 0, end: 1_000_000 };
    const { ctx } = recorder();
    const hits = drawScene({ ctx, width: W, view: zoomedOut, region: guidesRegion([site(101), site(2_000_000)]), scores: new Map(), selectedGuideKey: null, selectedGeneName: null });
    const guides = hits.filter((h) => h.item.type === "guide");
    expect(guides).toHaveLength(1);
    expect(guides[0].width).toBe(3);
  });

  it("puts guides after genes in the hit list, so a guide is on top of what is under it", () => {
    const { hits } = draw(guidesRegion([site(101)]));
    const lastGene = hits.map((h) => h.item.type).lastIndexOf("gene");
    const firstGuide = hits.map((h) => h.item.type).indexOf("guide");
    expect(firstGuide).toBeGreaterThan(lastGene);
  });

  it("draws bins darker when they hold more guides, and nothing for empty bins", () => {
    const region: RegionResponse = {
      chrom: "c", start: 1, end: 1000, genes: [], mode: "bins",
      bins: [{ start: 1, end: 100, count: 0 }, { start: 101, end: 200, count: 5 }, { start: 201, end: 300, count: 10 }],
    };
    const { hits, fills } = draw(region);
    const bins = hits.filter((h) => h.item.type === "bin");
    expect(bins).toHaveLength(3);                                    // every bin can be clicked, even an empty one
    expect(bins[1].item).toEqual({ type: "bin", start: 101, end: 200 });
    const binFills = fills.filter((f) => f.y === LAYOUT.binsY);
    expect(binFills).toHaveLength(2);                                // the empty bin is not painted
    expect(binFills[1].style).toBe("rgba(31, 119, 180, 1)");         // the busiest bin is fully opaque
    expect(binFills[0].style).toBe("rgba(31, 119, 180, 0.575)");
  });
});
