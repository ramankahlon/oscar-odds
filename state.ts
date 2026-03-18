import LZString from "lz-string";
import { clamp } from "./forecast-utils.js";
import {
  applySourceSignals,
  calculateNominationOdds,
  calculateWinnerOdds,
  normalizeSignalKey as normalizeSignalKeyCore,
  rebalanceCategory
} from "./app-logic.js";
import type { Category, Film, NormalizedWeights, Projection, ScoreResult, Strength } from "./types.js";
import { initScoringWasm, isScoringWasmReady, scoreFilmWasm } from "./scoring-wasm.js";

/** Escape user-supplied strings before interpolating into innerHTML. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface TrendEntry {
  key: string;
  title: string;
  nomination: number;
  winner: number;
}

export interface TrendSnapshot {
  categoryId: string;
  capturedAt: string;
  sourceSnapshotId: string | null;
  entries: TrendEntry[];
}

export interface TrendHistory {
  version: number;
  snapshots: TrendSnapshot[];
  lastSignatureByCategory: Record<string, string>;
}

export interface TrendPoint {
  capturedAt: string;
  sourceSnapshotId: string;
  nomination: number;
  winner: number;
}

export interface AppState {
  profileId: string;
  categoryId: string;
  weights: NormalizedWeights;
  trendWindow: number;
}

export interface StatePayload {
  categoryId?: string;
  weights?: Partial<NormalizedWeights>;
  trendWindow?: number;
  trendHistory?: {
    version?: number;
    snapshots?: unknown[];
    lastSignatureByCategory?: Record<string, string>;
  };
  categories?: Array<{ id: string; films: unknown[] }>;
  lockedCategories?: string[];
}

export interface CompactShare {
  v: 1;
  c: string;                                                           // categoryId
  w: [number, number, number];                                         // [precursor, history, buzz] weights
  t: number;                                                           // trendWindow
  s: Record<string, Record<string, [number, number, number]>>;        // catId → title → [p,h,b]
}

export interface SearchProjection extends Projection {
  categoryName: string;
}

export interface WeightPreset {
  name: string;
  precursor: number;
  history: number;
  dataDriven?: true;   // marks the ML-learned preset
  buzz: number;
  builtin?: true;
}

// DATA_DRIVEN_PRESET is mutable: bootstrap() overwrites its weights after fetching
// /api/learned-weights.  Values here are the hand-tuned fallback shown before
// the fetch completes (or if the optimisation script hasn't been run yet).
export const DATA_DRIVEN_PRESET: WeightPreset = {
  name: "Data-Driven", precursor: 58, history: 30, buzz: 12, builtin: true, dataDriven: true
};

export const BUILTIN_PRESETS: WeightPreset[] = [
  { name: "Balanced",        precursor: 58, history: 30, buzz: 12, builtin: true },
  { name: "Precursor-heavy", precursor: 75, history: 18, buzz:  7, builtin: true },
  { name: "History-heavy",   precursor: 40, history: 48, buzz: 12, builtin: true },
  { name: "Buzz-driven",     precursor: 35, history: 25, buzz: 40, builtin: true },
  DATA_DRIVEN_PRESET,
];

export const WEIGHT_PRESETS_KEY = "oscar-odds:weight-presets";

export interface ContendersData {
  ceremony: number;
  year: number;
  categoryDefinitions: Array<{ id: string; name: string; nominees: number; winnerBase: number }>;
  categorySeeds: Record<string, Film[]>;
  scheduledFilms: string[];
  experienceConfig: {
    priorCategoryWins: Record<string, Record<string, number>>;
    recentWinnerPenalty: Record<string, Record<string, number>>;
    overdueNarrativeBoost: Record<string, Record<string, number>>;
  };
}

// Contender data and experience config — populated by loadContenders() in bootstrap()
export let categories: Category[] = [];
export let categorySeeds: Record<string, Film[]> = {};
export let scheduledFilms: string[] = [];
export let priorCategoryWins: Record<string, Record<string, number>> = {};
export let recentWinnerPenalty: Record<string, Record<string, number>> = {};
export let overdueNarrativeBoost: Record<string, Record<string, number>> = {};

export function createSeedFilms(): Film[] {
  return scheduledFilms.map((title) => ({ title, studio: "TBD", precursor: 55, history: 50, buzz: 52, strength: "Medium" as Strength }));
}

export const CATEGORY_SHORT_NAMES: Record<string, string> = {
  "picture": "Picture",
  "director": "Director",
  "actor": "Actor",
  "actress": "Actress",
  "supporting-actor": "Supp. Actor",
  "supporting-actress": "Supp. Actress",
  "original-screenplay": "Orig. Screenplay",
  "adapted-screenplay": "Adpt. Screenplay",
  "animated-feature": "Animated",
  "international-feature": "Intl. Feature",
  "documentary-feature": "Doc. Feature",
  "documentary-short": "Doc. Short",
  "live-action-short": "Live Action Short",
  "animated-short": "Animated Short",
  "original-score": "Score",
  "original-song": "Song",
  "sound": "Sound",
  "production-design": "Prod. Design",
  "cinematography": "Cinematography",
  "makeup-hairstyling": "Makeup",
  "costume-design": "Costume",
  "film-editing": "Film Editing",
  "visual-effects": "VFX",
  "casting": "Casting"
};

export const STORAGE_KEY = "oscarOddsForecastState.v11";
export const API_PROFILE_LIST_URL = "/api/profiles";
export const API_FORECAST_BASE_URL = "/api/forecast";
export const EXTERNAL_SIGNALS_URL = "data/source-signals.json";
export const EXTERNAL_SIGNALS_POLL_MS = 5 * 60 * 1000;
export const TREND_HISTORY_LIMIT = 240;
// Consensus-ranking score constants
export const CONSENSUS_TOP_SCORE  = 88; // precursor score assigned to the #1 ranked film
export const CONSENSUS_STEP       = 15; // preferred gap between consecutive ranked scores
export const CONSENSUS_BOTTOM_FLOOR = 10; // minimum score the bottom-ranked film can receive
export const CONSENSUS_SCORE_MIN  =  5; // hard clamp floor applied after step distribution
export const CONSENSUS_SCORE_MAX  = 95; // hard clamp ceiling applied after step distribution
export const TREND_WINDOW_OPTIONS = [7, 15, 30];
export const NOMINATION_PERCENT_UPLIFT = 1.14;
export const WINNER_PERCENT_UPLIFT = 1.2;
export const WINNER_TO_NOMINATION_CAP = 0.5;

export const state: AppState = {
  profileId: "default",
  categoryId: "",  // set by loadContenders() in bootstrap()
  weights: {
    precursor: 58,
    history: 30,
    buzz: 12
  },
  trendWindow: 30
};
export let appliedExternalSnapshotId: string | null = null;
export const trendHistory: TrendHistory = {
  version: 1,
  snapshots: [],
  lastSignatureByCategory: {}
};

export let searchQuery = "";
export let compareMode = false;
export let compareProfileId: string | null = null;
export let snapshotCompareMode = false;
export let snapshotDateA: string | null = null;
export let snapshotDateB: string | null = null;
export const lockedCategories = new Set<string>();
export const surpriseBuzzUndo = new Map<string, number[]>(); // categoryId → original buzz values
export let pendingBuzzSync: { title: string; buzz: number; targets: Category[] } | null = null;
export let pendingUndo: (() => void) | null = null;
export let undoToastTimer: ReturnType<typeof setTimeout> | null = null;
export let userPresets: WeightPreset[] = [];
export type OddsMode = "both" | "nomination" | "winner";
export let oddsMode: OddsMode = "both";
export const comparePayloadCache  = new Map<string, StatePayload>();
export const compareInflightMap   = new Map<string, Promise<StatePayload | null>>();
// Projection cache — keyed by categoryId, invalidated (version bump) on every saveState().
export const projectionsCache     = new Map<string, Projection[]>();
export let   projectionCacheVersion = 0;
// Bootstrap CI — weight samples fetched once from /api/bootstrap-ci.
// Each sample is [precursor, history, buzz] in [0,1] range (already normalised).
export let bootstrapSamples: Array<[number, number, number]> = [];
// Per-category CI cache — maps film.title → {nomLow, nomHigh, winLow, winHigh} (percentages).
// Cleared alongside projectionsCache whenever saveState() is called.
export const bootstrapCIByCategory = new Map<string, Map<string, {
  nomLow: number; nomHigh: number; winLow: number; winHigh: number
}>>();
// Joint probability data fetched from /api/joint-probability.
// Enables sweep analysis (same film winning multiple categories).
export interface JointProbData {
  totalYears: number;
  categories: string[];
  coWinRates: Record<string, Record<string, number>>;
  condRates: Record<string, Record<string, number>>;
}
export let jointProbData: JointProbData | null = null;
// Permutation Feature Importance data fetched from /api/feature-importance.
export interface FeatureImportanceData {
  method: string;
  learnedWeights: { precursor: number; history: number; buzz: number };
  baseline: { winnerAccuracy: number; crossEntropyLoss: number; brierScore: number };
  features: Array<{
    name: string;
    weightFraction: number;
    importance: {
      winnerAccuracy:   { mean: number; std: number; drop: number };
      crossEntropyLoss: { mean: number; std: number; increase: number };
      brierScore:       { mean: number; std: number; increase: number };
    };
  }>;
}
export let featureImportanceData: FeatureImportanceData | null = null;
// Brier Score Decomposition data fetched from /api/brier-decomposition.
export interface BrierDecompCategory {
  brierScore:  number;
  reliability: number;
  resolution:  number;
  uncertainty: number;
  bss:         number;
  baseRate:    number;
}
export interface BrierDecompData {
  winner: BrierDecompCategory & { bins: Array<{ meanForecast: number; observedFreq: number; count: number }> };
  byCategory: Record<string, { winner: BrierDecompCategory }>;
}
export let brierDecompData: BrierDecompData | null = null;
// A/B Test data fetched from /api/ab-test.
export interface AbTestPreset {
  name:    string;
  weights: { precursor: number; history: number; buzz: number };
  overall: { winnerAccuracyPct: number; winnerBrierAvg: number; nominationBrierAvg: number };
}
export interface AbTestPair {
  a: string;
  b: string;
  n: number;
  winnerAccuracy: {
    aPct: number; bPct: number; delta: number;
    aWins: number; bWins: number; ties: number;
    mcnemar: { chiSq: number; pValue: number };
  };
  winnerBrier: {
    aMean: number; bMean: number; delta: number;
    pairedT:  { t: number; df: number; pValue: number; cohenD: number };
    wilcoxon: { W: number; Z: number; pValue: number };
  };
  nomBrier: {
    aMean: number; bMean: number; delta: number;
    pairedT: { t: number; df: number; pValue: number; cohenD: number };
  };
}
export interface AbTestData {
  generatedAt: string;
  alpha:       number;
  totalPairs:  number;
  presets:     AbTestPreset[];
  pairwise:    AbTestPair[];
}
export let abTestData: AbTestData | null = null;
// Precision-Recall / ROC data fetched from /api/pr-roc.
export interface PrRocCurveSet {
  n:          number;
  positives:  number;
  prevalence: number;
  aucRoc:     number;
  aucPr:      number;
  roc:        Array<{ fpr: number; tpr: number }>;
  pr:         Array<{ recall: number; precision: number }>;
}
export interface PrRocData {
  generatedAt: string;
  weights:     { precursor: number; history: number; buzz: number };
  overall:     PrRocCurveSet;
  byCategory:  Record<string, PrRocCurveSet>;
}
export let prRocData: PrRocData | null = null;
// Rolling Forecast Error data fetched from /api/rolling-error.
export interface RollingYearRow {
  year:                  number;
  ceremony:              number;
  winnerBrierAvg:        number;
  nominationBrierAvg:    number;
  winnerAccuracyPct:     number;
  nominationAccuracyAvg: number;
  roll3WinnerBrier:      number;
  roll5WinnerBrier:      number;
  roll3WinnerAccuracy:   number;
  roll5WinnerAccuracy:   number;
  trendWinnerBrier:      number;
  trendWinnerAccuracy:   number;
}
export interface RollingCatRow {
  year:          number;
  winnerCorrect: boolean;
  winnerBrier:   number;
  nomBrier:      number;
}
export interface RollingErrorData {
  generatedAt: string;
  weights:     { precursor: number; history: number; buzz: number };
  yearRange:   { from: number; to: number };
  trend: {
    winnerBrier:    { slope: number; intercept: number; r2: number; unit: string };
    winnerAccuracy: { slope: number; intercept: number; r2: number; unit: string };
  };
  years:       RollingYearRow[];
  byCategory:  Record<string, RollingCatRow[]>;
}
export let rollingErrorData: RollingErrorData | null = null;
// Summary bar card tracking — avoids querySelector and full rebuild on tab switches.
export const summaryCardMap        = new Map<string, HTMLElement>();
export let   activeSummaryCard: HTMLElement | null = null;
export let   summaryBarBuiltAtVersion = -1;

export let profileOptions: string[] = ["default"];
// Auth state keyed by profileId; populated by loadProfiles() + refreshAuthStatus()
export const profileAuthMap = new Map<string, { hasPassphrase: boolean; authenticated: boolean }>();
// Resolve callback and target profileId for the promptUnlock() promise
export let resolveUnlock: ((ok: boolean) => void) | null = null;
export let unlockProfileId: string = "";
export const explainSelectionByCategory: Record<string, number> = {};
export let activePosterRequestId = 0;
export let isBootstrapping = true;
export let posterFallbackActive = false;
export let backendOfflineMode = false;
export let lastOddsRecalculatedAt: string | null = null;
export let lastSourceSyncAt: string | null = null;

// ── Client-side error reporting ──────────────────────────────────────────────

export interface ClientErrorPayload {
  message: string;
  source?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
  context?: string;
}

export const CLIENT_ERROR_QUEUE: ClientErrorPayload[] = [];
export let clientErrorFlushTimer: ReturnType<typeof setTimeout> | null = null;

// Current auth dialog mode — read by the single submit listener
export let authDialogMode: "unlock" | "set" | "change" | null = null;

export const movieDetails = {
  "The Odyssey": {
    director: "Christopher Nolan",
    stars: ["Matt Damon", "Zendaya", "Anne Hathaway", "Tom Holland"],
    genre: "Epic, Adventure, Drama",
    description: "Christopher Nolan's sweeping adaptation of Homer's epic poem, following Odysseus on his treacherous decade-long voyage home after the fall of Troy."
  },
  "Dune: Part Three": {
    director: "Denis Villeneuve",
    stars: ["Timothee Chalamet", "Zendaya", "Florence Pugh"],
    genre: "Sci-Fi, Epic, Drama",
    description: "The next chapter of the Dune saga, escalating political power struggles and interstellar conflict."
  },
  "Project Hail Mary": {
    director: "Phil Lord & Christopher Miller",
    stars: ["Ryan Gosling", "Sandra Huller"],
    genre: "Sci-Fi, Adventure, Drama",
    description: "A lone astronaut wakes in deep space and must solve an extinction-level crisis for Earth."
  },
  "The Social Reckoning": {
    director: "Trey Edward Shults",
    stars: ["Mikey Madison", "Jeremy Strong"],
    genre: "Drama, Thriller",
    description: "A prestige drama about public accountability, image, and power in a high-stakes social collapse."
  },
  "The Dog Stars": {
    director: "Ridley Scott",
    stars: ["Jacob Elordi", "Margaret Qualley"],
    genre: "Post-Apocalyptic, Drama",
    description: "A pilot and his companion navigate a devastated world while searching for hope and connection."
  },
  "Wild Horse Nine": {
    director: "Martin McDonagh",
    stars: ["Sam Rockwell", "John Malkovich", "Mariana di Girolamo"],
    genre: "Drama, Black Comedy",
    description: "McDonagh's ensemble drama set against a fractured American landscape, featuring overdue Oscar-caliber turns from its veteran cast."
  },
  Fjord: {
    director: "Cristian Mungiu",
    stars: ["Renate Reinsve", "Sebastian Stan"],
    genre: "Drama",
    description: "A remote two-hander set against stark Nordic landscapes, anchored by a physically and emotionally committed lead performance from Reinsve."
  },
  Digger: {
    director: "Alejandro G. Inarritu",
    stars: ["Tom Cruise", "John Goodman", "Sandra Huller"],
    genre: "Drama",
    description: "Inarritu returns with an ambitious character-driven drama anchored by a transformative Cruise performance and a gifted supporting ensemble."
  },
  "Untitled Jesse Eisenberg Musical": {
    director: "Jesse Eisenberg",
    stars: ["Jesse Eisenberg", "Julianne Moore", "Halle Bailey"],
    genre: "Musical Drama, Comedy",
    description: "Eisenberg writes, directs, and stars in a personal musical drama that earned early festival breakout buzz."
  },
  "All of a Sudden": {
    director: "Ryusuke Hamaguchi",
    stars: ["Tao Okamoto", "Virginie Efira"],
    genre: "Drama",
    description: "Hamaguchi's latest contemplative drama explores chance encounter and emotional rupture across cultural borders."
  },
  Josephine: {
    director: "TBD",
    stars: ["Channing Tatum"],
    genre: "Drama",
    description: "A character-driven drama featuring Channing Tatum in a supporting turn that generated significant awards attention."
  },
  "Disclosure Day": {
    director: "Steven Spielberg",
    stars: ["Emily Blunt", "Josh O'Connor", "Colin Firth", "Colman Domingo", "Eve Hewson"],
    genre: "Sci-Fi, Thriller",
    description: "Spielberg returns to the UFO genre with a thriller about the global reckoning that follows irrefutable proof of extraterrestrial life. Screenplay by David Koepp; score by John Williams."
  },
  Werwulf: {
    director: "TBD",
    stars: ["TBD"],
    genre: "Horror",
    description: "A practical-effects-driven genre film with demanding transformative makeup work expected to compete in technical categories."
  },
  "Jack of Spades": {
    director: "Joel Coen",
    stars: ["Josh O'Connor"],
    genre: "Drama",
    description: "Joel Coen's solo follow-up, a tightly written original drama with a strong central performance from O'Connor."
  },
  Michael: {
    director: "Antoine Fuqua",
    stars: ["Jaafar Jackson", "Colman Domingo", "Nia Long"],
    genre: "Biographical Drama",
    description: "A biopic charting Michael Jackson's life, career rise, and lasting global pop-cultural influence."
  },
  "Sense and Sensibility": {
    director: "Georgia Oakley",
    stars: ["Daisy Edgar-Jones", "Paul Mescal"],
    genre: "Period Drama, Romance",
    description: "A new adaptation of Austen's novel centered on class, love, and family pressure in Regency England."
  },
  Narnia: {
    director: "Greta Gerwig",
    stars: ["Ensemble Cast"],
    genre: "Fantasy, Adventure",
    description: "A new screen take on C.S. Lewis world-building with large-scale fantasy production design."
  },
  "Wuthering Heights": {
    director: "Emerald Fennell",
    stars: ["Jacob Elordi", "Margot Robbie"],
    genre: "Period Drama, Romance",
    description: "A modernized gothic adaptation of the classic novel focused on obsession, class, and revenge."
  },
  "The Drama": {
    director: "Kristoffer Borgli",
    stars: ["Zendaya", "Robert Pattinson"],
    genre: "Romantic Drama",
    description: "A relationship-centered prestige drama that blends sharp humor and emotional instability."
  }
};

export interface MovieDetailEntry {
  title: string;
  director: string;
  stars: string[];
  genre: string;
  description: string;
}
export const movieDetailsIndex = new Map<string, MovieDetailEntry>(
  Object.entries(movieDetails).map(([title, details]) => [normalizeMovieDetailKey(title), { title, ...details }])
);

export function normalizeSignalKey(value: unknown): string {
  return normalizeSignalKeyCore(value);
}

export function normalizeWeights(): NormalizedWeights {
  const total = state.weights.precursor + state.weights.history + state.weights.buzz;
  return {
    precursor: state.weights.precursor / total,
    history: state.weights.history / total,
    buzz: state.weights.buzz / total
  };
}

// ── Weight presets ────────────────────────────────────────────────────────────

export function loadUserPresets(): WeightPreset[] {
  try {
    const raw = localStorage.getItem(WEIGHT_PRESETS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((p): p is WeightPreset => {
        if (!p || typeof p !== "object") return false;
        const q = p as Record<string, unknown>;
        return (
          typeof q.name === "string" && q.name.trim() !== "" &&
          typeof q.precursor === "number" &&
          typeof q.history   === "number" &&
          typeof q.buzz      === "number"
        );
      })
      .map((p) => ({
        name:      p.name.trim().slice(0, 40),
        precursor: clamp(p.precursor, 1, 95),
        history:   clamp(p.history,   1, 95),
        buzz:      clamp(p.buzz,      1, 95),
      }));
  } catch {
    return [];
  }
}

export function saveUserPresetsToStorage(presets: WeightPreset[]): void {
  try {
    localStorage.setItem(WEIGHT_PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // Ignore storage failures.
  }
}

/** Returns the preset whose normalised weights match the current state, or null. */
export function getActivePreset(): WeightPreset | null {
  const total = state.weights.precursor + state.weights.history + state.weights.buzz || 1;
  const np = state.weights.precursor / total;
  const nh = state.weights.history   / total;
  const nb = state.weights.buzz      / total;

  return [...BUILTIN_PRESETS, ...userPresets].find((preset) => {
    const pt = preset.precursor + preset.history + preset.buzz || 1;
    return (
      Math.abs(np - preset.precursor / pt) < 0.005 &&
      Math.abs(nh - preset.history   / pt) < 0.005 &&
      Math.abs(nb - preset.buzz      / pt) < 0.005
    );
  }) ?? null;
}

