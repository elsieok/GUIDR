import { internalToApi, viewLength, type View } from "./viewport";

export interface Tick {
  /** 0-based position of the left edge of the base: ready to pass to posToX. */
  pos: number;
  /** The 1-based genome position, formatted with thousands separators (for example "1,200"). */
  label: string;
}

/** 1234567 -> "1,234,567". Round to an integer first. (Do not rely on toLocaleString: do it yourself.) */
export function formatPosition(n: number): string {
  if (n < 0) {
    throw new RangeError("n must be positive");
  }
  const int = Math.round(n);
  const digits = String(Math.abs(int));
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * A "nice" distance between ruler ticks: the smallest of 1, 2 or 5 times a power of ten that is at
 * least viewLen / targetTicks. Examples: tickStep(1000, 8) = 200 (125 wanted); tickStep(400, 8) = 50
 * (exactly 50 wanted); tickStep(4_641_652, 8) = 1_000_000. Never less than 1.
 * Throw a RangeError if viewLen or targetTicks is not positive.
 * Hint: raw = viewLen / targetTicks; mag = 10 ** Math.floor(Math.log10(raw)); try 1, 2, 5, 10 times mag.
 */
export function tickStep(viewLen: number, targetTicks = 8): number {
  if (viewLen <= 0 ) {
    throw new RangeError("viewLen must be greater than 0");
  }

  if (targetTicks <= 0) {
    throw new RangeError("targetTicks must be greater than 0");
  }

  const distance = viewLen / targetTicks;

  if (distance <= 1) {
    return 1;
  }

  const mag = 10 ** Math.floor(Math.log10(distance));

  for (const multiplier of [1, 2, 5, 10]) {
    const candidate = multiplier * mag;

    if (candidate >= distance) {
      return candidate;
    }
  }
  
  return 10 * mag;
}

/**
 * Ticks for a view. The step is tickStep(viewLength(v), targetTicks). Work in 1-based coordinates:
 * with { start, end } = internalToApi(v), the ticks are every multiple p of the step with
 * start <= p <= end (the first is ceil(start / step) * step). Each tick is
 * { pos: p - 1, label: formatPosition(p) }.
 */
export function niceTicks(v: View, targetTicks = 8): Tick[] {
  const ticks: Tick[] = [];
  const step = tickStep(viewLength(v), targetTicks);
  const { start, end } = internalToApi(v);
  let p = Math.ceil(start / step) * step;

  while (p <= end) {
    ticks.push({
      pos: p - 1,
      label: formatPosition(p),
    });
    p += step;
  }
  return ticks;
}
