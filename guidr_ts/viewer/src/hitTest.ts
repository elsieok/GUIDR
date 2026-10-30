/** A rectangle drawn on the canvas this frame, with the thing it stands for. */
export interface HitRect<T> {
  x: number;
  y: number;
  width: number;
  height: number;
  item: T;
}

/**
 * Which item is under the point (px, py)?
 *  - `rects` are in the order they were drawn, so the LAST one is on top: scan from the end and
 *    return the first hit.
 *  - A point hits a rectangle if it is inside it OR within `pad` pixels of it on any side, and the
 *    edges count as inside. (The padding is what makes a 1-pixel-wide feature clickable.)
 *  - Return undefined if nothing is hit.
 */
export function hitTest<T>(rects: HitRect<T>[], px: number, py: number, pad = 2): T | undefined {
   for (let i = rects.length - 1; i >= 0; i--) {
    const rect = rects[i];

    if (
      px >= rect.x - pad &&
      px <= rect.x + rect.width + pad &&
      py >= rect.y - pad &&
      py <= rect.y + rect.height + pad
    ) return rect.item;
  }

  return undefined;
}
