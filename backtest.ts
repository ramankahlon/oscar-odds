import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { scoreFilm } from "./scoring-utils.js";
import { calculateNominationOdds, calculateWinnerOdds } from "./app-logic.js";
import type { Film, NormalizedWeights } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Types ──────────────────────────────────────────────────────────────────

export interface HistoricalContender extends Film {
  nominated: boolean;
  winner: boolean;
}

export type BacktestCategoryId =
  | "picture"
  | "director"
  | "actor"
  | "actress"
  | "supporting-actor"
  | "supporting-actress";

export interface CategoryYearResult {
  year: number;
  ceremony: number;
  categoryId: BacktestCategoryId;
  nominationAccuracy: number;
  winnerCorrect: boolean;
  nominationBrierScore: number;
  winnerBrierScore: number;
  topPredicted: string;
  actualWinner: string;
}

export interface CategorySummary {
  categoryId: BacktestCategoryId;
  nominationAccuracyAvg: number;
  winnerAccuracyPct: number;
  nominationBrierAvg: number;
  winnerBrierAvg: number;
}

export interface BacktestResult {
  computedAt: string;
  yearsBacktested: number;
  yearRange: { from: number; to: number };
  weights: NormalizedWeights;
  overall: {
    nominationAccuracyAvg: number;
    winnerAccuracyPct: number;
    nominationBrierAvg: number;
    winnerBrierAvg: number;
  };
  byCategory: CategorySummary[];
  byYear: CategoryYearResult[];
}

// ── Raw JSON schema ────────────────────────────────────────────────────────

interface RawContender {
  title: string;
  studio: string;
  precursor: number;
  history: number;
  buzz: number;
  strength: string;
  nominated: boolean;
  winner: boolean;
}

interface RawCategory {
  nominees: number;
  winnerBase: number;
  contenders: RawContender[];
}

interface RawYear {
  year: number;
  ceremony: number;
  categories: Record<string, RawCategory>;
}

interface RawHistory {
  schema: number;
  note: string;
  years: RawYear[];
}

// Load JSON once at module level
const CATEGORY_IDS: BacktestCategoryId[] = [
  "picture",
  "director",
  "actor",
  "actress",
  "supporting-actor",
  "supporting-actress"
];

const rawHistory = JSON.parse(
  readFileSync(join(__dirname, "data", "oscar-history.json"), "utf8")
) as RawHistory;

// ── Core scoring ───────────────────────────────────────────────────────────

function scoreYear(
  rawYear: RawYear,
  categoryId: BacktestCategoryId,
  weights: NormalizedWeights
): CategoryYearResult | null {
  const histCat = rawYear.categories[categoryId];
  if (!histCat || !Array.isArray(histCat.contenders) || histCat.contenders.length === 0) {
    return null;
  }

  const contenders: HistoricalContender[] = histCat.contenders.map((c) => ({
    title: c.title,
    studio: c.studio,
    precursor: c.precursor,
    history: c.history,
    buzz: c.buzz,
    strength: (c.strength === "High" || c.strength === "Medium" || c.strength === "Low")
      ? c.strength
      : "Low",
    nominated: Boolean(c.nominated),
    winner: Boolean(c.winner)
  }));

  // Score each contender
  const scored = contenders.map((contender) => {
    const result = scoreFilm(categoryId, contender, weights);
    return { contender, ...result };
  });

  const nominationTotal = scored.reduce((sum, s) => sum + s.nominationRaw, 0) || 1;
  const winnerTotal = scored.reduce((sum, s) => sum + s.winnerRaw, 0) || 1;
  const nomineeScale = histCat.nominees / Math.max(1, contenders.length);

  // Calculate odds for each contender
  const withOdds = scored.map((s) => {
    const nominationOdds = calculateNominationOdds({
      nominationRaw: s.nominationRaw,
      nominationTotal,
      nomineeScale,
      uplift: 1.14,
      min: 0.6,
      max: 99
    });
    const winnerOdds = calculateWinnerOdds({
      winnerRaw: s.winnerRaw,
      winnerTotal,
      nomination: nominationOdds,
      winnerBase: histCat.winnerBase,
      uplift: 1.2,
      min: 0.4,
      max: 92
    });
    return { contender: s.contender, nominationOdds, winnerOdds };
  });

  // Nomination accuracy: sort by nominationOdds desc, take top N, count overlap
  const byNomination = [...withOdds].sort((a, b) => b.nominationOdds - a.nominationOdds);
  const topN = byNomination.slice(0, histCat.nominees);
  const actualNominees = contenders.filter((c) => c.nominated);
  const actualNomineeSet = new Set(actualNominees.map((c) => c.title));
  const correctNominations = topN.filter((e) => actualNomineeSet.has(e.contender.title)).length;
  const nominationAccuracy = histCat.nominees > 0 ? correctNominations / histCat.nominees : 0;

  // Winner correct: index-0 of desc-sorted-by-winnerOdds has winner===true
  const byWinner = [...withOdds].sort((a, b) => b.winnerOdds - a.winnerOdds);
  const topWinner = byWinner[0];
  const winnerCorrect = Boolean(topWinner?.contender.winner);
  const topPredicted = topWinner?.contender.title ?? "";
  const actualWinner = contenders.find((c) => c.winner)?.title ?? "";

  // Brier score (nomination): mean_i[(nominationOdds_i/100 - (nominated_i ? 1 : 0))^2]
  const nominationBrierScore =
    withOdds.reduce((sum, e) => {
      const p = e.nominationOdds / 100;
      const o = e.contender.nominated ? 1 : 0;
      return sum + (p - o) ** 2;
    }, 0) / withOdds.length;

  // Brier score (winner): mean_i[(winnerOdds_i/100 - (winner_i ? 1 : 0))^2]
  const winnerBrierScore =
    withOdds.reduce((sum, e) => {
      const p = e.winnerOdds / 100;
      const o = e.contender.winner ? 1 : 0;
      return sum + (p - o) ** 2;
    }, 0) / withOdds.length;

  return {
    year: rawYear.year,
    ceremony: rawYear.ceremony,
    categoryId,
    nominationAccuracy,
    winnerCorrect,
    nominationBrierScore,
    winnerBrierScore,
    topPredicted,
    actualWinner
  };
}

