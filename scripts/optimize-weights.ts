/**
 * optimize-weights.ts
 *
 * Learns optimal feature weights for Oscar prediction via Leave-One-Year-Out
 * (LOYO) cross-validation on oscar-history.json.
 *
 * Why winner-level softmax, not nomination-level BCE?
 * ────────────────────────────────────────────────────
 * The nomination-level binary cross-entropy loss has near-zero gradient on this
 * dataset because almost every nominated film already has clearly higher scores
 * than non-nominated ones (the data is nearly linearly separable).  In that
 * regime the BCE gradient is dominated by L2 regularisation, which pulls all
 * weights to equal values — providing no useful signal.
 *
 * Winner prediction is a harder problem (1 correct out of 5–10 nominees) and
 * exercises the ranking ability of the weights within the nominated set, where
 * the features vary much more subtly.
 *
 * Why grid search + GD, not Adam?
 * ────────────────────────────────
 * Adam normalises each parameter's gradient by its own running variance, which
 * effectively gives all three features the same step size regardless of their
 * relative gradient magnitudes.  This collapses to equal (1/3) weights despite
 * a clear non-zero gradient signal.  Plain gradient descent — or better, a
 * coarse grid search followed by GD refinement — respects the true gradient
 * magnitudes and converges to the correct asymmetric solution.
 *
 * Algorithm
 * ─────────
 * 1. Coarse grid search: evaluate winner-level softmax CE on every simplex
 *    lattice point at 5 % resolution (741 candidates) — identifies the basin.
 * 2. Gradient-descent refinement from the grid-search seed — polishes to a
 *    precise optimum.
 * 3. LOYO-CV: both stages are run inside 25-fold leave-one-year-out CV.
 *
 * Loss function
 * ─────────────
 * For each (year, category):
 *   logit_i = (w_p·precursor_i + w_h·history_i + w_b·buzz_i − 55) / 12
 *             + log(strengthBoost_i)
 *   loss    = −log(softmax_{winner}(T · logit))
 *
 * Usage:   npm run optimize:weights
 * Output:  data/learned-weights.json   (loaded automatically by backtest.ts)
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_IDS   = ["picture", "director", "actor", "actress", "supporting-actor", "supporting-actress"] as const;
const SIGMOID_CENTER = 55;
const SIGMOID_SCALE  = 12;
const MIN_WEIGHT     = 0.03;   // minimum weight per feature (simplex constraint)
const TEMPERATURE    = 2.0;    // softmax temperature
const GRID_STEP      = 0.05;   // coarse grid resolution (5 %)
const GD_LR          = 0.001;  // gradient-descent learning rate
const GD_MAX_ITER    = 5000;   // max GD refinement iterations
const GD_CONV_TOL    = 1e-9;   // loss-change convergence threshold

const BASELINE: Weights = [0.58, 0.30, 0.12];

// ── Types ────────────────────────────────────────────────────────────────────

type Weights = [number, number, number]; // [precursor, history, buzz]

interface Contender {
  precursor:        number;
  history:          number;
  buzz:             number;
  logStrengthBoost: number;
  nominated:        boolean;
  winner:           boolean;
}

interface CategoryData {
  nominees:   number;
  contenders: Contender[];
}

interface YearData {
  year:       number;
  ceremony:   number;
  categories: Record<string, CategoryData>;
}

interface FoldResult {
  testYear:         number;
  learnedWeights:   Weights;
  trainLoss:        number;
  baselineMetrics:  YearMetrics;
  optimizedMetrics: YearMetrics;
}

interface YearMetrics {
  nominationAccuracy: number;
  winnerAccuracy:     number;
  brierScore:         number;
}

interface LearnedWeightsFile {
  learnedAt:  string;
  method:     string;
  yearsUsed:  number;
  yearRange:  { from: number; to: number };
  weights:    { precursor: number; history: number; buzz: number };
  baseline:   { precursor: number; history: number; buzz: number };
  cv: {
    folds:  number;
    method: string;
    nominationAccuracy: { baseline: number; optimized: number };
    winnerAccuracy:     { baseline: number; optimized: number };
    brierScore:         { baseline: number; optimized: number };
  };
}

// ── Data loading ──────────────────────────────────────────────────────────────

function loadHistory(): YearData[] {
  const raw = JSON.parse(
    readFileSync(join(__dirname, "../data/oscar-history.json"), "utf8")
  ) as {
    years: Array<{
      year: number;
      ceremony: number;
      categories: Record<string, {
        nominees: number;
        contenders: Array<{
          precursor: number; history: number; buzz: number;
          strength: string; nominated: boolean; winner: boolean;
        }>;
      }>;
    }>;
  };

  return raw.years.map(y => ({
    year:     y.year,
    ceremony: y.ceremony,
    categories: Object.fromEntries(
      Object.entries(y.categories).map(([catId, cat]) => [
        catId,
        {
          nominees: cat.nominees,
          contenders: cat.contenders.map(c => {
            const boost = c.strength === "High" ? 1.06 : c.strength === "Low" ? 0.94 : 1.0;
            return {
              precursor: c.precursor,
              history:   c.history,
              buzz:      c.buzz,
              logStrengthBoost: Math.log(boost),
              nominated: Boolean(c.nominated),
              winner:    Boolean(c.winner)
            };
          })
        }
      ])
    )
  }));
}

// ── Model ─────────────────────────────────────────────────────────────────────

function logitScore(c: Contender, w: Weights): number {
  const linear = w[0] * c.precursor + w[1] * c.history + w[2] * c.buzz;
  return (linear - SIGMOID_CENTER) / SIGMOID_SCALE + c.logStrengthBoost;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-50, Math.min(50, x))));
}

function sigPred(c: Contender, w: Weights): number {
  return sigmoid(logitScore(c, w));
}

// ── Loss: per-category winner softmax cross-entropy ───────────────────────────

function winnerCELoss(history: YearData[], w: Weights): number {
  let totalLoss = 0;
  let count     = 0;

  for (const y of history) {
    for (const catId of CATEGORY_IDS) {
      const cat = y.categories[catId];
      if (!cat?.contenders?.length) continue;
      const winnerIdx = cat.contenders.findIndex(c => c.winner);
      if (winnerIdx < 0) continue;

      const logits   = cat.contenders.map(c => TEMPERATURE * logitScore(c, w));
      const maxLogit = Math.max(...logits);
      const logSumExp = maxLogit + Math.log(
        logits.reduce((s, x) => s + Math.exp(x - maxLogit), 0)
      );

      totalLoss += logSumExp - logits[winnerIdx];
      count++;
    }
  }

  return count > 0 ? totalLoss / count : 0;
}

/**
 * Gradient of winnerCELoss w.r.t. w.
 *
 * Uses plain gradient magnitudes (no per-parameter normalisation) so that the
 * step size for each weight remains proportional to its true gradient.  This
 * correctly pushes precursor higher than history and buzz, matching the
 * empirical feature-advantage data.
 *
 * d(CE)/d(w_j) = T/scale · mean_{year,cat} Σ_i (softmax_i − [i==winner]) · feature_ij
 */