export function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: T) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export function logistic(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export function strengthBoost(strength: Strength): number {
  if (strength === "High") return 1.06;
  if (strength === "Medium") return 1.0;
  return 0.94;
}

export function winnerExperienceBoost(categoryId: string, contenderName: string): number {
  const isPersonCategory =
    categoryId === "director" ||
    categoryId === "actor" ||
    categoryId === "actress" ||
    categoryId === "supporting-actor" ||
    categoryId === "supporting-actress";
  if (!isPersonCategory) return 1;

  const wins = priorCategoryWins[categoryId]?.[contenderName] || 0;
  const recentPenaltyLevel = Number(recentWinnerPenalty[categoryId]?.[contenderName] || 0);
  const hasOverdueNarrative = Boolean(overdueNarrativeBoost[categoryId]?.[contenderName]);

  let boost = 1;
  if (wins === 0) {
    boost += 0.06;
  } else {
    boost -= 0.08 + Math.min(wins, 3) * 0.03;
  }

  if (recentPenaltyLevel > 0) boost -= 0.12 * recentPenaltyLevel;
  if (hasOverdueNarrative) boost += 0.08;
  return clamp(boost, 0.55, 1.15);
}

export function sanitizeStrength(value: unknown): Strength {
  if (value === "High" || value === "Medium" || value === "Low") return value;
  return "Low";
}

export function applyExternalSignalSnapshot(snapshot: unknown): boolean {
  const result = applySourceSignals({
    categories,
    snapshot,
    lastAppliedSnapshotId: appliedExternalSnapshotId
  });
  if (!result.changed) return false;
  appliedExternalSnapshotId = result.appliedSnapshotId;
  lastSourceSyncAt = (snapshot as { generatedAt?: string })?.generatedAt || new Date().toISOString();
  return true;
}

export function parseFilmRecord(record: unknown): Film | null {
  if (!record || typeof record !== "object") return null;
  const r = record as Record<string, unknown>;

  const title = String(r.title || "").trim();
  const studio = String(r.studio || "").trim();
  if (!title || !studio) return null;

  return {
    title,
    studio,
    precursor: clamp(Number(r.precursor || 0), 0, 100),
    history: clamp(Number(r.history || 0), 0, 100),
    buzz: clamp(Number(r.buzz || 0), 0, 100),
    strength: sanitizeStrength(String(r.strength || "").trim()),
    nominated: r.nominated === true
  };
}

export function getActiveCategory(): Category {
  return categories.find((category) => category.id === state.categoryId) ?? categories[0];
}

export type CompletionState = "complete" | "partial" | "untouched";

/**
 * Returns the completion state of a category based on whether films still
 * carry the "TBD" studio placeholder that createSeedFilms() stamps on them.
 *
 *   complete  — every film has real data (no TBD studios)
 *   partial   — some films are real, some are still placeholders
 *   untouched — all films are still placeholders (nothing edited yet)
 */
export function getCategoryCompletion(category: Category): CompletionState {
  if (category.films.length === 0) return "untouched";
  const filled = category.films.filter((f) => f.studio !== "TBD").length;
  if (filled === 0)                          return "untouched";
  if (filled === category.films.length)      return "complete";
  return "partial";
}

export function scoreFilm(categoryId: string, film: Film, normalizedWeights: NormalizedWeights): ScoreResult {
  // winnerHistoryMultiplier requires string lookups against JS config objects.
  // Pre-compute it here so the WASM kernel only receives a plain f64.
  const winnerHistoryMultiplier = winnerExperienceBoost(categoryId, film.title);

  if (isScoringWasmReady()) {
    // Delegate the pure-math core to the WASM kernel.
    // Inputs cross the boundary as f64 (film numbers/weights) and i32 (strength enum).
    // Results are read from a pinned Float64Array in WASM linear memory.
    return scoreFilmWasm(
      film.precursor, film.history, film.buzz,
      normalizedWeights.precursor, normalizedWeights.history, normalizedWeights.buzz,
      film.strength, winnerHistoryMultiplier,
    );
  }

  // JS fallback — used during the brief window before WASM finishes loading.
  const precursorContribution = film.precursor * normalizedWeights.precursor;
  const historyContribution = film.history * normalizedWeights.history;
  const buzzContribution = film.buzz * normalizedWeights.buzz;
  const linear = precursorContribution + historyContribution + buzzContribution;
  const centered = (linear - 55) / 12;
  const strengthMultiplier = strengthBoost(film.strength);
  const nominationRaw = logistic(centered) * strengthMultiplier;
  const winnerRaw = nominationRaw * (0.6 + film.precursor / 190) * winnerHistoryMultiplier;
  return { nominationRaw, winnerRaw, precursorContribution, historyContribution, buzzContribution, strengthMultiplier, winnerHistoryMultiplier };
}

export function getDisplayLimit(category: Category): number {
  return category.id === "picture" ? 10 : 5;
}

export function getPrimaryColumnLabel(categoryId: string): string {
  const personCategoryLabels: Record<string, string> = {
    director: "Director",
    actor: "Actor",
    actress: "Actress",
    "supporting-actor": "Supporting Actor",
    "supporting-actress": "Supporting Actress"
  };
  return personCategoryLabels[categoryId] || "Film";
}

export function getDisplayTitle(categoryId: string, title: string, studio: string): string {
  const isPersonCategory =
    categoryId === "director" ||
    categoryId === "actor" ||
    categoryId === "actress" ||
    categoryId === "supporting-actor" ||
    categoryId === "supporting-actress";

  if (!isPersonCategory) return title;
  return `${title} (${studio})`;
}

export function getSelectedFilmTitle(categoryId: string, entry: Projection): string {
  const isPersonCategory =
    categoryId === "director" ||
    categoryId === "actor" ||
    categoryId === "actress" ||
    categoryId === "supporting-actor" ||
    categoryId === "supporting-actress";
  return isPersonCategory ? entry.rawStudio : entry.rawTitle;
}

export function trendKeyForEntry(categoryId: string, entry: Projection): string {
  const isPersonCategory =
    categoryId === "director" ||
    categoryId === "actor" ||
    categoryId === "actress" ||
    categoryId === "supporting-actor" ||
    categoryId === "supporting-actress";
  const base = isPersonCategory ? `${entry.rawTitle}::${entry.rawStudio}` : entry.rawTitle;
  return `${categoryId}::${normalizeSignalKey(base)}`;
}

export function buildCategoryTrendSignature(category: Category, displayProjections: Projection[]): string {
  const rows = displayProjections.map((entry) => {
    return `${trendKeyForEntry(category.id, entry)}:${entry.nomination.toFixed(2)}:${entry.winner.toFixed(2)}`;
  });
  return `${category.id}|${appliedExternalSnapshotId || "manual"}|${rows.join("|")}`;
}

export function captureTrendSnapshot(category: Category, projections: Projection[]): boolean {
  const displayProjections = projections.slice(0, getDisplayLimit(category));
  if (displayProjections.length === 0) return false;

  const signature = buildCategoryTrendSignature(category, displayProjections);
  if (trendHistory.lastSignatureByCategory[category.id] === signature) return false;
  trendHistory.lastSignatureByCategory[category.id] = signature;

  trendHistory.snapshots.push({
    categoryId: category.id,
    capturedAt: new Date().toISOString(),
    sourceSnapshotId: appliedExternalSnapshotId || null,
    entries: displayProjections.map((entry) => ({
      key: trendKeyForEntry(category.id, entry),
      title: entry.title,
      nomination: Number(entry.nomination.toFixed(2)),
      winner: Number(entry.winner.toFixed(2))
    }))
  });

  if (trendHistory.snapshots.length > TREND_HISTORY_LIMIT) {
    trendHistory.snapshots.splice(0, trendHistory.snapshots.length - TREND_HISTORY_LIMIT);
  }
  return true;
}

export function pointsForEntryTrend(category: Category, entry: Projection): TrendPoint[] {
  const key = trendKeyForEntry(category.id, entry);
  const pointLimit = TREND_WINDOW_OPTIONS.includes(Number(state.trendWindow)) ? Number(state.trendWindow) : 30;
  return trendHistory.snapshots
    .filter((snapshot) => snapshot.categoryId === category.id)
    .map((snapshot) => {
      const contender = (snapshot.entries || []).find((item) => item.key === key);
      if (!contender) return null;
      return {
        capturedAt: snapshot.capturedAt,
        sourceSnapshotId: snapshot.sourceSnapshotId || "",
        nomination: Number(contender.nomination || 0),
        winner: Number(contender.winner || 0)
      };
    })
    .filter((p): p is TrendPoint => p !== null)
    .slice(-pointLimit);
}

// ── Momentum: OLS regression on winner/nomination odds time series ────────────

export interface MomentumResult {
  /** OLS slope in percentage-points per day (winner odds). */
  winSlope:  number;
  /** OLS slope in pp/day for nomination odds. */
  nomSlope:  number;
  /** Coefficient of determination (0–1) — reliability of the trend line. */
  r2:        number;
  /** Number of snapshot data points used. */
  snapshots: number;
}

export const MOMENTUM_STABLE_THRESHOLD = 0.30;  // pp/day — below this = "stable"
export const MOMENTUM_STRONG_THRESHOLD = 1.50;  // pp/day — above this = "strong" move

/**
 * Fit OLS regression y = a + b·t to (time, odds) pairs.
 * Returns { slope, r2 } where slope is in units of odds-unit per day.
 * Returns null when fewer than 2 distinct timestamps exist.
 */
export function olsSlope(pairs: Array<{ t: number; y: number }>): { slope: number; r2: number } | null {
  if (pairs.length < 2) return null;
  const n  = pairs.length;
  const tBar = pairs.reduce((s, p) => s + p.t, 0) / n;
  const yBar = pairs.reduce((s, p) => s + p.y, 0) / n;
  let stt = 0, sty = 0, syy = 0;
  for (const { t, y } of pairs) {
    stt += (t - tBar) ** 2;
    sty += (t - tBar) * (y - yBar);
    syy += (y - yBar) ** 2;
  }
  if (stt < 1e-9) return null;
  const slope = sty / stt;
  const r2    = syy > 1e-9 ? (sty ** 2) / (stt * syy) : 0;
  return { slope, r2 };
}

/**
 * Compute momentum for a single film from its trend points.
 * Returns null if there are fewer than 2 snapshots with distinct timestamps.
 */
export function computeMomentum(points: TrendPoint[]): MomentumResult | null {
  if (points.length < 2) return null;

  const t0 = new Date(points[0].capturedAt).getTime();
  const winPairs  = points.map(p => ({ t: (new Date(p.capturedAt).getTime() - t0) / 86_400_000, y: p.winner }));
  const nomPairs  = points.map(p => ({ t: (new Date(p.capturedAt).getTime() - t0) / 86_400_000, y: p.nomination }));

  const winFit = olsSlope(winPairs);
  const nomFit = olsSlope(nomPairs);
  if (!winFit) return null;

  return {
    winSlope:  winFit.slope,
    nomSlope:  nomFit?.slope ?? 0,
    r2:        winFit.r2,
    snapshots: points.length,
  };
}

/**
 * Compute momentum for every film in the current category using the active
 * trend window.  Returns a Map keyed by trendKeyForEntry.
 * Result is NOT cached — it is recomputed on each render (cheap: pure array math).
 */
export function computeCategoryMomentum(
  category:    Category,
  projections: Projection[]
): Map<string, MomentumResult | null> {
  const out = new Map<string, MomentumResult | null>();
  for (const entry of projections) {
    const points = pointsForEntryTrend(category, entry);
    out.set(trendKeyForEntry(category.id, entry), computeMomentum(points));
  }
  return out;
}

/** Format a momentum slope as a compact badge HTML string. */
export function momentumBadgeHtml(m: MomentumResult | null): string {
  if (!m || m.snapshots < 3) return "";
  const s = m.winSlope;
  const abs = Math.abs(s);
  if (abs < MOMENTUM_STABLE_THRESHOLD) return `<span class="momentum-badge momentum--stable" title="Stable (${s >= 0 ? "+" : ""}${s.toFixed(2)} pp/day, R²=${(m.r2*100).toFixed(0)}%)">→</span>`;
  const strong = abs >= MOMENTUM_STRONG_THRESHOLD;
  const dir    = s > 0 ? "up" : "dn";
  const arrow  = s > 0 ? (strong ? "↑↑" : "↑") : (strong ? "↓↓" : "↓");
  const label  = `${s >= 0 ? "+" : ""}${s.toFixed(2)} pp/day, R²=${(m.r2*100).toFixed(0)}%`;
  return `<span class="momentum-badge momentum--${dir}" title="${label}">${arrow}</span>`;
}

export function getSnapshotDays(categoryId: string): string[] {
  const daySet = new Set<string>();
  trendHistory.snapshots
    .filter(s => s.categoryId === categoryId)
    .forEach(s => daySet.add(s.capturedAt.slice(0, 10)));
  return Array.from(daySet).sort();
}

export function getSnapshotForDay(categoryId: string, day: string): TrendSnapshot | null {
  const matches = trendHistory.snapshots.filter(
    s => s.categoryId === categoryId && s.capturedAt.startsWith(day)
  );
  return matches[matches.length - 1] ?? null;
}

export function getContenderOddsFromSnapshot(
  snapshot: TrendSnapshot | null,
  entry: Projection
): { nomination: number; winner: number } | null {
  if (!snapshot) return null;
  const key = trendKeyForEntry(snapshot.categoryId, entry);
  const found = snapshot.entries.find(e => e.key === key);
  return found ? { nomination: found.nomination, winner: found.winner } : null;
}

export function formatSnapshotDay(yyyyMMdd: string): string {
  const d = new Date(`${yyyyMMdd}T12:00:00`);
  if (Number.isNaN(d.valueOf())) return yyyyMMdd;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function serializeStatePayload(): StatePayload {
  return {
    categoryId: state.categoryId,
    weights: state.weights,
    trendWindow: state.trendWindow,
    trendHistory: {
      version: trendHistory.version,
      snapshots: trendHistory.snapshots,
      lastSignatureByCategory: trendHistory.lastSignatureByCategory
    },
    categories: categories.map((category) => ({
      id: category.id,
      films: category.films
    })),
    lockedCategories: [...lockedCategories]
  };
}

export function applyStatePayload(parsed: unknown): void {
  if (!parsed || typeof parsed !== "object") return;
  const p = parsed as StatePayload;

  if (p.weights && typeof p.weights === "object") {
    state.weights.precursor = clamp(Number(p.weights.precursor || state.weights.precursor), 1, 95);
    state.weights.history = clamp(Number(p.weights.history || state.weights.history), 1, 95);
    state.weights.buzz = clamp(Number(p.weights.buzz || state.weights.buzz), 1, 95);
  }

  if (TREND_WINDOW_OPTIONS.includes(Number(p.trendWindow))) {
    state.trendWindow = Number(p.trendWindow);
  }

  if (typeof p.categoryId === "string" && categories.some((category) => category.id === p.categoryId)) {
    state.categoryId = p.categoryId;
  }

  if (Array.isArray(p.categories)) {
    // Reset every category to a fresh copy of its seed films before applying the
    // payload, so categories absent from the payload don't carry over stale film
    // data from a previous profile load.
    categories.forEach((cat) => {
      cat.films = categorySeeds[cat.id]
        ? categorySeeds[cat.id].map((f) => ({ ...f }))
        : createSeedFilms();
    });

    p.categories.forEach((storedCategory) => {
      if (!storedCategory || typeof storedCategory !== "object") return;
      const sc = storedCategory as Record<string, unknown>;
      const target = categories.find((category) => category.id === sc.id);
      if (!target || !Array.isArray(sc.films)) return;

      const films = (sc.films as unknown[]).map(parseFilmRecord).filter((f): f is Film => f !== null);
      if (films.length > 0) target.films = films;
    });
  }

  if (Array.isArray(p.lockedCategories)) {
    lockedCategories.clear();
    p.lockedCategories.forEach((id) => {
      if (typeof id === "string") lockedCategories.add(id);
    });
  }

  if (p.trendHistory && typeof p.trendHistory === "object") {
    const snapshots = Array.isArray(p.trendHistory.snapshots) ? p.trendHistory.snapshots : [];
    trendHistory.snapshots = snapshots
      .map((rawSnapshot) => {
        const snapshot = rawSnapshot as Record<string, unknown>;
        if (!snapshot || typeof snapshot !== "object") return null;
        if (typeof snapshot.categoryId !== "string") return null;
        const capturedAt = String(snapshot.capturedAt || "");
        const entries = Array.isArray(snapshot.entries)
          ? (snapshot.entries as unknown[])
              .map((rawEntry) => {
                const entry = rawEntry as Record<string, unknown>;
                if (!entry || typeof entry !== "object") return null;
                if (typeof entry.key !== "string") return null;
                return {
                  key: entry.key,
                  title: String(entry.title || ""),
                  nomination: clamp(Number(entry.nomination || 0), 0, 100),
                  winner: clamp(Number(entry.winner || 0), 0, 100)
                };
              })
              .filter((e): e is TrendEntry => e !== null)
          : [];
        if (!entries.length) return null;
        return {
          categoryId: snapshot.categoryId,
          capturedAt: capturedAt || new Date().toISOString(),
          sourceSnapshotId: snapshot.sourceSnapshotId ? String(snapshot.sourceSnapshotId) : null,
          entries
        };
      })
      .filter((s): s is TrendSnapshot => s !== null)
      .slice(-TREND_HISTORY_LIMIT);
    trendHistory.lastSignatureByCategory =
      p.trendHistory.lastSignatureByCategory && typeof p.trendHistory.lastSignatureByCategory === "object"
        ? { ...p.trendHistory.lastSignatureByCategory }
        : {};
  }
}

export function getLocalStorageKeyForProfile(profileId = state.profileId) {
  return `${STORAGE_KEY}.${profileId}`;
}

export function getForecastApiUrl(profileId = state.profileId) {
  return `${API_FORECAST_BASE_URL}/${encodeURIComponent(profileId)}`;
}

export function formatTimestamp(value: string | number | null): string {
  const date = new Date(value ?? "");
  if (Number.isNaN(date.valueOf())) return "Unknown";
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function formatTrendStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function normalizeMovieDetailKey(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

export function getTmdbSearchUrl(title: string): string {
  return `https://www.themoviedb.org/search?query=${encodeURIComponent(String(title || "").trim())}`;
}

export function normalizePosterRenderUrl(url: string): string {
  const value = String(url || "").trim();
  if (!value) return "";
  if (value.startsWith("/t/p/")) return `https://image.tmdb.org${value}`;
  if (value.startsWith("http://www.themoviedb.org/t/p/")) return value.replace("http://www.themoviedb.org/t/p/", "https://image.tmdb.org/t/p/");
  if (value.startsWith("https://www.themoviedb.org/t/p/")) return value.replace("https://www.themoviedb.org/t/p/", "https://image.tmdb.org/t/p/");
  return value;
}

export function buildPosterFallbackDataUrl(title: string): string {
  const safeTitle = String(title || "Selected Movie")
    .slice(0, 60)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f8edd9"/><stop offset="1" stop-color="#eadac2"/></linearGradient></defs><rect width="600" height="900" fill="url(#g)"/><text x="300" y="420" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" fill="#1e1a17">Poster Unavailable</text><text x="300" y="470" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#5f554a">${safeTitle}</text><text x="300" y="525" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#5f554a">TMDB Search Link Below</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Returns true for low-signal errors that are not worth reporting. */
export function isNoisyError(message: string, source?: string): boolean {
  if (!message) return true;
  // Errors from browser extensions have no actionable context for the app.
  if (source && /^(chrome|moz|safari)-extension:\/\//i.test(source)) return true;
  // Cross-origin script errors arrive with no detail (security restriction).
  if (message === "Script error." || message === "Script error") return true;
  return false;
}

export function buildPolylinePath(points: TrendPoint[], metric: "nomination" | "winner", width: number, height: number, minY: number, maxY: number): string {
  if (!points.length) return "";
  const range = Math.max(maxY - minY, 1);
  return points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width;
      const y = height - ((point[metric] - minY) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function serializeSharePayload(): CompactShare {
  // Only encode films whose slider values differ from the loaded seed values.
  // Omitting unchanged films keeps the LZ-compressed URL well under 2000 chars
  // even when the full contenders dataset spans 20+ categories.
  const sliders: Record<string, Record<string, [number, number, number]>> = {};
  for (const cat of categories) {
    const seeds = categorySeeds[cat.id] ?? [];
    const seedMap = new Map(seeds.map((f) => [f.title, f]));
    const overrides: Record<string, [number, number, number]> = {};
    for (const film of cat.films) {
      const seed = seedMap.get(film.title);
      if (
        !seed ||
        film.precursor !== seed.precursor ||
        film.history   !== seed.history   ||
        film.buzz      !== seed.buzz
      ) {
        overrides[film.title] = [film.precursor, film.history, film.buzz];
      }
    }
    if (Object.keys(overrides).length > 0) sliders[cat.id] = overrides;
  }
  return {
    v: 1,
    c: state.categoryId,
    w: [state.weights.precursor, state.weights.history, state.weights.buzz],
    t: state.trendWindow,
    s: sliders
  };
}

export function buildShareUrl(): string {
  const json = JSON.stringify(serializeSharePayload());
  const compressed = LZString.compressToEncodedURIComponent(json);
  return `${window.location.origin}${window.location.pathname}?share=${compressed}`;
}

export function exportContendersCsv(): string {
  const header = ["category_id", "category_name", "title", "studio", "precursor", "history", "buzz", "strength"];
  const rows = [header.join(",")];

  categories.forEach((category) => {
    category.films.forEach((film) => {
      rows.push(
        [
          csvEscape(category.id),
          csvEscape(category.name),
          csvEscape(film.title),
          csvEscape(film.studio),
          film.precursor,
          film.history,
          film.buzz,
          csvEscape(film.strength)
        ].join(",")
      );
    });
  });

  return rows.join("\n");
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function parseCsv(text: string): string[][] {
  const rows = [];
  let row = [];
  let value = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        value += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }

    i += 1;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ""));
}

export function importContendersCsv(text: string): void {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("CSV is empty or missing rows.");

  const headerMap = rows[0].map((name) => name.trim().toLowerCase());
  const requiredColumns = ["category_id", "title", "studio", "precursor", "history", "buzz", "strength"];
  const missingColumns = requiredColumns.filter((name) => !headerMap.includes(name));
  if (missingColumns.length > 0) {
    throw new Error(`Missing required columns: ${missingColumns.join(", ")}`);
  }

  const indexOf = (name: string): number => headerMap.indexOf(name);
  const filmsByCategory = new Map();

  rows.slice(1).forEach((entry, rowIndex) => {
    const categoryId = String(entry[indexOf("category_id")] || "").trim();
    const category = categories.find((item) => item.id === categoryId);
    if (!category) {
      throw new Error(`Unknown category_id "${categoryId}" on row ${rowIndex + 2}.`);
    }

    const film = parseFilmRecord({
      title: entry[indexOf("title")],
      studio: entry[indexOf("studio")],
      precursor: entry[indexOf("precursor")],
      history: entry[indexOf("history")],
      buzz: entry[indexOf("buzz")],
      strength: entry[indexOf("strength")]
    });

    if (!film) {
      throw new Error(`Invalid contender data on row ${rowIndex + 2}.`);
    }

    if (!filmsByCategory.has(categoryId)) filmsByCategory.set(categoryId, []);
    filmsByCategory.get(categoryId).push(film);
  });

  if (filmsByCategory.size === 0) throw new Error("CSV did not include any contenders.");

  categories.forEach((category) => {
    const importedFilms = filmsByCategory.get(category.id);
    if (importedFilms && importedFilms.length > 0) {
      category.films = importedFilms;
    }
  });
}

export function parseConsensusInput(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

export function applyConsensusRanking(
  category: Category,
  rankedTitles: string[]
): { matched: string[]; unmatched: string[] } {
  const matched: Array<{ film: Film; label: string }> = [];
  const unmatched: string[] = [];
  const usedIndices = new Set<number>();

  // Pre-compute normalized keys once — O(n) — to avoid redundant calls inside the loop.
  const filmKeys = category.films.map((f) => normalizeSignalKey(f.title));
  // Exact-match lookup: normalizedKey → first film index with that key.
  const exactMap = new Map<string, number>();
  for (let i = 0; i < filmKeys.length; i++) {
    if (!exactMap.has(filmKeys[i])) exactMap.set(filmKeys[i], i);
  }

  for (const label of rankedTitles) {
    const key = normalizeSignalKey(label);
    let foundIndex = -1;

    // Exact normalized match — O(1) map lookup
    const exactIdx = exactMap.get(key);
    if (exactIdx !== undefined && !usedIndices.has(exactIdx)) {
      foundIndex = exactIdx;
    }
    // Starts-with fallback (handles extra year / subtitle in stored title)
    if (foundIndex === -1) {
      for (let i = 0; i < filmKeys.length; i++) {
        if (usedIndices.has(i)) continue;
        if (filmKeys[i].startsWith(key) || key.startsWith(filmKeys[i])) { foundIndex = i; break; }
      }
    }

    if (foundIndex !== -1) {
      matched.push({ film: category.films[foundIndex], label });
      usedIndices.add(foundIndex);
    } else {
      unmatched.push(label);
    }
  }

  const N = matched.length;
  if (N === 1) {
    matched[0].film.precursor = CONSENSUS_TOP_SCORE;
  } else if (N > 1) {
    const bottom = Math.max(CONSENSUS_BOTTOM_FLOOR, CONSENSUS_TOP_SCORE - CONSENSUS_STEP * (N - 1));
    const step = (CONSENSUS_TOP_SCORE - bottom) / (N - 1);
    matched.forEach(({ film }, i) => {
      film.precursor = Math.round(clamp(CONSENSUS_TOP_SCORE - i * step, CONSENSUS_SCORE_MIN, CONSENSUS_SCORE_MAX));
    });
  }

  return { matched: matched.map(m => m.label), unmatched };
}

export function findBuzzSyncTargets(filmTitle: string, excludeCategoryId: string): Category[] {
  const key = normalizeSignalKey(filmTitle);
  return categories.filter((cat) => {
    if (cat.id === excludeCategoryId) return false;
    return cat.films.some((f) => normalizeSignalKey(f.title) === key);
  });
}

export interface BuildProjectionsOverrides {
  films?: Film[];
  weights?: Partial<NormalizedWeights>;
}
export function buildProjections(category: Category, overrides: BuildProjectionsOverrides | null = null): Projection[] {
  const rawFilms = overrides?.films ?? category.films;
  // When nominees are locked and no override films are supplied, only score
  // films that have been marked as nominated — the rest are excluded from odds.
  const films =
    !overrides?.films && lockedCategories.has(category.id)
      ? rawFilms.filter((f) => f.nominated)
      : rawFilms;
  let normalized;
  if (overrides?.weights) {
    const w = overrides.weights;
    const total = (w.precursor ?? 0) + (w.history ?? 0) + (w.buzz ?? 0) || 1;
    normalized = { precursor: (w.precursor ?? 0) / total, history: (w.history ?? 0) / total, buzz: (w.buzz ?? 0) / total };
  } else {
    normalized = normalizeWeights();
  }

  const scored = films.map((film, index) => {
    const scores = scoreFilm(category.id, film, normalized);
    return { ...film, ...scores, index };
  });

  const nominationTotal = scored.reduce((sum, item) => sum + item.nominationRaw, 0) || 1;
  const winnerTotal = scored.reduce((sum, item) => sum + item.winnerRaw, 0) || 1;
  const nomineeScale = category.nominees / Math.max(1, scored.length);

  const projections = scored
    .map((film) => {
      const nomination = calculateNominationOdds({
        nominationRaw: film.nominationRaw,
        nominationTotal,
        nomineeScale,
        uplift: NOMINATION_PERCENT_UPLIFT,
        min: 0.6,
        max: 99
      });
      const winner = calculateWinnerOdds({
        winnerRaw: film.winnerRaw,
        winnerTotal,
        nomination,
        winnerBase: category.winnerBase,
        uplift: WINNER_PERCENT_UPLIFT,
        min: 0.4,
        max: 92
      });

      return {
        index: film.index,
        categoryId: category.id,
        rawTitle: film.title,
        rawStudio: film.studio,
        title: getDisplayTitle(category.id, film.title, film.studio),
        nomination,
        winner,
        precursorContribution: film.precursorContribution,
        historyContribution: film.historyContribution,
        buzzContribution: film.buzzContribution,
        strengthMultiplier: film.strengthMultiplier,
        winnerHistoryMultiplier: film.winnerHistoryMultiplier
      };
    })
    .sort((a, b) => b.winner - a.winner);

  const displayLimit = getDisplayLimit(category);
  const topContenders = projections.slice(0, displayLimit);

  rebalanceCategory(topContenders, {
    winnerToNominationCap: WINNER_TO_NOMINATION_CAP,
    nominationBand: {
      minTotal: 90,
      maxTotal: 95,
      targetTotal: 93,
      minValue: 0.6,
      maxValue: 50
    },
    winnerBand: {
      minTotal: 30,
      maxTotal: 45,
      targetTotal: 38,
      minValue: 0.4,
      maxValue: 24
    }
  });

  return [...topContenders, ...projections.slice(displayLimit)];
}

/** Returns cached projections for the default (no-override) buildProjections call.
 *  The cache is keyed by categoryId and a version counter incremented in saveState(),
 *  so it is always coherent with the current film/weight state. */
export function getCachedProjections(category: Category): Projection[] {
  const key = `${category.id}::${projectionCacheVersion}`;
  const hit = projectionsCache.get(key);
  if (hit) return hit;
  const result = buildProjections(category);
  projectionsCache.set(key, result);
  return result;
}

// ── Bootstrap confidence intervals ───────────────────────────────────────────

/**
 * For each film in the category, runs the full scoring pipeline under every
 * bootstrap weight vector and collects the resulting nomination/winner odds.
 * Returns the 2.5th–97.5th percentile range for each film — a 95% CI that
 * reflects parameter uncertainty in the learned model weights.
 *
 * Results are computed once per category and cached in bootstrapCIByCategory
 * until saveState() invalidates the cache.
 */
export function computeCategoryBootstrapCI(
  category: Category
): Map<string, { nomLow: number; nomHigh: number; winLow: number; winHigh: number }> {
  type FilmCI = { noms: number[]; wins: number[] };
  const perFilm = new Map<string, FilmCI>(
    category.films.map(f => [f.title, { noms: [], wins: [] }])
  );

  for (const sample of bootstrapSamples) {
    const [p, h, b] = sample;
    const total = p + h + b || 1;
    const w: NormalizedWeights = { precursor: p / total, history: h / total, buzz: b / total };

    const scored = category.films.map(film => ({ film, ...scoreFilm(category.id, film, w) }));
    const nominationTotal = scored.reduce((s, x) => s + x.nominationRaw, 0) || 1;
    const winnerTotal     = scored.reduce((s, x) => s + x.winnerRaw, 0) || 1;
    const nomineeScale    = category.nominees / Math.max(1, scored.length);

    for (const s of scored) {
      const nom = calculateNominationOdds({
        nominationRaw: s.nominationRaw,
        nominationTotal,
        nomineeScale,
        uplift: NOMINATION_PERCENT_UPLIFT,
        min: 0.6,
        max: 99
      });
      const win = calculateWinnerOdds({
        winnerRaw: s.winnerRaw,
        winnerTotal,
        nomination: nom,
        winnerBase: category.winnerBase,
        uplift: WINNER_PERCENT_UPLIFT,
        min: 0.4,
        max: 92
      });
      const entry = perFilm.get(s.film.title);
      if (entry) { entry.noms.push(nom); entry.wins.push(win); }
    }
  }

  const result = new Map<string, { nomLow: number; nomHigh: number; winLow: number; winHigh: number }>();
  const q = (arr: number[], frac: number) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.max(0, Math.min(s.length - 1, Math.round(frac * (s.length - 1))))] ?? 0;
  };
  for (const [title, { noms, wins }] of perFilm) {
    result.set(title, {
      nomLow:  q(noms, 0.025), nomHigh: q(noms, 0.975),
      winLow:  q(wins, 0.025), winHigh: q(wins, 0.975)
    });
  }
  return result;
}

export function getCategoryBootstrapCI(
  category: Category
): Map<string, { nomLow: number; nomHigh: number; winLow: number; winHigh: number }> {
  if (!bootstrapSamples.length) return new Map();
  const cached = bootstrapCIByCategory.get(category.id);
  if (cached) return cached;
  const result = computeCategoryBootstrapCI(category);
  bootstrapCIByCategory.set(category.id, result);
  return result;
}

// ── Backtest interfaces ───────────────────────────────────────────────────

export interface BacktestCategorySummary {
  categoryId: string;
  nominationAccuracyAvg: number;
  winnerAccuracyPct: number;
  nominationBrierAvg: number;
  winnerBrierAvg: number;
}

export interface BacktestYearRow {
  year: number;
  ceremony: number;
  categoryId: string;
  nominationAccuracy: number;
  winnerCorrect: boolean;
  nominationBrierScore: number;
  winnerBrierScore: number;
  topPredicted: string;
  actualWinner: string;
}

export interface BacktestOverall {
  nominationAccuracyAvg: number;
  winnerAccuracyPct: number;
  nominationBrierAvg: number;
  winnerBrierAvg: number;
}

export interface BacktestApiResult {
  computedAt: string;
  yearsBacktested: number;
  yearRange: { from: number; to: number };
  overall: BacktestOverall;
  byCategory: BacktestCategorySummary[];
  byYear: BacktestYearRow[];
}

// Setter functions to allow mutation of exported `let` variables from other modules

export function setAppliedExternalSnapshotId(val: string | null) { appliedExternalSnapshotId = val; }
export function setSearchQuery(val: string) { searchQuery = val; }
export function setCompareMode(val: boolean) { compareMode = val; }
export function setCompareProfileId(val: string | null) { compareProfileId = val; }
export function setSnapshotCompareMode(val: boolean) { snapshotCompareMode = val; }
export function setSnapshotDateA(val: string | null) { snapshotDateA = val; }
export function setSnapshotDateB(val: string | null) { snapshotDateB = val; }
export function setPendingBuzzSync(val: { title: string; buzz: number; targets: Category[] } | null) { pendingBuzzSync = val; }
export function setPendingUndo(val: (() => void) | null) { pendingUndo = val; }
export function setUndoToastTimer(val: ReturnType<typeof setTimeout> | null) { undoToastTimer = val; }
export function setUserPresets(val: WeightPreset[]) { userPresets = val; }
export function setOddsMode(val: OddsMode) { oddsMode = val; }
export function setProjectionCacheVersion(val: number) { projectionCacheVersion = val; }
export function setBootstrapSamples(val: Array<[number, number, number]>) { bootstrapSamples = val; }
export function setJointProbData(val: JointProbData | null) { jointProbData = val; }
export function setFeatureImportanceData(val: FeatureImportanceData | null) { featureImportanceData = val; }
export function setBrierDecompData(val: BrierDecompData | null) { brierDecompData = val; }
export function setAbTestData(val: AbTestData | null) { abTestData = val; }
export function setPrRocData(val: PrRocData | null) { prRocData = val; }
export function setRollingErrorData(val: RollingErrorData | null) { rollingErrorData = val; }
export function setActiveSummaryCard(val: HTMLElement | null) { activeSummaryCard = val; }
export function setSummaryBarBuiltAtVersion(val: number) { summaryBarBuiltAtVersion = val; }
export function setProfileOptions(val: string[]) { profileOptions = val; }
export function setResolveUnlock(val: ((ok: boolean) => void) | null) { resolveUnlock = val; }
export function setUnlockProfileId(val: string) { unlockProfileId = val; }
export function setActivePosterRequestId(val: number) { activePosterRequestId = val; }
export function setIsBootstrapping(val: boolean) { isBootstrapping = val; }
export function setPosterFallbackActive(val: boolean) { posterFallbackActive = val; }
export function setBackendOfflineMode(val: boolean) { backendOfflineMode = val; }
export function setLastOddsRecalculatedAt(val: string | null) { lastOddsRecalculatedAt = val; }
export function setLastSourceSyncAt(val: string | null) { lastSourceSyncAt = val; }
export function setAuthDialogMode(val: "unlock" | "set" | "change" | null) { authDialogMode = val; }
export function setClientErrorFlushTimer(val: ReturnType<typeof setTimeout> | null) { clientErrorFlushTimer = val; }
export function setCategories(val: Category[]) { categories = val; }
export function setCategorySeeds(val: Record<string, Film[]>) { categorySeeds = val; }
export function setScheduledFilms(val: string[]) { scheduledFilms = val; }
export function setPriorCategoryWins(val: Record<string, Record<string, number>>) { priorCategoryWins = val; }
export function setRecentWinnerPenalty(val: Record<string, Record<string, number>>) { recentWinnerPenalty = val; }
export function setOverdueNarrativeBoost(val: Record<string, Record<string, number>>) { overdueNarrativeBoost = val; }
