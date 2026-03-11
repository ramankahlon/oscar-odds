/**
 * calibrate.ts
 *
 * Probability calibration for Oscar nomination and winner predictions.
 *
 * Background
 * ──────────
 * A model is *calibrated* if its stated probabilities match empirical
 * frequencies: of all films assigned 70% nomination odds, roughly 70% should
 * actually be nominated.  Miscalibration is common in scoring models because
 * the raw score is designed for ranking, not probability estimation.
 *
 * This script:
 *  1. Scores every contender in the 25-year historical dataset using the
 *     current learned weights and the same odds formulas as backtest.ts.
 *  2. Builds calibration curves (reliability diagrams) showing predicted
 *     probability vs actual frequency, binned at 10% resolution.
 *  3. Computes ECE (Expected Calibration Error) — the accuracy-weighted mean
 *     absolute deviation between predicted and actual within each bin.
 *  4. Fits Platt scaling parameters (A, B) via gradient descent on the binary
 *     cross-entropy loss.  Platt scaling is a one-feature logistic regression:
 *
 *       P_calibrated = sigmoid(A · raw_probability + B)
 *
 *     A > 1 sharpens (makes the model more decisive); A < 1 shrinks toward 0.5.
 *     B shifts the overall probability level up or down.
 *  5. Reports the calibration curve and ECE before and after Platt scaling.
 *  6. Writes data/calibration.json with the Platt parameters and curve data for
 *     the /api/calibration endpoint.
 *
 * Two separate Platt transforms are fitted:
 *  - Nomination: all contenders (nominated vs not)
 *  - Winner:     nominated contenders only (winner vs non-winner nominee)
 *
 * The winner scope is restricted to nominees because:
 *  (a) we only predict a winner from among nominees, and
 *  (b) including non-nominees (nearly always non-winners) would trivially
 *      inflate calibration quality.
 *
 * Usage:   npm run calibrate
 * Output:  data/calibration.json   (served by /api/calibration)
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { scoreFilm } from "../scoring-utils.js";
import { calculateNominationOdds, calculateWinnerOdds } from "../app-logic.js";
import type { NormalizedWeights } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_IDS = [
  "picture", "director", "actor", "actress",
  "supporting-actor", "supporting-actress"
] as const;

// Must match the values used in backtest.ts
const NOM_UPLIFT    = 1.14;
const WIN_UPLIFT    = 1.2;
const NOM_MIN       = 0.6;
const NOM_MAX       = 99;
const WIN_MIN       = 0.4;
const WIN_MAX       = 92;

const N_BINS        = 10;   // reliability diagram resolution
const PLATT_LR      = 0.05; // gradient descent learning rate for Platt fitting
const PLATT_ITERS   = 5000; // max GD iterations

// ── Types ────────────────────────────────────────────────────────────────────

interface DataPoint {
  /** Raw predicted probability in [0, 1] (i.e. odds / 100). */
  rawP: number;
  /** Ground-truth label: 1 = nominated / winner, 0 = not. */
  label: number;
}

interface BinStats {
  /** Bin centre (midpoint of 0.1-wide interval). */
  midpoint: number;
  /** Mean predicted probability in this bin. */
  avgPredicted: number;
  /** Fraction of positive labels in this bin (empirical frequency). */
  actualFreq: number;
  /** Number of data points in this bin. */
  count: number;
}

interface PlattParams { A: number; B: number }

interface CalibrationReport {
  platt:  PlattParams;
  eceBefore: number;
  eceAfter:  number;
  curveBefore: BinStats[];
  curveAfter:  BinStats[];
}

// ── Math helpers ─────────────────────────────────────────────────────────────

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-50, Math.min(50, x))));
}

/**
 * Platt scaling: P_calibrated = σ(A · logit(rawP) + B)
 *
 * Using logit(rawP) as the input — rather than rawP directly — ensures that
 * A=1, B=0 is the identity transform (no change), A>1 sharpens (spreads
 * probabilities toward 0 and 1), and A<1 compresses toward 0.5.
 *
 * Edge-case clamping avoids ±Inf for rawP near 0 or 1.
 */
function logit(p: number): number {
  const clamped = Math.max(1e-7, Math.min(1 - 1e-7, p));
  return Math.log(clamped / (1 - clamped));
}

function plattScale(rawP: number, A: number, B: number): number {
  return sigmoid(A * logit(rawP) + B);
}

// ── Platt fitting ─────────────────────────────────────────────────────────────

