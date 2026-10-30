/**
 * Viewport math for the genome viewer (M4). Pure functions: no React, no canvas, no network.
 *
 * Conventions:
 *  - A View is 0-based and half-open: [start, end), measured in genome letters. While the user drags
 *    or zooms, start and end may hold fractions; they are rounded only when talking to the API.
 *  - The API speaks 1-based INCLUSIVE integers (a feature's start and end as returned by the server).
 *  - `width` is the canvas width in CSS pixels (scale the canvas backing store for devicePixelRatio
 *    elsewhere; keep this math in CSS pixels).
 */

export interface View {
  start: number;
  end: number;
}

export const MIN_VIEW_LENGTH = 50;      // never zoom in closer than this many letters
export const GUIDE_MODE_LIMIT = 5000;   // the server returns guides up to this request length, bins above it

/** end - start. */
export function viewLength(v: View): number {
  return v.end - v.start;
}

/** Letters per pixel: viewLength / width. */
export function basesPerPixel(v: View, width: number): number {
  return viewLength(v) / width;
}

/** Pixel x (from the canvas's left edge) of a 0-based genome position. */
export function posToX(v: View, width: number, pos: number): number {
  return (pos - v.start) / basesPerPixel(v, width);
}

/** Genome position (0-based) under pixel x. The inverse of posToX. */
export function xToPos(v: View, width: number, x: number): number {
  return v.start + x * basesPerPixel(v, width);
}

/**
 * Keep the view inside [0, chromLen] without changing its length: shift it back inside.
 * If the view is longer than the chromosome, return the whole chromosome {0, chromLen}.
 */
export function clampView(v: View, chromLen: number): View {
  const len = viewLength(v);

  if (len > chromLen) {
    return { start: 0, end: chromLen };
  }

  let start = v.start;
  let end = v.end;

  if (start < 0) {
    start = 0;
    end = len;
  }

  if (end > chromLen) {
    end = chromLen;
    start = chromLen - len;
  }

  return { start, end };
}

/**
 * Drag by dx pixels: the view moves OPPOSITE to the drag (drag right shows what is to the left).
 * The length is unchanged; the result is clamped to the chromosome.
 */
export function panView(v: View, width: number, dx: number, chromLen: number): View {
  const shift = dx * basesPerPixel(v, width);
  
  return clampView(
    {
      start: v.start - shift,
      end: v.end - shift,
    },
    chromLen,
  );
}

/**
 * Zoom by `factor` (below 1 zooms in, above 1 zooms out) around pixel x, so the letter under
 * the cursor stays under the cursor. The new length is limited to
 * [min(MIN_VIEW_LENGTH, chromLen), chromLen]; the result is clamped to the chromosome.
 */
export function zoomView(v: View, width: number, x: number, factor: number, chromLen: number): View {
  const oldLength = viewLength(v);
  const cursorPos = xToPos(v, width, x);

  const minLength = Math.min(MIN_VIEW_LENGTH, chromLen);
  const newLength = Math.min(
    chromLen,
    Math.max(minLength, oldLength * factor),
  );

  // Preserve the fraction of the new view lying to the left of the cursor.
  const cursorFraction = (cursorPos - v.start) / oldLength;
  const start = cursorPos - cursorFraction * newLength;

  return clampView(
    {
      start,
      end: start + newLength,
    },
    chromLen,
  );
}

/** API (1-based inclusive) start and end to a View [start - 1, end). */
export function apiToInternal(start1: number, end1: number): View {
  return {
    start: start1 - 1,
    end: end1,
  };
}

/**
 * A View to API coordinates: start = floor(view.start) + 1, end = ceil(view.end).
 * Rounds a fractional view OUTWARD so the request always covers what is on screen.
 */
export function internalToApi(v: View): { start: number; end: number } {
  return {
    start: Math.floor(v.start) + 1,
    end: Math.ceil(v.end),
  };
}

