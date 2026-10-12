import { useEffect, useRef, useState, type MouseEvent } from "react";
import { CANVAS_HEIGHT, drawScene, type HitItem } from "./draw";
import { hitTest, type HitRect } from "./hitTest";
import type { RegionResponse, ScoredGuide } from "./types";
import { panView, zoomView, type View } from "./viewport";

interface Props {
  view: View;
  chromLen: number;
  region: RegionResponse | null;
  scores: Map<string, ScoredGuide>;
  selectedGuideKey: string | null;
  selectedGeneName: string | null;
  onViewChange: (view: View) => void;   // called while the user pans or zooms
  onSelect: (item: HitItem) => void;    // called when the user clicks a drawn item
}

/** The canvas: draws a frame whenever something changes, and turns mouse input into pan, zoom and clicks. */
export function GenomeCanvas(props: Props) {
  const { view, chromLen, region, scores, selectedGuideKey, selectedGeneName, onViewChange, onSelect } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitsRef = useRef<HitRect<HitItem>[]>([]);   // rectangles of the last frame, for click hit-testing
  const [width, setWidth] = useState(900);          // canvas width in CSS pixels (follows the container)

  // Event handlers below outlive a render, so they read the newest values through this ref.
  const latest = useRef({ view, chromLen, width, onViewChange });
  useEffect(() => { latest.current = { view, chromLen, width, onViewChange }; });

  // ---- keep `width` equal to the container's width
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => { if (el.clientWidth > 0) setWidth(Math.floor(el.clientWidth)); };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ---- paint a frame whenever anything it depends on changes
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;                 // sharp text on high-density screens:
    canvas.width = Math.round(width * dpr);                   // the bitmap is dpr times bigger than its CSS size,
    canvas.height = Math.round(CANVAS_HEIGHT * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);                   // and drawing still uses CSS pixels
    hitsRef.current = drawScene({ ctx, width, view, region, scores, selectedGuideKey, selectedGeneName });
  }, [width, view, region, scores, selectedGuideKey, selectedGeneName]);

  // ---- mouse wheel zooms around the cursor (a native listener, so preventDefault can stop page scroll)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { view, width, chromLen, onViewChange } = latest.current;
      const x = e.clientX - canvas.getBoundingClientRect().left;
      onViewChange(zoomView(view, width, x, Math.exp(e.deltaY * 0.002), chromLen));   // scroll down zooms out
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // ---- drag to pan, click to select
  const drag = useRef<{ startX: number; startY: number; lastX: number; moved: boolean } | null>(null);
  const point = (e: MouseEvent) => {
    const box = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };

  const onMouseDown = (e: MouseEvent) => {
    const p = point(e);
    drag.current = { startX: p.x, startY: p.y, lastX: p.x, moved: false };
  };
  const onMouseMove = (e: MouseEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    if (Math.abs(p.x - d.startX) > 3 || Math.abs(p.y - d.startY) > 3) d.moved = true;   // a few pixels of wobble is still a click
    if (d.moved) {
      const { view, width, chromLen } = latest.current;
      onViewChange(panView(view, width, p.x - d.lastX, chromLen));
    }
    d.lastX = p.x;
  };
  const onMouseUp = (e: MouseEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;                    // it was a drag, not a click
    const p = point(e);
    const item = hitTest(hitsRef.current, p.x, p.y);
    if (item) onSelect(item);
  };

  return (
    <div ref={wrapRef} className="canvas-wrap">
      <canvas
        ref={canvasRef}
        style={{ width, height: CANVAS_HEIGHT }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { drag.current = null; }}
      />
    </div>
  );
}
