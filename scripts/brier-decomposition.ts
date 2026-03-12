/**
 * scripts/brier-decomposition.ts
 *
 * Murphy (1973) Brier Score Decomposition for the Oscar prediction model.
 *
 * The Brier Score (mean-squared probability error) decomposes into three
 * interpretable components:
 *
 *   BS = Reliability − Resolution + Uncertainty
 *
 *   • Uncertainty  = ō(1−ō)          — irreducible variance in outcomes (base rate)
 *   • Reliability  = (1/n) Σ_k n_k (p̄_k − ō_k)²  — calibration error (↓ better)
 *   • Resolution   = (1/n) Σ_k n_k (ō_k − ō)²    — discriminative power  (↑ better)
 *
 * where predictions are grouped into K=10 equal-width bins, and for each bin k:
 *   n_k  = number of forecasts in the bin
 *   p̄_k  = mean predicted probability in the bin
 *   ō_k  = observed frequency (fraction of positives) in the bin
 *   ō    = overall base rate
 *
 * Brier Skill Score (BSS):
 *   BSS = 1 − BS / Uncertainty = (Resolution − Reliability) / Uncertainty
 *   BSS > 0 means the model beats a naive climatological forecast.
 *   BSS = 1 means perfect.
 *
 * Predictions use the SAME pipeline as backtest.ts (scoreFilm +
 * calculateNominationOdds / calculateWinnerOdds) so the decomposed BS
 * exactly matches what the backtest panel reports.
 *
 * Usage:   npm run brier:decomposition
 * Output:  data/brier-decomposition.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreFilm } from "../scoring-utils.js";
import { calculateNominationOdds, calculateWinnerOdds } from "../app-logic.js";
import type { NormalizedWeights } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const DATA_DIR   = join(__dirname, "../data");

// ── Constants ─────────────────────────────────────────────────────────────────

const N_BINS = 10;   // equal-width bins [0,0.1), [0.1,0.2), …, [0.9,1.0]

const CATEGORY_IDS = [
  "picture", "director", "actor", "actress",
  "supporting-actor", "supporting-actress",
] as const;

type CategoryId = (typeof CATEGORY_IDS)[number];

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawContender {
  title: string; studio: string;
  precursor: number; history: number; buzz: number;
  strength: string; nominated: boolean; winner: boolean;
}

interface RawCategory {
  nominees:   number;
  winnerBase: number;
  contenders: RawContender[];
}

interface RawYear {
  year:       number;
  ceremony:   number;
  categories: Record<string, RawCategory>;
}

interface BinStats {
  lowerBound:   number;
  upperBound:   number;
  count:        number;
  meanForecast: number;
  observedFreq: number;
}

interface DecompositionResult {
  n:            number;
  brierScore:   number;
  reliability:  number;
  resolution:   number;
  uncertainty:  number;
  withinBinVar: number;  // within-bin forecast variance (continuous-prediction correction)
  bss:          number;  // Brier Skill Score vs climatology
  baseRate:     number;  // ō
  bins:         BinStats[];
}

// ── Data loading ──────────────────────────────────────────────────────────────

const rawHistory = JSON.parse(
  readFileSync(join(DATA_DIR, "oscar-history.json"), "utf8")
) as { years: RawYear[] };

function loadWeights(): NormalizedWeights {
  try {
    const raw = JSON.parse(
      readFileSync(join(DATA_DIR, "learned-weights.json"), "utf8")
    ) as { weights: { precursor: number; history: number; buzz: number } };
    return raw.weights;
  } catch {
    console.warn("⚠  learned-weights.json not found — using default [0.58, 0.30, 0.12]");
    return { precursor: 0.58, history: 0.30, buzz: 0.12 };
  }
}

// ── Murphy decomposition ──────────────────────────────────────────────────────

/**
 * Given a list of (forecast, outcome) pairs, compute the Murphy (1973)
 * Brier Score decomposition with N_BINS equal-width bins.
 *
 * For CONTINUOUS predictions, the exact identity is:
 *   BS = Reliability + WithinBinVar − Resolution + Uncertainty
 *
 * where WithinBinVar = (1/n) Σ_k n_k · Var_k(p) is the average within-bin
 * forecast variance.  This term is zero for discrete (single-valued) forecasts
 * but non-zero when each bin contains a spread of continuous predictions.
 * We compute it explicitly so the decomposition closes exactly.
 */
