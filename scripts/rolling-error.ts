/**
 * scripts/rolling-error.ts
 *
 * Rolling Forecast Error — year-by-year aggregation of model performance
 * over the 25-year Oscar history (1999-2023).
 *
 * For each ceremony year this script computes:
 *   • Winner Brier Score  (avg across the 6 main categories)
 *   • Nomination Brier Score
 *   • Winner Accuracy     (% of categories where top-ranked film won)
 *   • Nomination Accuracy (avg fraction of nominees correctly predicted)
 *
 * It also computes:
 *   • 3-year and 5-year centred rolling averages for each metric
 *   • OLS trend line (slope, intercept, R²) for winner Brier and winner accuracy
 *   • Per-category per-year breakdown (winnerCorrect, winnerBrier, nomBrier)
 *
 * Output: data/rolling-error.json
 * Usage:  npm run rolling-error
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBacktest } from "../backtest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const DATA_DIR   = join(__dirname, "../data");

// ── Run backtest with default weights ─────────────────────────────────────────

import { readFileSync } from "node:fs";
import type { NormalizedWeights } from "../types.js";

function loadWeights(): NormalizedWeights {
  try {
    const raw = JSON.parse(
      readFileSync(join(DATA_DIR, "learned-weights.json"), "utf8")
    ) as { weights?: { precursor?: unknown; history?: unknown; buzz?: unknown } };
    const w = raw?.weights;
    if (
      typeof w?.precursor === "number" &&
      typeof w?.history   === "number" &&
      typeof w?.buzz      === "number" &&
      Math.abs((w.precursor as number) + (w.history as number) + (w.buzz as number) - 1) < 0.02
    ) {
      return { precursor: w.precursor as number, history: w.history as number, buzz: w.buzz as number };
    }
  } catch { /* fallback */ }
  return { precursor: 0.58, history: 0.30, buzz: 0.12 };
}

const weights = loadWeights();
console.log(`Using weights: ${JSON.stringify(weights)}`);

const result = runBacktest(weights);
const { byYear } = result;

// ── Group by year ─────────────────────────────────────────────────────────────

const CATEGORY_IDS = [
  "picture", "director", "actor", "actress", "supporting-actor", "supporting-actress"
] as const;

const yearSet = [...new Set(byYear.map(r => r.year))].sort((a, b) => a - b);

interface YearAgg {
  year:                  number;
  ceremony:              number;
  winnerBrierAvg:        number;
  nominationBrierAvg:    number;
  winnerAccuracyPct:     number;   // 0–100
  nominationAccuracyAvg: number;   // 0–1
}

interface CatYearRow {
  year:           number;
  winnerCorrect:  boolean;
  winnerBrier:    number;
  nomBrier:       number;
}

const annualRows: YearAgg[] = [];
const byCategory: Record<string, CatYearRow[]> = Object.fromEntries(CATEGORY_IDS.map(c => [c, []]));

for (const y of yearSet) {
  const rows = byYear.filter(r => r.year === y);
  const ceremony = rows[0]?.ceremony ?? 0;

  const winnerBrierAvg        = rows.reduce((s, r) => s + r.winnerBrierScore, 0)     / rows.length;
  const nominationBrierAvg    = rows.reduce((s, r) => s + r.nominationBrierScore, 0) / rows.length;
  const winnerAccuracyPct     = (rows.filter(r => r.winnerCorrect).length / rows.length) * 100;
  const nominationAccuracyAvg = rows.reduce((s, r) => s + r.nominationAccuracy, 0)   / rows.length;

  annualRows.push({ year: y, ceremony, winnerBrierAvg, nominationBrierAvg, winnerAccuracyPct, nominationAccuracyAvg });

  for (const catId of CATEGORY_IDS) {
    const r = rows.find(x => x.categoryId === catId);
    if (r) {
      byCategory[catId].push({
        year:          r.year,
        winnerCorrect: r.winnerCorrect,
        winnerBrier:   r.winnerBrierScore,
        nomBrier:      r.nominationBrierScore,
      });
    }
  }
}

