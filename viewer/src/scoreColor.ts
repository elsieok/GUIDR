export type ScoreBucket = "good" | "caution" | "poor";

// Given: colors for the three buckets, and a neutral color for guides that have no score.
export const BUCKET_COLORS: Record<ScoreBucket, string> = { good: "#2a9d8f", caution: "#e9c46a", poor: "#d1495b" };
export const UNSCORED_COLOR = "#8fa3ad";

/**
 * The guide score (0 to 100, higher is safer) as a bucket:
 *   95 or more -> "good"   (no, or negligible, off-targets found)
 *   70 up to (not including) 95 -> "caution"
 *   below 70 -> "poor"
 */
export function scoreBucket(score: number): ScoreBucket {
  if (95 <= score && score <= 100) {
    return "good";
  } else if (70 <= score && score < 95) {
    return "caution";
  } else if (0 <= score && score < 70) {
    return "poor";
  }

  throw new RangeError(`Invalid score: ${score}`);
}

/** The color for a score: BUCKET_COLORS of its bucket. */
export function scoreColor(score: number): string {
  try {
    return BUCKET_COLORS[scoreBucket(score)];
  } catch {
    return UNSCORED_COLOR;
  }
}

/**
 * Opacity for a bin of `count` guides when the busiest bin in view has `maxCount`:
 *   0 if count <= 0 or maxCount <= 0 (nothing to draw);
 *   otherwise 0.15 + 0.85 * min(1, count / maxCount), so any non-empty bin is visible and the
 *   busiest is fully opaque. Do not round.
 */
export function binAlpha(count: number, maxCount: number): number {
  if (count <= 0 || maxCount <= 0) {
    return 0;
  }
  return 0.15 + 0.85 * Math.min(1, count / maxCount)
}