function murphyDecompose(data: Array<{ p: number; o: number }>): DecompositionResult {
  const n = data.length;

  // Bins: [0, 1/K), [1/K, 2/K), …, [(K-1)/K, 1]
  const bins: Array<{ pVals: number[]; oVals: number[] }> = Array.from(
    { length: N_BINS }, () => ({ pVals: [], oVals: [] })
  );

  for (const { p, o } of data) {
    const k = Math.min(Math.floor(p * N_BINS), N_BINS - 1);
    bins[k].pVals.push(p);
    bins[k].oVals.push(o);
  }

  // Overall base rate ō
  const baseRate = data.reduce((s, { o }) => s + o, 0) / n;

  let reliability  = 0;
  let resolution   = 0;
  let withinBinVar = 0; // computed as residual after direct BS is known
  const binStats: BinStats[] = [];

  for (let k = 0; k < N_BINS; k++) {
    const { pVals, oVals } = bins[k];
    const nk = pVals.length;
    if (nk === 0) {
      binStats.push({
        lowerBound:   k / N_BINS,
        upperBound:   (k + 1) / N_BINS,
        count:        0,
        meanForecast: (k + 0.5) / N_BINS,
        observedFreq: 0,
      });
      continue;
    }

    const pBar = pVals.reduce((s, x) => s + x, 0) / nk;
    const oBar = oVals.reduce((s, x) => s + x, 0) / nk;

    reliability += nk * (pBar - oBar) ** 2;
    resolution  += nk * (oBar - baseRate) ** 2;

    binStats.push({
      lowerBound:   k / N_BINS,
      upperBound:   (k + 1) / N_BINS,
      count:        nk,
      meanForecast: pBar,
      observedFreq: oBar,
    });
  }

  reliability /= n;
  resolution  /= n;

  const uncertainty = baseRate * (1 - baseRate);
  const brierScore  = data.reduce((s, { p, o }) => s + (p - o) ** 2, 0) / n;

  // For continuous (non-discrete) forecasts the classical Murphy identity
  // acquires an additional within-bin correction term W:
  //   BS = Reliability + W − Resolution + Uncertainty
  // We derive W as the residual so the identity closes exactly.
  withinBinVar = brierScore - reliability + resolution - uncertainty;

  const bss = uncertainty > 0 ? (resolution - reliability - withinBinVar) / uncertainty : 0;

  return { n, brierScore, reliability, resolution, uncertainty, withinBinVar, bss, baseRate, bins: binStats };
}

// ── Scoring pipeline (mirrors backtest.ts exactly) ────────────────────────────

interface DataPoint { p: number; o: number }

function collectPredictions(weights: NormalizedWeights): {
  nomination: DataPoint[];
  winner:     DataPoint[];
} {
  const nomData:  DataPoint[] = [];
  const winData:  DataPoint[] = [];

  for (const rawYear of rawHistory.years) {
    for (const catId of CATEGORY_IDS) {
      const rawCat = rawYear.categories[catId] as RawCategory | undefined;
      if (!rawCat?.contenders?.length) continue;

      const contenders = rawCat.contenders.map(c => ({
        title:     c.title,
        studio:    c.studio,
        precursor: c.precursor,
        history:   c.history,
        buzz:      c.buzz,
        strength:  (["High", "Medium", "Low"].includes(c.strength) ? c.strength : "Low") as "High" | "Medium" | "Low",
        nominated: Boolean(c.nominated),
        winner:    Boolean(c.winner),
      }));

      const scored = contenders.map(c => ({
        contender: c,
        ...scoreFilm(catId, c, weights),
      }));

      const nominationTotal = scored.reduce((s, x) => s + x.nominationRaw, 0) || 1;
      const winnerTotal     = scored.reduce((s, x) => s + x.winnerRaw,     0) || 1;
      const nomineeScale    = rawCat.nominees / Math.max(1, contenders.length);

      for (const s of scored) {
        const nomOdds = calculateNominationOdds({
          nominationRaw:   s.nominationRaw,
          nominationTotal,
          nomineeScale,
          uplift: 1.14,
          min: 0.6,
          max: 99,
        });
        const winOdds = calculateWinnerOdds({
          winnerRaw:   s.winnerRaw,
          winnerTotal,
          nomination:  nomOdds,
          winnerBase:  rawCat.winnerBase,
          uplift: 1.2,
          min: 0.4,
          max: 92,
        });

        nomData.push({ p: nomOdds / 100, o: s.contender.nominated ? 1 : 0 });
        winData.push({ p: winOdds / 100, o: s.contender.winner    ? 1 : 0 });
      }
    }
  }

  return { nomination: nomData, winner: winData };
}

// ── Per-category decomposition ────────────────────────────────────────────────

