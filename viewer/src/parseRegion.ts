/**
 * Parse text typed into the region search box: "NC_000913.3:1,000-2,000", "1000-2000" or "1000..2000".
 * The chromosome is optional (the current one is used). Numbers are 1-based inclusive, like the API.
 */
export function parseRegion(text: string, defaultChrom: string): { chrom: string; start: number; end: number } {
  const m = /^\s*(?:([^\s:]+):)?\s*([\d,]+)\s*(?:-|\.\.)\s*([\d,]+)\s*$/.exec(text);
  if (!m) throw new Error("Use a region like NC_000913.3:1,000-2,000 or 1000-2000");
  const start = Number(m[2].replace(/,/g, ""));
  const end = Number(m[3].replace(/,/g, ""));
  if (!(start >= 1) || end < start) throw new Error("A region needs 1 <= start <= end");
  return { chrom: m[1] ?? defaultChrom, start, end };
}
