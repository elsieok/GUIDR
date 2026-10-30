// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import App, { type Api } from "./App";
import { ApiError } from "./api";
import { LAYOUT, guideY } from "./draw";
import { centerOn, featureRect } from "./viewport";

const CHROM_LEN = 100_000;
const GENE = { name: "geneA", chrom: "c", start: 1001, end: 3000, strand: "+" as const };
const site = (start: number) => ({ chrom: "c", start, end: start + 22, strand: "+" as const, protospacer: "GATTACAGATTACAGATTAC", pam: "TGG" });
const SITES = [site(1100), site(1500), site(2500)];
const scored = (s: ReturnType<typeof site>) => ({ ...s, score: 80, risk: 25, profile: [0, 1, 0, 0] });

function fakeApi() {
  const api = {
    info: vi.fn(async () => ({ max_mismatches: 3, coordinates: "1-based, inclusive", chromosomes: [{ name: "c", length: CHROM_LEN }], cache: {} })),
    gene: vi.fn(async (name: string) => {
      if (name.toLowerCase() !== "genea") throw new ApiError(404, { error: "gene not found", detail: name });
      return GENE;
    }),
    allGeneGuides: vi.fn(async () => SITES.map(scored)),
    region: vi.fn(async (chrom: string, start: number, end: number) => {
      const base = { chrom, start, end, genes: [GENE] };
      return end - start + 1 <= 5000
        ? { ...base, mode: "guides" as const, guides: SITES.filter((s) => s.start >= start && s.end <= end) }
        : { ...base, mode: "bins" as const, bins: [{ start, end, count: 3 }] };
    }),
    offTargets: vi.fn(async (_chrom: string, start: number) => ({
      guide: scored(site(start)), total: 1,
      items: [{ ...site(9000), mismatches: 1, positions: [3], risk: 85.7 }],
    })),
  };
  return api;
}

beforeAll(() => {
  // jsdom has no canvas: give every canvas a context whose drawing calls do nothing
  const ctx = new Proxy({}, { get: (_t, prop) => (prop === "measureText" ? () => ({ width: 0 }) : () => undefined), set: () => true });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
});
afterEach(cleanup);

const start = () => {
  const api = fakeApi();
  const view = render(<App api={api as unknown as Api} />);
  return { api, ...view };
};
const searchGene = async (name: string) => {
  fireEvent.change(screen.getByLabelText("Search"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
};
const narrowRegionRequested = (api: ReturnType<typeof fakeApi>) =>
  api.region.mock.calls.some(([, s, e]) => e - s + 1 <= 5000);

describe("the viewer", () => {
  it("shows the chromosome and the whole-chromosome view once /info has loaded", async () => {
    start();
    expect(await screen.findByRole("button", { name: "c" })).toBeTruthy();
    expect(document.querySelector(".viewinfo")?.textContent).toContain("c:1–100,000 · 100,000 letters");
  });

  it("asks the server for the region after the debounce", async () => {
    const { api } = start();
    await waitFor(() => expect(api.region).toHaveBeenCalled(), { timeout: 2000 });
    expect(api.region.mock.calls[0].slice(0, 3)).toEqual(["c", 1, 100_000]);
  });

  it("searching for a gene selects it, zooms to it, and offers Compute guides", async () => {
    const { api } = start();
    await screen.findByRole("button", { name: "c" });
    await searchGene("geneA");
    expect(await screen.findByRole("heading", { name: "geneA" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compute guides" })).toBeTruthy();
    expect(document.querySelector(".viewinfo")?.textContent).toContain("c:801–3,200 · 2,400 letters");
    await waitFor(() => expect(narrowRegionRequested(api)).toBe(true), { timeout: 2000 });
  });

  it("Compute guides scores the gene's guides and summarizes them", async () => {
    const { api } = start();
    await screen.findByRole("button", { name: "c" });
    await searchGene("geneA");
    fireEvent.click(await screen.findByRole("button", { name: "Compute guides" }));
    expect(await screen.findByText("3 caution")).toBeTruthy();
    expect(api.allGeneGuides).toHaveBeenCalledWith("geneA");
  });

  it("shows the server's error when a gene is not found", async () => {
    start();
    await screen.findByRole("button", { name: "c" });
    await searchGene("nope");
    expect((await screen.findByRole("status")).textContent).toBe("gene not found (nope)");
  });

  it("Back returns to the previous view", async () => {
    start();
    await screen.findByRole("button", { name: "c" });
    await searchGene("geneA");
    await screen.findByRole("heading", { name: "geneA" });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(document.querySelector(".viewinfo")?.textContent).toContain("100,000 letters"));
  });

  it("clicking a guide on the canvas shows its off-targets, and Jump moves to one", async () => {
    const { api, container } = start();
    await screen.findByRole("button", { name: "c" });
    await searchGene("geneA");
    await screen.findByRole("heading", { name: "geneA" });
    await waitFor(() => expect(narrowRegionRequested(api)).toBe(true), { timeout: 2000 });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });   // let the answer be drawn

    // Work out where the guide at 1,500 was drawn, using the same math as the drawing code.
    const view = centerOn(CHROM_LEN, GENE.start, GENE.end, Math.round((GENE.end - GENE.start + 1) * 1.2));
    const r = featureRect(view, 900, 1500, 1522, 3);                              // the canvas is 900 px wide in jsdom
    const x = r.x + r.width / 2;
    const y = guideY("+") + LAYOUT.guideHeight / 2;
    const canvas = container.querySelector("canvas")!;
    fireEvent.mouseDown(canvas, { clientX: x, clientY: y });
    fireEvent.mouseUp(canvas, { clientX: x, clientY: y });

    expect(await screen.findByText("Off-targets (1)")).toBeTruthy();
    expect(api.offTargets.mock.calls[0].slice(0, 3)).toEqual(["c", 1500, "+"]);

    fireEvent.click(screen.getByRole("button", { name: "Jump" }));
    expect(await screen.findByText("9,000–9,022 +")).toBeTruthy();                 // the breadcrumb now shows the off-target
  });
});