/**
 * Fits A and B by gradient descent on binary cross-entropy.
 *
 *   Loss = -Σ [ y·log(σ(A·x + B)) + (1-y)·log(1 - σ(A·x + B)) ]
 *   dL/dA = Σ (σ(A·x + B) - y) · x
 *   dL/dB = Σ (σ(A·x + B) - y)
 *
 * Initialised at A=1, B=0 (identity transform, no change).
 */
function fitPlatt(data: DataPoint[]): PlattParams {
  let A = 1.0, B = 0.0;
  const n = data.length;

  for (let t = 0; t < PLATT_ITERS; t++) {
    let dA = 0, dB = 0;
    for (const { rawP, label } of data) {
      const lgt = logit(rawP);           // feature = logit(raw probability)
      const err = sigmoid(A * lgt + B) - label;
      dA += err * lgt;
      dB += err;
    }
    A -= PLATT_LR * dA / n;
    B -= PLATT_LR * dB / n;
  }
  return { A, B };
}

// ── Calibration curve + ECE ───────────────────────────────────────────────────

interface BinStatsWithCalibrated extends BinStats {
  /** Mean Platt-calibrated probability for data points in this raw bin. */
  avgCalibrated: number;
}

/**
 * Bins data points by their RAW probability (A=1, B=0) and, for each raw bin,
 * computes:
 *   - Mean raw probability         (avgPredicted)
 *   - Empirical positive frequency (actualFreq)
 *   - Mean calibrated probability  (avgCalibrated, using supplied A/B)
 *
 * Binning by rawP keeps the same data points in each row for a clean
 * before-vs-after comparison.
 *
 * ECE is computed for both the raw and calibrated predictions.
 */
function calibrationCurve(data: DataPoint[], A: number, B: number): {
  bins:       BinStatsWithCalibrated[];
  eceRaw:     number;
  eceCal:     number;
} {
  const buckets = Array.from({ length: N_BINS }, () => ({
    rawPreds: [] as number[],
    calPreds: [] as number[],
    labels:   [] as number[]
  }));

  for (const { rawP, label } of data) {
    // Always bin by the RAW probability so the same points appear in each row
    const idx = Math.min(Math.floor(rawP * N_BINS), N_BINS - 1);
    buckets[idx].rawPreds.push(rawP);
    buckets[idx].calPreds.push(plattScale(rawP, A, B));
    buckets[idx].labels.push(label);
  }

  const bins: BinStatsWithCalibrated[] = [];
  let eceRaw = 0, eceCal = 0;
  const n = data.length;

  for (let i = 0; i < N_BINS; i++) {
    const { rawPreds, calPreds, labels } = buckets[i];
    if (!labels.length) continue;
    const m             = labels.length;
    const avgPredicted  = rawPreds.reduce((s, x) => s + x, 0) / m;
    const avgCalibrated = calPreds.reduce((s, x) => s + x, 0) / m;
    const actualFreq    = labels.reduce((s, x) => s + x, 0) / m;
    bins.push({ midpoint: (i + 0.5) / N_BINS, avgPredicted, actualFreq, count: m, avgCalibrated });
    eceRaw += (m / n) * Math.abs(avgPredicted  - actualFreq);
    eceCal += (m / n) * Math.abs(avgCalibrated - actualFreq);
  }

  return { bins, eceRaw, eceCal };
}

// ── Historical scoring ────────────────────────────────────────────────────────

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

interface RawHistory {
  years: Array<{
    year: number;
    categories: Record<string, RawCategory>;
  }>;
}

/**
 * Scores every contender in the historical dataset using the same pipeline as
 * backtest.ts, then returns two arrays of data points:
 *  - nomData: all contenders (nominated = label)
 *  - winData: nominated contenders only (winner = label)
 */
