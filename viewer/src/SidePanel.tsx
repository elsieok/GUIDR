import { BUCKET_COLORS, UNSCORED_COLOR } from "./scoreColor";
import { highlightSegments } from "./highlight";
import type { Gene, OffTarget, OffTargetsResponse, Site } from "./types";

/** How a gene's guides split into the three score buckets, after "Compute guides". */
export interface GeneSummary {
  gene: string;
  total: number;
  good: number;
  caution: number;
  poor: number;
}

interface Props {
  gene: Gene | null;
  guide: Site | null;
  offTargets: OffTargetsResponse | null;
  offTargetsLoading: boolean;
  geneSummary: GeneSummary | null;
  computing: boolean;
  maxMismatches: number;
  mode: "guides" | "bins" | null;          // what the canvas currently shows, to pick the legend
  onCompute: () => void;
  onJump: (site: OffTarget) => void;
}

/** A DNA sequence with the mismatched letters (1-based positions) in red. */
function Sequence({ sequence, positions }: { sequence: string; positions: number[] }) {
  return (
    <code className="seq">
      {highlightSegments(sequence, positions).map((seg, i) =>
        seg.mismatch ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>,
      )}
    </code>
  );
}

export function SidePanel(props: Props) {
  const { gene, guide, offTargets, offTargetsLoading, geneSummary, computing, maxMismatches, mode, onCompute, onJump } = props;
  const loadedForThisGuide = offTargets && guide && offTargets.guide.start === guide.start && offTargets.guide.strand === guide.strand;

  return (
    <aside className="side">
      {!gene && !guide && <p className="hint">Search for a gene, or click a gene or a guide on the track. Scroll to zoom, drag to pan.</p>}

      {gene && (
        <section>
          <h2>{gene.name}</h2>
          <p>{gene.chrom}:{gene.start.toLocaleString("en-US")}–{gene.end.toLocaleString("en-US")} ({gene.strand} strand, {(gene.end - gene.start + 1).toLocaleString("en-US")} letters)</p>
          <button type="button" onClick={onCompute} disabled={computing}>{computing ? "Scoring guides…" : "Compute guides"}</button>
          {geneSummary && geneSummary.gene === gene.name && (
            <p>
              {geneSummary.total} guides:{" "}
              <span className="chip" style={{ background: BUCKET_COLORS.good }}>{geneSummary.good} good</span>{" "}
              <span className="chip" style={{ background: BUCKET_COLORS.caution }}>{geneSummary.caution} caution</span>{" "}
              <span className="chip" style={{ background: BUCKET_COLORS.poor }}>{geneSummary.poor} poor</span>
            </p>
          )}
        </section>
      )}

      {guide && (
        <section>
          <h2>Guide</h2>
          <p><Sequence sequence={guide.protospacer} positions={[]} /> <code className="pam">{guide.pam}</code></p>
          <p>{guide.chrom}:{guide.start.toLocaleString("en-US")}–{guide.end.toLocaleString("en-US")} ({guide.strand} strand)</p>
          {offTargetsLoading && <p>Loading off-targets…</p>}
          {loadedForThisGuide && offTargets && (
            <>
              <p>
                Score <strong>{offTargets.guide.score.toFixed(1)}</strong> (higher is safer) · risk {offTargets.guide.risk.toFixed(2)} · off-targets by mismatches: {offTargets.guide.profile.join(" / ")}
              </p>
              <h3>Off-targets ({offTargets.total})</h3>
              {offTargets.total === 0 && <p>None found within {maxMismatches} mismatches.</p>}
              <ol className="offtargets">
                {offTargets.items.map((ot) => (
                  <li key={`${ot.start}:${ot.strand}`}>
                    <div>{ot.start.toLocaleString("en-US")}–{ot.end.toLocaleString("en-US")} ({ot.strand}) · {ot.mismatches} mismatch{ot.mismatches === 1 ? "" : "es"} · risk {ot.risk.toFixed(1)}</div>
                    <Sequence sequence={ot.protospacer} positions={ot.positions} />
                    <button type="button" onClick={() => onJump(ot)}>Jump</button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}

      <section className="legend">
        <h3>Legend</h3>
        <ul>
          <li><i style={{ background: "#4c78a8" }} /> gene, + strand</li>
          <li><i style={{ background: "#e08a3c" }} /> gene, − strand</li>
          {mode === "bins" && <li><i style={{ background: "rgba(31, 119, 180, 0.6)" }} /> guides per bin (darker = more)</li>}
          {mode === "guides" && (
            <>
              <li><i style={{ background: UNSCORED_COLOR }} /> guide, not scored yet (click it, or Compute guides)</li>
              <li><i style={{ background: BUCKET_COLORS.good }} /> score 95 or more: no off-targets found within {maxMismatches} mismatches</li>
              <li><i style={{ background: BUCKET_COLORS.caution }} /> score 70 to 95</li>
              <li><i style={{ background: BUCKET_COLORS.poor }} /> score below 70</li>
            </>
          )}
        </ul>
        <p className="fine">Scores come from a simplified, position-weighted heuristic. They are not experimentally validated.</p>
      </section>
    </aside>
  );
}
