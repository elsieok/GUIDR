import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { ApiError, createApi } from "./api";
import { siteKey, type HitItem } from "./draw";
import { GenomeCanvas } from "./GenomeCanvas";
import { OverviewBar } from "./OverviewBar";
import { parseRegion } from "./parseRegion";
import { createRegionLoader, type RegionLoader } from "./regionLoader";
import { scoreBucket } from "./scoreColor";
import { SidePanel, type GeneSummary } from "./SidePanel";
import { formatPosition } from "./ticks";
import { TopBar } from "./TopBar";
import type { Chromosome, Gene, Info, OffTarget, OffTargetsResponse, RegionResponse, ScoredGuide, Site } from "./types";
import { apiToInternal, centerOn, clampView, internalToApi, viewLength, type View } from "./viewport";

/** The API client type; a test can pass a fake one. */
export type Api = ReturnType<typeof createApi>;

const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === "AbortError";

/** A short message for the status line. */
function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    const detail = e.body?.detail;
    return detail ? `${e.message} (${typeof detail === "string" ? detail : JSON.stringify(detail)})` : e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export default function App({ api: apiProp }: { api?: Api }) {
  const api = useMemo(() => apiProp ?? createApi(), [apiProp]);

  // ---- state
  const [info, setInfo] = useState<Info | null>(null);
  const [chrom, setChrom] = useState<Chromosome | null>(null);       // the chromosome on screen
  const [view, setView] = useState<View>({ start: 0, end: 1 });      // what the canvas shows: [start, end), 0-based
  const [history, setHistory] = useState<View[]>([]);                // earlier views, for the Back button
  const [region, setRegion] = useState<RegionResponse | null>(null); // the latest /regions answer
  const [gene, setGene] = useState<Gene | null>(null);               // selected gene
  const [guide, setGuide] = useState<Site | null>(null);             // selected guide
  const [offTargets, setOffTargets] = useState<OffTargetsResponse | null>(null);
  const [offTargetsLoading, setOffTargetsLoading] = useState(false);
  const [scores, setScores] = useState<Map<string, ScoredGuide>>(() => new Map());  // scores learned so far
  const [geneSummary, setGeneSummary] = useState<GeneSummary | null>(null);
  const [computing, setComputing] = useState(false);
  const [status, setStatus] = useState("");

  const loaderRef = useRef<RegionLoader | null>(null);
  const viewRef = useRef(view);                                      // always the newest view, for callbacks
  useEffect(() => { viewRef.current = view; });

  // ---- 1. on start: ask the server which chromosomes exist and show the first one, whole
  useEffect(() => {
    const controller = new AbortController();
    api.info(controller.signal)
      .then((i) => {
        setInfo(i);
        const first = i.chromosomes[0];
        if (first) {
          setChrom(first);
          setView({ start: 0, end: first.length });
        }
      })
      .catch((e) => { if (!isAbort(e)) setStatus(describeError(e)); });
    return () => controller.abort();
  }, [api]);

  // ---- 2. a region loader per chromosome; it debounces, cancels stale requests, and calls setRegion
  useEffect(() => {
    if (!chrom) return;
    const loader = createRegionLoader({
      api,
      chrom: chrom.name,
      chromLen: chrom.length,
      onData: (data) => { setRegion(data); setStatus(""); },
      onError: (e) => setStatus(describeError(e)),
    });
    loaderRef.current = loader;
    loader.setView(viewRef.current);
    return () => { loader.cancel(); loaderRef.current = null; };
  }, [api, chrom]);

  // every time the view changes, tell the loader (it waits until the view has been still)
  useEffect(() => { loaderRef.current?.setView(view); }, [view]);

  // ---- 3. when a guide is selected, fetch its off-targets (aborting the fetch if the selection changes)
  useEffect(() => {
    if (!guide) return;
    const controller = new AbortController();
    api.offTargets(guide.chrom, guide.start, guide.strand, controller.signal)
      .then((r) => {
        setOffTargets(r);
        setOffTargetsLoading(false);
        setScores((prev) => new Map(prev).set(siteKey(r.guide), r.guide));   // now this guide has a score and a color
      })
      .catch((e) => {
        if (isAbort(e)) return;
        setOffTargetsLoading(false);
        setStatus(describeError(e));
      });
    return () => controller.abort();
  }, [api, guide]);

  // ---- navigation helpers
  /** Show `next` (clamped to the chromosome), remembering the current view for Back. */
  const goTo = useCallback((next: View, remember = true, chromLen = chrom?.length) => {
    if (chromLen === undefined) return;
    if (remember) setHistory((h) => [...h.slice(-49), viewRef.current]);
    setView(clampView(next, chromLen));
  }, [chrom]);

  const goBack = useCallback(() => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory(history.slice(0, -1));
    setView(previous);
  }, [history]);

  const selectGene = useCallback((g: Gene) => {
    const target = info?.chromosomes.find((c) => c.name === g.chrom) ?? chrom;
    if (!target) return;
    if (target.name !== chrom?.name) { setChrom(target); setRegion(null); }   // a gene on another chromosome
    setGene(g);
    setGuide(null);
    setOffTargets(null);
    setOffTargetsLoading(false);
    setGeneSummary(null);
    // zoom to the gene with a little room on each side
    goTo(centerOn(target.length, g.start, g.end, Math.round((g.end - g.start + 1) * 1.2)), true, target.length);
  }, [info, chrom, goTo]);

  const selectGuide = useCallback((site: Site) => {
    setGuide(site);
    setOffTargets(null);
    setOffTargetsLoading(true);
  }, []);

  // ---- actions
  const search = useCallback(async (mode: "gene" | "region", text: string) => {
    if (!chrom) return;
    setStatus("");
    try {
      if (mode === "gene") {
        selectGene(await api.gene(text));
      } else {
        const r = parseRegion(text, chrom.name);
        if (r.chrom !== chrom.name) throw new Error(`Unknown chromosome ${r.chrom}`);
        if (r.end > chrom.length) throw new Error(`${chrom.name} has ${formatPosition(chrom.length)} letters`);
        goTo(apiToInternal(r.start, r.end));
      }
    } catch (e) {
      setStatus(describeError(e));
    }
  }, [api, chrom, goTo, selectGene]);

  const computeGuides = useCallback(async () => {
    if (!gene) return;
    setComputing(true);
    try {
      const all = await api.allGeneGuides(gene.name);            // every page, cached after the first time
      setScores((prev) => {
        const next = new Map(prev);
        for (const g of all) next.set(siteKey(g), g);
        return next;
      });
      const counts = { good: 0, caution: 0, poor: 0 };
      for (const g of all) counts[scoreBucket(g.score)]++;
      setGeneSummary({ gene: gene.name, total: all.length, ...counts });
    } catch (e) {
      setStatus(describeError(e));
    } finally {
      setComputing(false);
    }
  }, [api, gene]);

  const onSelect = useCallback((item: HitItem) => {
    if (item.type === "gene") selectGene(item.gene);
    else if (item.type === "guide") selectGuide(item.site);
    else goTo({ start: item.start - 1, end: item.end });          // clicking a bin zooms into it
  }, [selectGene, selectGuide, goTo]);

  const jumpTo = useCallback((site: OffTarget) => {
    if (!chrom) return;
    selectGuide(site);
    goTo(centerOn(chrom.length, site.start, site.end, 200));
  }, [chrom, selectGuide, goTo]);

  // ---- what to show
  const apiWindow = internalToApi(view);
  const guideLabel = guide ? `${formatPosition(guide.start)}–${formatPosition(guide.end)} ${guide.strand}` : null;

  return (
    <div className="app">
      <TopBar
        chromName={chrom?.name ?? null}
        geneName={gene?.name ?? null}
        guideLabel={guideLabel}
        canGoBack={history.length > 0}
        status={status}
        onSearch={search}
        onGoGenome={() => chrom && goTo({ start: 0, end: chrom.length })}
        onGoGene={() => gene && selectGene(gene)}
        onBack={goBack}
      />
      {chrom ? (
        <div className="main">
          <div className="left">
            <OverviewBar view={view} chromLen={chrom.length} onViewChange={(v) => goTo(v)} />
            <GenomeCanvas
              view={view}
              chromLen={chrom.length}
              region={region}
              scores={scores}
              selectedGuideKey={guide ? siteKey(guide) : null}
              selectedGeneName={gene?.name ?? null}
              onViewChange={setView}
              onSelect={onSelect}
            />
            <p className="viewinfo">
              {chrom.name}:{formatPosition(apiWindow.start)}–{formatPosition(apiWindow.end)} · {formatPosition(Math.round(viewLength(view)))} letters
            </p>
          </div>
          <SidePanel
            gene={gene}
            guide={guide}
            offTargets={offTargets}
            offTargetsLoading={offTargetsLoading}
            geneSummary={geneSummary}
            computing={computing}
            maxMismatches={info?.max_mismatches ?? 3}
            mode={region?.mode ?? null}
            onCompute={computeGuides}
            onJump={jumpTo}
          />
        </div>
      ) : (
        <p className="hint">{status || "Loading…"}</p>
      )}
    </div>
  );
}