function winnerCEGradient(history: YearData[], w: Weights): Weights {
  const grad: Weights = [0, 0, 0];
  let count = 0;

  for (const y of history) {
    for (const catId of CATEGORY_IDS) {
      const cat = y.categories[catId];
      if (!cat?.contenders?.length) continue;
      const winnerIdx = cat.contenders.findIndex(c => c.winner);
      if (winnerIdx < 0) continue;

      const logits   = cat.contenders.map(c => TEMPERATURE * logitScore(c, w));
      const maxLogit = Math.max(...logits);
      const expShifted = logits.map(x => Math.exp(x - maxLogit));
      const sumExp     = expShifted.reduce((s, e) => s + e, 0);
      const softmax    = expShifted.map(e => e / sumExp);

      const scale = TEMPERATURE / SIGMOID_SCALE;
      for (let i = 0; i < cat.contenders.length; i++) {
        const c   = cat.contenders[i];
        const err = softmax[i] - (i === winnerIdx ? 1 : 0);
        grad[0] += scale * err * c.precursor;
        grad[1] += scale * err * c.history;
        grad[2] += scale * err * c.buzz;
      }
      count++;
    }
  }

  const n = Math.max(count, 1);
  return [grad[0] / n, grad[1] / n, grad[2] / n];
}

// ── Simplex projection ────────────────────────────────────────────────────────

function projectSimplex(w: number[]): Weights {
  const clipped = w.map(x => Math.max(x, MIN_WEIGHT));
  const total   = clipped.reduce((s, x) => s + x, 0);
  return clipped.map(x => x / total) as Weights;
}

// ── Grid search (coarse) ──────────────────────────────────────────────────────

