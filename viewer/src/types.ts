// Shapes of the GUIDR API's JSON responses. Coordinates are 1-based inclusive, as sent by the server.
export interface Chromosome { name: string; length: number }
export interface CacheStats { hits: number; misses: number; size: number; max_entries: number }
export interface Info {
  max_mismatches: number;
  coordinates: string;
  chromosomes: Chromosome[];
  cache: { gene_guides: CacheStats; other: CacheStats };
}
export type Strand = "+" | "-";
export interface Gene { name: string; chrom: string; start: number; end: number; strand: Strand }
export interface Site { chrom: string; start: number; end: number; strand: Strand; protospacer: string; pam: string }
export interface ScoredGuide extends Site { score: number; risk: number; profile: number[] }
export interface GenePage { gene: string; total: number; limit: number; offset: number; items: ScoredGuide[] }
export interface Bin { start: number; end: number; count: number }
export interface RegionGuides { chrom: string; start: number; end: number; genes: Gene[]; mode: "guides"; guides: Site[] }
export interface RegionBins { chrom: string; start: number; end: number; genes: Gene[]; mode: "bins"; bins: Bin[] }
export type RegionResponse = RegionGuides | RegionBins;
// positions are 1..20, where 20 touches the PAM
export interface OffTarget extends Site { mismatches: number; positions: number[]; risk: number }
export interface OffTargetsResponse { guide: ScoredGuide; total: number; items: OffTarget[] }
export interface ApiErrorBody { error: string; detail: unknown }