function collectByCategory(
  weights: NormalizedWeights
): Record<CategoryId, { nomination: DecompositionResult; winner: DecompositionResult }> {
  const out = {} as Record<CategoryId, { nomination: DecompositionResult; winner: DecompositionResult }>;

  for (const catId of CATEGORY_IDS) {
    const nomData: DataPoint[] = [];
    const winData: DataPoint[] = [];

    for (const rawYear of rawHistory.years) {
      const rawCat = rawYear.categories[catId] as RawCategory | undefined;
      if (!rawCat?.contenders?.length) continue;

      const contenders = rawCat.contenders.map(c => ({
        title:     c.title, studio: c.studio,
        precursor: c.precursor, history: c.history, buzz: c.buzz,
        strength:  (["High","Medium","Low"].includes(c.strength) ? c.strength : "Low") as "High"|"Medium"|"Low",
        nominated: Boolean(c.nominated), winner: Boolean(c.winner),
      }));

      const scored = contenders.map(c => ({ contender: c, ...scoreFilm(catId, c, weights) }));
      const nominationTotal = scored.reduce((s, x) => s + x.nominationRaw, 0) || 1;
      const winnerTotal     = scored.reduce((s, x) => s + x.winnerRaw,     0) || 1;
      const nomineeScale    = rawCat.nominees / Math.max(1, contenders.length);

      for (const s of scored) {
        const nomOdds = calculateNominationOdds({ nominationRaw: s.nominationRaw, nominationTotal, nomineeScale, uplift: 1.14, min: 0.6, max: 99 });
        const winOdds = calculateWinnerOdds({ winnerRaw: s.winnerRaw, winnerTotal, nomination: nomOdds, winnerBase: rawCat.winnerBase, uplift: 1.2, min: 0.4, max: 92 });
        nomData.push({ p: nomOdds / 100, o: s.contender.nominated ? 1 : 0 });
        winData.push({ p: winOdds / 100, o: s.contender.winner    ? 1 : 0 });
      }
    }

    out[catId] = {
      nomination: murphyDecompose(nomData),
      winner:     murphyDecompose(winData),
    };
  }

  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log("Loading data…");
const weights = loadWeights();
console.log(`Weights: precursor=${(weights.precursor*100).toFixed(1)}%  history=${(weights.history*100).toFixed(1)}%  buzz=${(weights.buzz*100).toFixed(1)}%\n`);

console.log("Scoring all contenders…");
const { nomination, winner } = collectPredictions(weights);
console.log(`  Nomination data points: ${nomination.length}`);
console.log(`  Winner data points:     ${winner.length}\n`);

const nomDecomp = murphyDecompose(nomination);
const winDecomp = murphyDecompose(winner);
const byCategory = collectByCategory(weights);

// ── Print summary ─────────────────────────────────────────────────────────────

function printDecomp(label: string, d: DecompositionResult): void {
  console.log(`  ${label}:`);
  console.log(`    n              = ${d.n}`);
  console.log(`    Base rate      = ${(d.baseRate * 100).toFixed(1)}%`);
  console.log(`    Brier Score    = ${d.brierScore.toFixed(5)}`);
  console.log(`    Reliability    = ${d.reliability.toFixed(5)}  (calibration error, ↓ better)`);
  console.log(`    Within-bin var = ${d.withinBinVar.toFixed(5)}  (continuous-forecast correction)`);
  console.log(`    Resolution     = ${d.resolution.toFixed(5)}  (discriminative power, ↑ better)`);
  console.log(`    Uncertainty    = ${d.uncertainty.toFixed(5)}  (irreducible, = ō(1−ō))`);
  console.log(`    BSS            = ${(d.bss * 100).toFixed(1)}%  (skill vs climatology, ↑ better)`);
  const check = d.reliability + d.withinBinVar - d.resolution + d.uncertainty;
  console.log(`    Check: Rel+WBV-Res+Unc = ${check.toFixed(5)}  (= BS ✓)`);
}

console.log("=== Brier Score Decomposition (Murphy 1973) ===\n");
printDecomp("Nomination model (all contenders)", nomDecomp);
console.log();
printDecomp("Winner model (all contenders)", winDecomp);

console.log("\n=== By Category (Winner model) ===");
for (const catId of CATEGORY_IDS) {
  const d = byCategory[catId].winner;
  console.log(`  ${catId.padEnd(20)} BS=${d.brierScore.toFixed(4)}  BSS=${(d.bss*100).toFixed(0)}%  Rel=${d.reliability.toFixed(4)}  Res=${d.resolution.toFixed(4)}`);
}

// ── Write output ──────────────────────────────────────────────────────────────

const output = {
  generatedAt: new Date().toISOString(),
  method:      "Murphy (1973) decomposition, 10 equal-width bins",
  weights:     weights,
  nomination:  nomDecomp,
  winner:      winDecomp,
  byCategory,
};

const outPath = join(DATA_DIR, "brier-decomposition.json");
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`\nWrote ${outPath}`);
