/** A run of letters that are all mismatched or all matching. */
export interface Segment {
  text: string;
  mismatch: boolean;
}

/**
 * Split a sequence into runs for display, marking the mismatched letters.
 *  - `positions` are 1-BASED indices into `sequence` (the API reports mismatches as 1..20).
 *  - Neighbouring letters with the same flag form ONE segment, so the texts joined in order spell
 *    the sequence exactly.
 *  - Positions may be unsorted or repeated.
 *  - Throw a RangeError for a position that is not an integer in 1..sequence.length.
 *  - An empty sequence gives [].
 * Example: highlightSegments("GATTACA", [2, 3]) =
 *   [{ text: "G", mismatch: false }, { text: "AT", mismatch: true }, { text: "TACA", mismatch: false }]
 */
export function highlightSegments(sequence: string, positions: number[]): Segment[] {
  if (!sequence) {
    if (positions.some(p => !Number.isInteger(p) || p < 1)) {
      throw new RangeError("Invalid position");
    }
    return [];
  }

  for (const p of positions) {
    if (!Number.isInteger(p) || p < 1 || p > sequence.length) {
      throw new RangeError("Invalid position");
    }
  }

  const pos = new Set(positions);
  const highlights: Segment[] = [];
  let text = sequence[0];
  let mismatch = pos.has(1);

  for (let i = 1; i < sequence.length; i++) {
    const currentMismatch = pos.has(i + 1);

    if (mismatch === currentMismatch) {
      text += sequence[i];
    } else {
      highlights.push({ text, mismatch});
      text = sequence[i];
      mismatch = currentMismatch;
    }
  }

  highlights.push({ text, mismatch})

  return highlights;
}
