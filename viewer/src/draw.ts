/**
 * Everything that paints on the canvas. No React in here: a function takes a 2D context plus the
 * current state, paints one frame, and returns the rectangles it drew (for click hit-testing).
 *
 * All x positions come from the viewport math (viewport.ts); all y positions come from LAYOUT.
 */
import type { HitRect } from "./hitTest";
import { binAlpha, scoreColor, UNSCORED_COLOR } from "./scoreColor";
import { niceTicks } from "./ticks";
import type { Gene, RegionResponse, ScoredGuide, Site } from "./types";
import { featureRect, posToX, type View } from "./viewport";

/** What a drawn rectangle stands for. */
export type HitItem =
  | { type: "gene"; gene: Gene }
  | { type: "guide"; site: Site }
  | { type: "bin"; start: number; end: number };

export const CANVAS_HEIGHT = 240;

// Vertical layout in CSS pixels, top to bottom: ruler, genes (+ strand row, - strand row), then guides or bins.
export const LAYOUT = {
  rulerHeight: 30,
  genePlusY: 44,
  geneMinusY: 66,
  geneHeight: 16,
  binsY: 110,
  binsHeight: 70,
  guideCenterY: 145,   // the thin line the guide rows sit on: + strand above it, - strand below it
  guideHeight: 16,
} as const;

export const GENE_COLORS = { "+": "#4c78a8", "-": "#e08a3c" } as const;
const BIN_RGB = "31, 119, 180";
const GUIDE_MIN_WIDTH = 3;   // keep guides visible when zoomed out

/** The key that identifies a site, used to look up its score: "chrom:start:strand" (API coordinates). */
export function siteKey(s: { chrom: string; start: number; strand: string }): string {
  return `${s.chrom}:${s.start}:${s.strand}`;
}

export interface DrawInput {
  ctx: CanvasRenderingContext2D;
  width: number;                         // canvas width in CSS pixels
  view: View;
  region: RegionResponse | null;         // what the server last sent; null before the first answer
  scores: Map<string, ScoredGuide>;      // scores learned so far, by siteKey
  selectedGuideKey: string | null;
  selectedGeneName: string | null;
}

/** The y where a guide of this strand is drawn. */
export function guideY(strand: string): number {
  return strand === "+" ? LAYOUT.guideCenterY - LAYOUT.guideHeight - 2 : LAYOUT.guideCenterY + 2;
}

export function drawScene(input: DrawInput): HitRect<HitItem>[] {
  const { ctx, width, view, region, scores, selectedGuideKey, selectedGeneName } = input;
  const hits: HitRect<HitItem>[] = [];   // in draw order: later entries are on top

  ctx.clearRect(0, 0, width, CANVAS_HEIGHT);
  drawRuler(ctx, width, view);

  if (!region) {
    ctx.fillStyle = "#666";
    ctx.font = "14px sans-serif";
    ctx.fillText("Loading…", 12, LAYOUT.binsY);
    return hits;
  }

  // ---- genes: one row per strand
  ctx.font = "11px sans-serif";
  for (const gene of region.genes) {
    const r = featureRect(view, width, gene.start, gene.end, 1);
    if (r.x + r.width < 0 || r.x > width) continue;            // off screen
    const y = gene.strand === "+" ? LAYOUT.genePlusY : LAYOUT.geneMinusY;
    ctx.fillStyle = GENE_COLORS[gene.strand];
    ctx.fillRect(r.x, y, r.width, LAYOUT.geneHeight);
    if (gene.name === selectedGeneName) {
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x, y, r.width, LAYOUT.geneHeight);
    }
    if (ctx.measureText(gene.name).width + 8 <= r.width) {     // label only if it fits inside the gene
      ctx.fillStyle = "#fff";
      ctx.fillText(gene.name, r.x + 4, y + 12);
    }
    hits.push({ x: r.x, y, width: r.width, height: LAYOUT.geneHeight, item: { type: "gene", gene } });
  }

  if (region.mode === "bins") {
    // ---- wide view: a bar per bin, darker = more guides
    const maxCount = Math.max(0, ...region.bins.map((b) => b.count));
    for (const bin of region.bins) {
      const r = featureRect(view, width, bin.start, bin.end, 1);
      if (r.x + r.width < 0 || r.x > width) continue;
      const alpha = binAlpha(bin.count, maxCount);
      if (alpha > 0) {
        ctx.fillStyle = `rgba(${BIN_RGB}, ${alpha})`;
        ctx.fillRect(r.x, LAYOUT.binsY, r.width, LAYOUT.binsHeight);
      }
      hits.push({ x: r.x, y: LAYOUT.binsY, width: r.width, height: LAYOUT.binsHeight, item: { type: "bin", start: bin.start, end: bin.end } });
    }
  } else {
    // ---- narrow view: one rectangle per guide, + strand above the center line, - strand below
    ctx.strokeStyle = "#bbb";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, LAYOUT.guideCenterY);
    ctx.lineTo(width, LAYOUT.guideCenterY);
    ctx.stroke();
    for (const site of region.guides) {
      const r = featureRect(view, width, site.start, site.end, GUIDE_MIN_WIDTH);
      if (r.x + r.width < 0 || r.x > width) continue;
      const key = siteKey(site);
      const scored = scores.get(key);
      const y = guideY(site.strand);
      ctx.fillStyle = scored ? scoreColor(scored.score) : UNSCORED_COLOR;
      ctx.fillRect(r.x, y, r.width, LAYOUT.guideHeight);
      if (key === selectedGuideKey) {
        ctx.strokeStyle = "#111";
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x, y, r.width, LAYOUT.guideHeight);
      }
      hits.push({ x: r.x, y, width: r.width, height: LAYOUT.guideHeight, item: { type: "guide", site } });
    }
  }
  return hits;
}

function drawRuler(ctx: CanvasRenderingContext2D, width: number, view: View): void {
  ctx.strokeStyle = "#444";
  ctx.fillStyle = "#444";
  ctx.lineWidth = 1;
  ctx.font = "11px sans-serif";
  ctx.beginPath();
  ctx.moveTo(0, LAYOUT.rulerHeight - 1);
  ctx.lineTo(width, LAYOUT.rulerHeight - 1);
  for (const tick of niceTicks(view)) {
    const x = posToX(view, width, tick.pos);
    if (x < 0 || x > width) continue;
    ctx.moveTo(x, LAYOUT.rulerHeight - 1);
    ctx.lineTo(x, LAYOUT.rulerHeight - 7);
    ctx.fillText(tick.label, x + 3, 14);
  }
  ctx.stroke();
}