function collectDataPoints(weights: NormalizedWeights): {
  nomData: DataPoint[];
  winData: DataPoint[];
} {
  const raw: RawHistory = JSON.parse(
    readFileSync(join(__dirname, "../data/oscar-history.json"), "utf8")
  );

  const nomData: DataPoint[] = [];
  const winData: DataPoint[] = [];

  for (const year of raw.years) {
    for (const catId of CATEGORY_IDS) {
      const cat = year.categories[catId] as RawCategory | undefined;
      if (!cat?.contenders?.length) continue;

      // Build typed Film objects for scoreFilm
      const films = cat.contenders.map(c => ({
        title:    c.title,
        studio:   c.studio,
        precursor: c.precursor,
        history:   c.history,
        buzz:      c.buzz,
        strength: (c.strength === "High" || c.strength === "Low"
          ? c.strength : "Medium") as "High" | "Medium" | "Low",
        nominated: Boolean(c.nominated),
        winner:    Boolean(c.winner)
      }));

      const scored = films.map(film => ({ film, ...scoreFilm(catId, film, weights) }));

      const nominationTotal = scored.reduce((s, x) => s + x.nominationRaw, 0) || 1;
      const winnerTotal     = scored.reduce((s, x) => s + x.winnerRaw, 0) || 1;
      const nomineeScale    = cat.nominees / Math.max(1, films.length);

      for (const s of scored) {
        const nomOdds = calculateNominationOdds({
          nominationRaw:  s.nominationRaw,
          nominationTotal,
          nomineeScale,
          uplift: NOM_UPLIFT,
          min:    NOM_MIN,
          max:    NOM_MAX
        });
        nomData.push({ rawP: nomOdds / 100, label: s.film.nominated ? 1 : 0 });

        if (s.film.nominated) {
          const winOdds = calculateWinnerOdds({
            winnerRaw:  s.winnerRaw,
            winnerTotal,
            nomination: nomOdds,
            winnerBase: cat.winnerBase,
            uplift: WIN_UPLIFT,
            min:    WIN_MIN,
            max:    WIN_MAX
          });
          winData.push({ rawP: winOdds / 100, label: s.film.winner ? 1 : 0 });
        }
      }
    }
  }

  return { nomData, winData };
}

// ── Reporting ─────────────────────────────────────────────────────────────────

function fmt4(x: number): string { return x.toFixed(4); }
function fmtPct(x: number): string { return (x * 100).toFixed(1) + "%"; }

/**
 * Prints a side-by-side reliability diagram.
 *
 * Each row corresponds to one 10%-wide RAW-probability bin.  The same data
 * points appear in each row for the raw and Platt-calibrated columns, making
 * the before/after comparison direct.  Perfect calibration = Predicted≈Actual.
 */
