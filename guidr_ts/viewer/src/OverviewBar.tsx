import type { MouseEvent } from "react";
import { clampView, viewLength, type View } from "./viewport";

interface Props {
  view: View;
  chromLen: number;
  onViewChange: (view: View) => void;
}

/** The whole chromosome as a bar, with a box showing what the main canvas currently displays. Click to jump. */
export function OverviewBar({ view, chromLen, onViewChange }: Props) {
  const left = (view.start / chromLen) * 100;
  const boxWidth = Math.max(0.4, (viewLength(view) / chromLen) * 100);   // never thinner than a sliver

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const center = ((e.clientX - box.left) / box.width) * chromLen;   // where on the chromosome was clicked
    const half = viewLength(view) / 2;
    onViewChange(clampView({ start: center - half, end: center + half }, chromLen));   // same zoom, new center
  };

  return (
    <div className="overview" onClick={onClick} title="Click to jump">
      <div className="overview-box" style={{ left: `${left}%`, width: `${boxWidth}%` }} />
    </div>
  );
}