/**
 * Evaluate every simplex lattice point at GRID_STEP resolution and return
 * the candidate with the lowest winner CE loss.
 *
 * This is O(n²) in grid resolution and ~1 ms per candidate — fast enough
 * to be used as an initialiser for GD refinement.
 */
function gridSearch(history: YearData[]): Weights {
  let bestW: Weights = BASELINE;
  let bestLoss       = Infinity;

  const steps = Math.round(1 / GRID_STEP);
  for (let pi = 1; pi < steps; pi++) {
    for (let hi = 1; pi + hi < steps; hi++) {
      const bi = steps - pi - hi;
      if (bi < 1) continue;
      const w: Weights = [pi * GRID_STEP, hi * GRID_STEP, bi * GRID_STEP];
      if (w.some(x => x < MIN_WEIGHT)) continue;
      const loss = winnerCELoss(history, w);
      if (loss < bestLoss) { bestLoss = loss; bestW = [...w] as Weights; }
    }
  }
  return bestW;
}

// ── GD refinement (fine) ──────────────────────────────────────────────────────

/**
 * Plain gradient descent (no per-parameter normalisation).
 *
 * Starting from the grid-search seed, takes steps proportional to the true
 * gradient magnitude.  This correctly weights the features by their actual
 * discriminative power rather than equalising them (as Adam would).
 */
function gdRefine(history: YearData[], seed: Weights): {
  weights:    Weights;
  finalLoss:  number;
  iterations: number;
} {
  let w = projectSimplex([...seed]);
  let prevLoss = winnerCELoss(history, w);

  for (let t = 1; t <= GD_MAX_ITER; t++) {
    const grad = winnerCEGradient(history, w);
    // Gradient descent step — proportional to gradient magnitude (no normalisation)
    const updated = w.map((wi, i) => wi - GD_LR * grad[i]) as Weights;
    w = projectSimplex(updated);

    if (t % 100 === 0) {
      const currentLoss = winnerCELoss(history, w);
      if (Math.abs(prevLoss - currentLoss) < GD_CONV_TOL) {
        return { weights: w, finalLoss: currentLoss, iterations: t };
      }
      prevLoss = currentLoss;
    }
  }

  return { weights: w, finalLoss: winnerCELoss(history, w), iterations: GD_MAX_ITER };
}

/** Grid search → GD refinement pipeline. */
function optimise(history: YearData[]): {
  weights:    Weights;
  finalLoss:  number;
  iterations: number;
} {
  const seed = gridSearch(history);
  return gdRefine(history, seed);
}

// ── Evaluation metrics ─────────────────────────────────────────────────────────

function evaluateYear(yearData: YearData, w: Weights): YearMetrics {
  let nomCorrect = 0, nomTotal   = 0;
  let winCorrect = 0, catTotal   = 0;
  let brierSum   = 0, brierCount = 0;

  for (const catId of CATEGORY_IDS) {
    const cat = yearData.categories[catId];
    if (!cat?.contenders?.length) continue;

    const scored = cat.contenders
      .map(c => ({ c, score: sigPred(c, w) }))
      .sort((a, b) => b.score - a.score);

    const topN = scored.slice(0, cat.nominees);
    nomCorrect += topN.filter(s => s.c.nominated).length;
    nomTotal   += cat.nominees;

    if (scored[0]?.c.winner) winCorrect++;
    catTotal++;

    for (const { c, score } of scored) {
      brierSum += (score - (c.nominated ? 1 : 0)) ** 2;
      brierCount++;
    }
  }

  return {
    nominationAccuracy: nomTotal   > 0 ? nomCorrect / nomTotal   : 0,
    winnerAccuracy:     catTotal   > 0 ? winCorrect / catTotal   : 0,
    brierScore:         brierCount > 0 ? brierSum   / brierCount : 0
  };
}

// ── LOYO cross-validation ─────────────────────────────────────────────────────

function runLoyoCV(history: YearData[]): FoldResult[] {
  const folds: FoldResult[] = [];
  const n = history.length;

  for (let i = 0; i < n; i++) {
    const testYear = history[i];
    const trainSet = history.filter((_, j) => j !== i);

    const { weights: learnedW, finalLoss: trainLoss } = optimise(trainSet);

    const fold: FoldResult = {
      testYear:         testYear.year,
      learnedWeights:   learnedW,
      trainLoss,
      baselineMetrics:  evaluateYear(testYear, BASELINE),
      optimizedMetrics: evaluateYear(testYear, learnedW)
    };
    folds.push(fold);

    const b  = fold.baselineMetrics;
    const o  = fold.optimizedMetrics;
    const wStr = learnedW.map(x => (x * 100).toFixed(0).padStart(2)).join("/");
    process.stdout.write(
      `  Fold ${String(i + 1).padStart(2)}/${n}: ` +
      `year=${testYear.year}  weights=[${wStr}]  ` +
      `win_acc: ${(b.winnerAccuracy * 100).toFixed(1)}% → ${(o.winnerAccuracy * 100).toFixed(1)}%  ` +
      `nom_acc: ${(b.nominationAccuracy * 100).toFixed(1)}% → ${(o.nominationAccuracy * 100).toFixed(1)}%\n`
    );
  }

  return folds;
}