// ── Aggregation ────────────────────────────────────────────────────────────

export function runBacktest(weights: NormalizedWeights): BacktestResult {
  const byYear: CategoryYearResult[] = [];

  for (const rawYear of rawHistory.years) {
    for (const categoryId of CATEGORY_IDS) {
      const result = scoreYear(rawYear, categoryId, weights);
      if (result) byYear.push(result);
    }
  }

  // Overall aggregates
  const nominationAccuracyAvg =
    byYear.reduce((sum, r) => sum + r.nominationAccuracy, 0) / (byYear.length || 1);
  const winnerAccuracyPct =
    (byYear.filter((r) => r.winnerCorrect).length / (byYear.length || 1)) * 100;
  const nominationBrierAvg =
    byYear.reduce((sum, r) => sum + r.nominationBrierScore, 0) / (byYear.length || 1);
  const winnerBrierAvg =
    byYear.reduce((sum, r) => sum + r.winnerBrierScore, 0) / (byYear.length || 1);

  // By category
  const byCategory: CategorySummary[] = CATEGORY_IDS.map((categoryId) => {
    const rows = byYear.filter((r) => r.categoryId === categoryId);
    return {
      categoryId,
      nominationAccuracyAvg:
        rows.reduce((sum, r) => sum + r.nominationAccuracy, 0) / (rows.length || 1),
      winnerAccuracyPct:
        (rows.filter((r) => r.winnerCorrect).length / (rows.length || 1)) * 100,
      nominationBrierAvg:
        rows.reduce((sum, r) => sum + r.nominationBrierScore, 0) / (rows.length || 1),
      winnerBrierAvg:
        rows.reduce((sum, r) => sum + r.winnerBrierScore, 0) / (rows.length || 1)
    };
  });

  const years = rawHistory.years.map((y) => y.year);
  return {
    computedAt: new Date().toISOString(),
    yearsBacktested: rawHistory.years.length,
    yearRange: {
      from: Math.min(...years),
      to: Math.max(...years)
    },
    weights,
    overall: { nominationAccuracyAvg, winnerAccuracyPct, nominationBrierAvg, winnerBrierAvg },
    byCategory,
    byYear
  };
}

// ── In-memory cache ────────────────────────────────────────────────────────

let cache: BacktestResult | null = null;

export function getBacktestResult(): BacktestResult {
  if (!cache) {
    cache = runBacktest({ precursor: 0.58, history: 0.30, buzz: 0.12 });
  }
  return cache;
}