function printCurveTable(label: string, bins: BinStatsWithCalibrated[]): void {
  console.log(`  ${label}:`);
  console.log(
    `  ${"Bin".padEnd(8)} ${"n".padStart(5)}  ` +
    `${"── Raw model ──────────────".padEnd(30)} ── Platt-scaled ──`
  );
  console.log(
    `  ${"".padEnd(8)} ${"".padStart(5)}  ` +
    `${"Predicted".padEnd(10)} ${"Actual".padEnd(10)} ${"Δ".padEnd(10)} ` +
    `${"Calibrated".padEnd(11)} ${"Δ"}`
  );
  console.log(`  ${"─".repeat(76)}`);
  for (const bin of bins) {
    const rawGap = bin.avgPredicted  - bin.actualFreq;
    const calGap = bin.avgCalibrated - bin.actualFreq;
    const flag   = Math.abs(rawGap) > 0.05 ? (rawGap > 0 ? "▼over " : "▲under") : "  ok  ";
    console.log(
      `  ${fmtPct(bin.midpoint).padEnd(8)} ${String(bin.count).padStart(5)}  ` +
      `${fmtPct(bin.avgPredicted).padEnd(10)} ${fmtPct(bin.actualFreq).padEnd(10)} ` +
      `${((rawGap >= 0 ? "+" : "") + (rawGap * 100).toFixed(1) + "pp").padEnd(10)} ` +
      `${fmtPct(bin.avgCalibrated).padEnd(11)} ` +
      `${((calGap >= 0 ? "+" : "") + (calGap * 100).toFixed(1) + "pp").padEnd(9)} ${flag}`
    );
  }
  console.log("");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Load learned weights (falls back to baseline if not yet generated)
  let weights: NormalizedWeights = { precursor: 0.58, history: 0.30, buzz: 0.12 };
  try {
    const lw = JSON.parse(
      readFileSync(join(__dirname, "../data/learned-weights.json"), "utf8")
    ) as { weights?: { precursor?: number; history?: number; buzz?: number } };
    const w = lw?.weights;
    if (typeof w?.precursor === "number" && typeof w?.history === "number" && typeof w?.buzz === "number") {
      weights = { precursor: w.precursor, history: w.history, buzz: w.buzz };
    }
  } catch {
    console.log("No learned-weights.json found — using baseline 58/30/12\n");
  }

  console.log(
    `Using weights: precursor=${(weights.precursor * 100).toFixed(0)}% ` +
    `history=${(weights.history * 100).toFixed(0)}% ` +
    `buzz=${(weights.buzz * 100).toFixed(0)}%\n`
  );

  console.log("Scoring historical contenders…");
  const { nomData, winData } = collectDataPoints(weights);
  console.log(`  Nomination data points: ${nomData.length}`);
  console.log(`  Winner data points (nominees only): ${winData.length}\n`);

  // ── Fit Platt parameters ─────────────────────────────────────────────────────
  const nomPlatt = fitPlatt(nomData);
  const winPlatt = fitPlatt(winData);

  // ── Calibration curves (binned by raw probability, showing both raw + Platt)
  const nomCurve = calibrationCurve(nomData, nomPlatt.A, nomPlatt.B);
  const winCurve = calibrationCurve(winData, winPlatt.A, winPlatt.B);

  // ── Print report ────────────────────────────────────────────────────────────
  console.log(`╔${"═".repeat(72)}╗`);
  console.log(`║  OSCAR ODDS — PROBABILITY CALIBRATION REPORT${"".padEnd(27)}║`);
  console.log(`║  Method: Platt scaling (logistic post-processing)${"".padEnd(22)}║`);
  console.log(`║  Data:   25 years (1999–2023) of Oscar history${"".padEnd(25)}║`);
  console.log(`╚${"═".repeat(72)}╝\n`);

  console.log(`  ${"Metric".padEnd(30)} ${"Raw Model".padEnd(12)} ${"Platt-Scaled".padEnd(13)} Δ`);
  console.log(`  ${"─".repeat(30)} ${"─".repeat(12)} ${"─".repeat(13)} ${"─".repeat(8)}`);

  const nomDelta = nomCurve.eceCal - nomCurve.eceRaw;
  const winDelta = winCurve.eceCal - winCurve.eceRaw;
  console.log(`  ${"Nomination ECE".padEnd(30)} ${fmt4(nomCurve.eceRaw).padEnd(12)} ${fmt4(nomCurve.eceCal).padEnd(13)} ${(nomDelta >= 0 ? "+" : "")}${fmt4(nomDelta)}`);
  console.log(`  ${"Winner ECE (nominees only)".padEnd(30)} ${fmt4(winCurve.eceRaw).padEnd(12)} ${fmt4(winCurve.eceCal).padEnd(13)} ${(winDelta >= 0 ? "+" : "")}${fmt4(winDelta)}`);

  console.log(`\n  Platt parameters`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  Nomination:   A = ${nomPlatt.A.toFixed(6)},  B = ${nomPlatt.B.toFixed(6)}`);
  console.log(`  Winner:       A = ${winPlatt.A.toFixed(6)},  B = ${winPlatt.B.toFixed(6)}`);
  console.log("");

  printCurveTable("Nomination calibration curve", nomCurve.bins);
  printCurveTable("Winner calibration curve (nominees only)", winCurve.bins);

  // ── Persist ─────────────────────────────────────────────────────────────────
  const toSerialBin = (b: BinStatsWithCalibrated) => ({
    midpoint:       Number(b.midpoint.toFixed(2)),
    avgPredicted:   Number(b.avgPredicted.toFixed(4)),
    actualFreq:     Number(b.actualFreq.toFixed(4)),
    avgCalibrated:  Number(b.avgCalibrated.toFixed(4)),
    count:          b.count
  });

  const output = {
    calibratedAt: new Date().toISOString(),
    method:       "platt-scaling",
    weightsUsed:  weights,
    samples: {
      nomination: nomData.length,
      winner:     winData.length
    },
    nomination: {
      platt: { A: Number(nomPlatt.A.toFixed(6)), B: Number(nomPlatt.B.toFixed(6)) },
      ece:   { raw: Number(nomCurve.eceRaw.toFixed(6)), calibrated: Number(nomCurve.eceCal.toFixed(6)) },
      curve: nomCurve.bins.map(toSerialBin)
    },
    winner: {
      platt: { A: Number(winPlatt.A.toFixed(6)), B: Number(winPlatt.B.toFixed(6)) },
      ece:   { raw: Number(winCurve.eceRaw.toFixed(6)), calibrated: Number(winCurve.eceCal.toFixed(6)) },
      curve: winCurve.bins.map(toSerialBin)
    }
  };

  const outPath = join(__dirname, "../data/calibration.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`Results written to ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