// ── Rolling averages ──────────────────────────────────────────────────────────

/** Centred window rolling mean; edges use available data only. */
function rollingMean(vals: number[], half: number): number[] {
  return vals.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(vals.length - 1, i + half);
    const slice = vals.slice(lo, hi + 1);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
}

const wbVals  = annualRows.map(r => r.winnerBrierAvg);
const nbVals  = annualRows.map(r => r.nominationBrierAvg);
const waVals  = annualRows.map(r => r.winnerAccuracyPct);
const naVals  = annualRows.map(r => r.nominationAccuracyAvg);

const roll3WB  = rollingMean(wbVals,  1);  // half=1 → window=3
const roll5WB  = rollingMean(wbVals,  2);  // half=2 → window=5
const roll3WA  = rollingMean(waVals,  1);
const roll5WA  = rollingMean(waVals,  2);

// ── OLS trend ─────────────────────────────────────────────────────────────────

function olsTrend(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 };
  const xm = xs.reduce((s, v) => s + v, 0) / n;
  const ym = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i]-xm)**2; sxy += (xs[i]-xm)*(ys[i]-ym); syy += (ys[i]-ym)**2; }
  const slope = sxx > 1e-12 ? sxy / sxx : 0;
  const intercept = ym - slope * xm;
  const r2 = syy > 1e-12 ? sxy**2 / (sxx * syy) : 0;
  return { slope, intercept, r2 };
}

const years0 = annualRows.map(r => r.year - annualRows[0].year);  // years since first

const wbTrend = olsTrend(years0, wbVals);
const waTrend = olsTrend(years0, waVals);

// ── Assemble final rows ────────────────────────────────────────────────────────

const years = annualRows.map((r, i) => ({
  year:                  r.year,
  ceremony:              r.ceremony,
  winnerBrierAvg:        r.winnerBrierAvg,
  nominationBrierAvg:    r.nominationBrierAvg,
  winnerAccuracyPct:     r.winnerAccuracyPct,
  nominationAccuracyAvg: r.nominationAccuracyAvg,
  roll3WinnerBrier:      roll3WB[i],
  roll5WinnerBrier:      roll5WB[i],
  roll3WinnerAccuracy:   roll3WA[i],
  roll5WinnerAccuracy:   roll5WA[i],
  trendWinnerBrier:      wbTrend.intercept + wbTrend.slope * years0[i],
  trendWinnerAccuracy:   waTrend.intercept + waTrend.slope * years0[i],
}));

// ── Summary ────────────────────────────────────────────────────────────────────

console.log("\nYear  CerWin%  WinBrier  NomBrier  Roll3WB");
for (const r of years) {
  console.log(
    `${r.year}  ${r.winnerAccuracyPct.toFixed(0).padStart(5)}%  ` +
    `${r.winnerBrierAvg.toFixed(5)}  ${r.nominationBrierAvg.toFixed(5)}  ${r.roll3WinnerBrier.toFixed(5)}`
  );
}
console.log(`\nWinner Brier trend:    slope=${wbTrend.slope.toFixed(6)}/yr  R²=${wbTrend.r2.toFixed(4)}`);
console.log(`Winner Accuracy trend: slope=${waTrend.slope.toFixed(3)}pp/yr  R²=${waTrend.r2.toFixed(4)}`);

// ── Write output ───────────────────────────────────────────────────────────────

const output = {
  generatedAt: new Date().toISOString(),
  weights,
  yearRange: result.yearRange,
  trend: {
    winnerBrier:     { ...wbTrend, unit: "BS/yr" },
    winnerAccuracy:  { ...waTrend, unit: "pp/yr"  },
  },
  years,
  byCategory,
};

const outPath = join(DATA_DIR, "rolling-error.json");
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`\nWrote ${outPath}`);