/**
 * Pixel rectangle (x and width) of a feature given in API coordinates.
 * x is not clipped (it can be negative or past the canvas). The width is at least minWidthPx
 * so tiny features stay visible.
 */
export function featureRect(
  v: View, width: number, apiStart: number, apiEnd: number, minWidthPx = 1,
): { x: number; width: number } {
  const start = apiStart - 1;
  const end = apiEnd;

  const x = posToX(v, width, start);
  const featureWidth = posToX(v, width, end) - x;

  return {
    x,
    width: Math.max(minWidthPx, featureWidth),
  };
}

/**
 * "guides" if the view's API window (internalToApi) is at most GUIDE_MODE_LIMIT letters long,
 * otherwise "bins". Must agree with how the server chooses its mode for a request.
 */
export function displayMode(v: View): "guides" | "bins" {
  const { start, end } = internalToApi(v);
  const len = end - start + 1;

  return len <= GUIDE_MODE_LIMIT ? "guides" : "bins";
}

/**
 * The window to ask /regions for (API coordinates, 1-based inclusive, integers):
 *  1. Start from the view's API window (internalToApi); call its length `len`.
 *  2. Pad both sides by 25% of len, rounded down. But if the view is in "guides" mode
 *     (len <= GUIDE_MODE_LIMIT), cap the padding at floor((GUIDE_MODE_LIMIT - len) / 2) so the
 *     request stays in guides mode.
 *  3. Clamp to [1, chromLen].
 *  4. Round OUTWARD to the grid: start becomes floor((start - 1) / grid) * grid + 1, end becomes
 *     ceil(end / grid) * grid (end not above chromLen), so nearby pans reuse the same request.
 *  5. Exception: in "guides" mode, if that rounded window is longer than GUIDE_MODE_LIMIT,
 *     return the padded (step 3) window instead.
 * The result always covers the view, and its length is at most GUIDE_MODE_LIMIT exactly when the
 * view is in "guides" mode.
 */
export function requestWindow(v: View, chromLen: number, grid = 500): { start: number; end: number } {
  const api = internalToApi(v);
  const len = api.end - api.start + 1;
  const guides = len <= GUIDE_MODE_LIMIT;

  let padding = Math.floor(len * 0.25);

  if (guides) {
    padding = Math.min(
      padding,
      Math.floor((GUIDE_MODE_LIMIT - len) / 2),
    );
  }

  // Step 3: pad, then clamp to the chromosome.
  const paddedStart = Math.max(1, api.start - padding);
  const paddedEnd = Math.min(chromLen, api.end + padding);

  // Step 4: round outward to the reuse grid.
  const roundedStart =
    Math.floor((paddedStart - 1) / grid) * grid + 1;
  const roundedEnd =
    Math.min(chromLen, Math.ceil(paddedEnd / grid) * grid);

  // Step 5: guides must not accidentally become bins because of grid rounding.
  if (
    guides &&
    roundedEnd - roundedStart + 1 > GUIDE_MODE_LIMIT
  ) {
    return {
      start: paddedStart,
      end: paddedEnd,
    };
  }

  return {
    start: roundedStart,
    end: roundedEnd,
  };
}

/**
 * The view for "jump to this site": centered on the middle of the site (API coordinates), with
 * the given length (default 200), but never shorter than min(MIN_VIEW_LENGTH, chromLen) nor longer
 * than the chromosome, and clamped to the chromosome.
 */
export function centerOn(chromLen: number, apiStart: number, apiEnd: number, length = 200): View {
  const viewLengthTarget = Math.min(
    chromLen,
    Math.max(Math.min(MIN_VIEW_LENGTH, chromLen), length),
  );

  // Convert the site's API-coordinate midpoint to the midpoint of its
  // corresponding 0-based half-open interval [apiStart - 1, apiEnd).
  const center = (apiStart - 1 + apiEnd) / 2;

  return clampView(
    {
      start: center - viewLengthTarget / 2,
      end: center + viewLengthTarget / 2,
    },
    chromLen,
  );
}