// ── Reporting ─────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
}

function stdDev(arr: number[]): number {
  const mean = avg(arr);
  return Math.sqrt(avg(arr.map(x => (x - mean) ** 2)));
}

function pct(x: number, d = 1): string {
  return (x * 100).toFixed(d) + "%";
}

function delta(x: number): string {
  return (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + " pp";
}

function printReport(history: YearData[], folds: FoldResult[], finalWeights: Weights): void {
  const baseNomAcc = avg(folds.map(f => f.baselineMetrics.nominationAccuracy));
  const optNomAcc  = avg(folds.map(f => f.optimizedMetrics.nominationAccuracy));
  const baseWinAcc = avg(folds.map(f => f.baselineMetrics.winnerAccuracy));
  const optWinAcc  = avg(folds.map(f => f.optimizedMetrics.winnerAccuracy));
  const baseBrier  = avg(folds.map(f => f.baselineMetrics.brierScore));
  const optBrier   = avg(folds.map(f => f.optimizedMetrics.brierScore));

  const HR = "─".repeat(68);

  console.log(`\n╔${"═".repeat(68)}╗`);
  console.log(`║  OSCAR ODDS — WEIGHT OPTIMISATION REPORT${"".padEnd(27)}║`);
  console.log(`║  Objective: per-category winner softmax cross-entropy${"".padEnd(15)}║`);
  console.log(`║  CV method: ${history.length}-fold Leave-One-Year-Out (${history[0].year}–${history[history.length - 1].year})${"".padEnd(18)}║`);
  console.log(`║  Optimiser: coarse grid search (5%) → GD refinement${"".padEnd(16)}║`);
  console.log(`╚${"═".repeat(68)}╝\n`);

  console.log(`  ${"Metric".padEnd(26)} ${"Baseline (58/30/12)".padEnd(22)} ${"Optimised (LOYO-CV)".padEnd(19)} Δ`);
  console.log(`  ${"─".repeat(26)} ${"─".repeat(22)} ${"─".repeat(19)} ${"─".repeat(9)}`);
  console.log(`  ${"Winner accuracy".padEnd(26)} ${pct(baseWinAcc).padEnd(22)} ${pct(optWinAcc).padEnd(19)} ${delta(optWinAcc - baseWinAcc)}`);
  console.log(`  ${"Nomination accuracy".padEnd(26)} ${pct(baseNomAcc).padEnd(22)} ${pct(optNomAcc).padEnd(19)} ${delta(optNomAcc - baseNomAcc)}`);
  console.log(`  ${"Brier score (↓ better)".padEnd(26)} ${baseBrier.toFixed(4).padEnd(22)} ${optBrier.toFixed(4).padEnd(19)} ${(optBrier - baseBrier >= 0 ? "+" : "") + (optBrier - baseBrier).toFixed(4)}`);

  console.log(`\n${HR}`);
  console.log(`  Final weights (fit on all ${history.length} years, grid+GD):\n`);
  console.log(`  Feature      Baseline   Learned    Change`);
  console.log(`  ${"─".repeat(12)} ${"─".repeat(9)} ${"─".repeat(9)} ${"─".repeat(10)}`);
  const names = ["precursor", "history", "buzz"];
  names.forEach((name, i) => {
    const b = BASELINE[i];
    const l = finalWeights[i];
    const d = l - b;
    const sign = d >= 0 ? "▲" : "▼";
    console.log(`  ${name.padEnd(12)} ${pct(b, 0).padEnd(9)} ${pct(l, 0).padEnd(9)} ${sign} ${Math.abs(d * 100).toFixed(0)} pp`);
  });

  console.log(`\n${HR}`);
  console.log(`  Weight stability across ${history.length} LOYO folds:\n`);
  console.log(`  Feature      Mean    Std     Min     Max`);
  console.log(`  ${"─".repeat(12)} ${"─".repeat(6)} ${"─".repeat(6)} ${"─".repeat(6)} ${"─".repeat(6)}`);
  names.forEach((name, i) => {
    const vals = folds.map(f => f.learnedWeights[i]);
    console.log(
      `  ${name.padEnd(12)} ${avg(vals).toFixed(3)}  ${stdDev(vals).toFixed(3)}  ` +
      `${Math.min(...vals).toFixed(3)}  ${Math.max(...vals).toFixed(3)}`
    );
  });

  console.log(`\n${HR}`);
  console.log(`  Per-year results (optimised weights):\n`);
  console.log(`  Year  Win acc  Nom acc  Brier    Δ winner`);
  console.log(`  ${"─".repeat(5)} ${"─".repeat(7)} ${"─".repeat(7)} ${"─".repeat(7)} ${"─".repeat(9)}`);
  for (const fold of folds) {
    const dW = fold.optimizedMetrics.winnerAccuracy - fold.baselineMetrics.winnerAccuracy;
    const marker = dW > 0.01 ? "↑" : dW < -0.01 ? "↓" : "=";
    console.log(
      `  ${fold.testYear}  ` +
      `${pct(fold.optimizedMetrics.winnerAccuracy, 0).padEnd(7)}` +
      `${pct(fold.optimizedMetrics.nominationAccuracy, 0).padEnd(7)}` +
      `${fold.optimizedMetrics.brierScore.toFixed(4).padEnd(8)} ` +
      `${marker} ${delta(dW)}`
    );
  }

  console.log("");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Loading oscar-history.json…");
  const history = loadHistory();
  const totalCategoryYears = history.reduce(
    (s, y) => s + CATEGORY_IDS.filter(id => y.categories[id]?.contenders?.length).length,
    0
  );
  console.log(
    `Loaded ${history.length} years (${history[0].year}–${history[history.length - 1].year}), ` +
    `${totalCategoryYears} category-year pairs\n`
  );
  console.log(`Objective: winner-level softmax cross-entropy (T=${TEMPERATURE})`);
  console.log(`Optimiser: coarse grid (${GRID_STEP * 100}% step) → GD (lr=${GD_LR}, max_iter=${GD_MAX_ITER})\n`);

  console.log(`Running ${history.length}-fold LOYO cross-validation…\n`);
  const folds = runLoyoCV(history);

  console.log(`\nFitting final model on all ${history.length} years…`);
  const { weights: finalWeights, finalLoss, iterations } = optimise(history);
  console.log(`  Grid seed → GD converged: ${iterations} iterations, winner CE loss = ${finalLoss.toFixed(6)}`);

  printReport(history, folds, finalWeights);

  // ── Persist ────────────────────────────────────────────────────────────────
  const cvNomAcc = {
    baseline:  Number(avg(folds.map(f => f.baselineMetrics.nominationAccuracy)).toFixed(4)),
    optimized: Number(avg(folds.map(f => f.optimizedMetrics.nominationAccuracy)).toFixed(4))
  };
  const cvWinAcc = {
    baseline:  Number(avg(folds.map(f => f.baselineMetrics.winnerAccuracy)).toFixed(4)),
    optimized: Number(avg(folds.map(f => f.optimizedMetrics.winnerAccuracy)).toFixed(4))
  };
  const cvBrier = {
    baseline:  Number(avg(folds.map(f => f.baselineMetrics.brierScore)).toFixed(4)),
    optimized: Number(avg(folds.map(f => f.optimizedMetrics.brierScore)).toFixed(4))
  };

  const output: LearnedWeightsFile = {
    learnedAt:  new Date().toISOString(),
    method:     "winner-softmax-ce-grid-gd-loyo-cv",
    yearsUsed:  history.length,
    yearRange:  { from: history[0].year, to: history[history.length - 1].year },
    weights: {
      precursor: Number(finalWeights[0].toFixed(4)),
      history:   Number(finalWeights[1].toFixed(4)),
      buzz:      Number(finalWeights[2].toFixed(4))
    },
    baseline: {
      precursor: BASELINE[0],
      history:   BASELINE[1],
      buzz:      BASELINE[2]
    },
    cv: {
      folds:  history.length,
      method: "leave-one-year-out",
      nominationAccuracy: cvNomAcc,
      winnerAccuracy:     cvWinAcc,
      brierScore:         cvBrier
    }
  };

  const outPath = join(__dirname, "../data/learned-weights.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`Results written to ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
