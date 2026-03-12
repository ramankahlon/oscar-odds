/**
 * scripts/feature-importance.ts
 *
 * Permutation Feature Importance (PFI) for the Oscar prediction model.
 *
 * Method
 * ──────
 * For each feature f ∈ {precursor, history, buzz}:
 *
 *   1. Load the learned weights from data/learned-weights.json.
 *   2. Run N=200 permutation replicates.
 *      In each replicate, shuffle feature f's values WITHIN each
 *      (year, category) group — this breaks the within-category ranking signal
 *      for that feature while preserving its marginal distribution.
 *   3. Score all contenders with the (partially shuffled) data using
 *      the learned weights.  Compute winner accuracy, cross-entropy loss,
 *      and Brier score on the shuffled dataset.
 *   4. PFI = baseline_metric − permuted_metric   (for accuracy; negated for loss)
 *      A large positive value means the feature is important.
 *   5. Report mean ± std across the N replicates.
 *
 * Why within-category permutation?
 * ─────────────────────────────────
 * The model ranks films relative to one another inside each category. A
 * global shuffle would change the within-category scale and partially
 * re-introduce signal from other categories (since strong films tend to
 * score high across the board). Within-category permutation isolates the
 * contribution of a single feature's ordering signal.
 *
 * Usage:   npm run feature-importance
 * Output:  data/feature-importance.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const DATA_DIR   = join(__dirname, "../data");

// ── Hyperparameters ───────────────────────────────────────────────────────────

const N_PERMS       = 200;   // permutation replicates per feature
const SIGMOID_CENTER = 55;
const SIGMOID_SCALE  = 12;
const TEMPERATURE    = 2.0;

const CATEGORY_IDS = [
  "picture", "director", "actor", "actress",
  "supporting-actor", "supporting-actress",
] as const;

type FeatureName = "precursor" | "history" | "buzz";
type Weights     = [number, number, number]; // [precursor, history, buzz]

// ── Types ─────────────────────────────────────────────────────────────────────

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
  categories: Record<string, CategoryData>;
}

interface Metrics {
  winnerAccuracy:    number;
  crossEntropyLoss:  number;
  brierScore:        number;
}

// ── Data loading ──────────────────────────────────────────────────────────────

function loadHistory(): YearData[] {
  const raw = JSON.parse(
    readFileSync(join(DATA_DIR, "oscar-history.json"), "utf8")
  ) as {
    years: Array<{
      year: number;
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
    year: y.year,
    categories: Object.fromEntries(
      Object.entries(y.categories).map(([catId, cat]) => [
        catId,
        {
          nominees:   cat.nominees,
          contenders: cat.contenders.map(c => {
            const boost = c.strength === "High" ? 1.06 : c.strength === "Low" ? 0.94 : 1.0;
            return {
              precursor:        c.precursor,
              history:          c.history,
              buzz:             c.buzz,
              logStrengthBoost: Math.log(boost),
              nominated:        Boolean(c.nominated),
              winner:           Boolean(c.winner),
            };
          }),
        },
      ])
    ),
  }));
}

function loadLearnedWeights(): Weights {
  try {
    const raw = JSON.parse(
      readFileSync(join(DATA_DIR, "learned-weights.json"), "utf8")
    ) as { weights: { precursor: number; history: number; buzz: number } };
    return [raw.weights.precursor, raw.weights.history, raw.weights.buzz];
  } catch {
    console.warn("⚠  learned-weights.json not found — using default [0.58, 0.30, 0.12]");
    return [0.58, 0.30, 0.12];
  }
}

// ── Model scoring ─────────────────────────────────────────────────────────────

function logitScore(c: Contender, w: Weights): number {
  const linear = w[0] * c.precursor + w[1] * c.history + w[2] * c.buzz;
  return (linear - SIGMOID_CENTER) / SIGMOID_SCALE + c.logStrengthBoost;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-50, Math.min(50, x))));
}

// ── Full-dataset evaluation ───────────────────────────────────────────────────

function evaluate(history: YearData[], w: Weights): Metrics {
  let winCorrect = 0, catTotal    = 0;
  let ceSum      = 0, ceCount     = 0;
  let brierSum   = 0, brierCount  = 0;

  for (const y of history) {
    for (const catId of CATEGORY_IDS) {
      const cat = y.categories[catId];
      if (!cat?.contenders?.length) continue;
      const winnerIdx = cat.contenders.findIndex(c => c.winner);
      if (winnerIdx < 0) continue;

      const logits    = cat.contenders.map(c => TEMPERATURE * logitScore(c, w));
      const maxLogit  = Math.max(...logits);
      const expShifted = logits.map(x => Math.exp(x - maxLogit));
      const sumExp    = expShifted.reduce((s, e) => s + e, 0);
      const softmax   = expShifted.map(e => e / sumExp);

      // Cross-entropy loss (winner softmax)
      const logSumExp = maxLogit + Math.log(sumExp);
      ceSum += logSumExp - logits[winnerIdx];
      ceCount++;

      // Winner accuracy: is argmax the actual winner?
      const topIdx = logits.indexOf(Math.max(...logits));
      if (topIdx === winnerIdx) winCorrect++;
      catTotal++;

      // Brier score on nomination prediction (sigmoid prob vs nominated label)
      for (const c of cat.contenders) {
        const p = sigmoid(logitScore(c, w));
        brierSum += (p - (c.nominated ? 1 : 0)) ** 2;
        brierCount++;
      }
    }
  }

  return {
    winnerAccuracy:   catTotal   > 0 ? winCorrect / catTotal   : 0,
    crossEntropyLoss: ceCount    > 0 ? ceSum      / ceCount    : 0,
    brierScore:       brierCount > 0 ? brierSum   / brierCount : 0,
  };
}

// ── Permutation ───────────────────────────────────────────────────────────────

/** Fisher–Yates in-place shuffle. */
function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Deep-clone history and shuffle feature `f` within each (year, category)
 * group.  Returns the perturbed dataset.
 */
function permute(history: YearData[], f: FeatureName): YearData[] {
  return history.map(y => ({
    year: y.year,
    categories: Object.fromEntries(
      Object.entries(y.categories).map(([catId, cat]) => {
        // Extract this feature's values, shuffle them, reassign
        const vals = cat.contenders.map(c => c[f]);
        shuffle(vals);
        const contenders = cat.contenders.map((c, i) => ({
          ...c,
          [f]: vals[i],
        }));
        return [catId, { ...cat, contenders }];
      })
    ),
  }));
}

// ── PFI computation ───────────────────────────────────────────────────────────

interface FeatureResult {
  name:           FeatureName;
  weightFraction: number;
  importance: {
    winnerAccuracy:   { mean: number; std: number; drop:      number };
    crossEntropyLoss: { mean: number; std: number; increase:  number };
    brierScore:       { mean: number; std: number; increase:  number };
  };
  permutedMeans: {
    winnerAccuracy:   number;
    crossEntropyLoss: number;
    brierScore:       number;
  };
}

function computePFI(
  history:  YearData[],
  w:        Weights,
  baseline: Metrics,
  feature:  FeatureName,
  featureIdx: number,
): FeatureResult {
  const winAccs: number[] = [];
  const ceLosses: number[] = [];
  const briers:   number[] = [];

  for (let n = 0; n < N_PERMS; n++) {
    const perturbed  = permute(history, feature);
    const m          = evaluate(perturbed, w);
    winAccs.push(m.winnerAccuracy);
    ceLosses.push(m.crossEntropyLoss);
    briers.push(m.brierScore);
  }

  const mean = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / arr.length;
  const std  = (arr: number[], mu: number) =>
    Math.sqrt(arr.reduce((s, x) => s + (x - mu) ** 2, 0) / arr.length);

  const muWin = mean(winAccs);
  const muCE  = mean(ceLosses);
  const muBr  = mean(briers);

  return {
    name:           feature,
    weightFraction: w[featureIdx],
    importance: {
      winnerAccuracy:   { mean: baseline.winnerAccuracy   - muWin, std: std(winAccs,  muWin), drop:     baseline.winnerAccuracy   - muWin },
      crossEntropyLoss: { mean: muCE - baseline.crossEntropyLoss,  std: std(ceLosses, muCE),  increase: muCE - baseline.crossEntropyLoss  },
      brierScore:       { mean: muBr - baseline.brierScore,         std: std(briers,   muBr),  increase: muBr - baseline.brierScore         },
    },
    permutedMeans: {
      winnerAccuracy:   muWin,
      crossEntropyLoss: muCE,
      brierScore:       muBr,
    },
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log("Loading data…");
const history = loadHistory();
const w       = loadLearnedWeights();

console.log(`Learned weights: precursor=${(w[0]*100).toFixed(1)}%  history=${(w[1]*100).toFixed(1)}%  buzz=${(w[2]*100).toFixed(1)}%`);
console.log(`Dataset: ${history.length} years × 6 categories = ${history.length * 6} (year,category) pairs\n`);

console.log("Computing baseline metrics…");
const baseline = evaluate(history, w);
console.log(`  Winner accuracy:    ${(baseline.winnerAccuracy   * 100).toFixed(1)}%`);
console.log(`  Cross-entropy loss: ${baseline.crossEntropyLoss.toFixed(4)}`);
console.log(`  Brier score:        ${baseline.brierScore.toFixed(4)}\n`);

const features: FeatureName[] = ["precursor", "history", "buzz"];
const results: FeatureResult[] = [];

for (const [i, f] of features.entries()) {
  process.stdout.write(`Running ${N_PERMS} permutations for '${f}'… `);
  const start = Date.now();
  const result = computePFI(history, w, baseline, f, i);
  results.push(result);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `done (${elapsed}s)  ` +
    `ΔWinAcc=${(result.importance.winnerAccuracy.mean * 100).toFixed(2)}% ` +
    `±${(result.importance.winnerAccuracy.std * 100).toFixed(2)}%`
  );
}

// ── Summary table ─────────────────────────────────────────────────────────────

console.log("\n=== Permutation Feature Importance ===\n");
console.log("Feature      Weight    ΔWinAcc (↑important)   ΔCE Loss (↑important)   ΔBrier (↑important)");
console.log("─".repeat(90));
for (const r of results.sort((a, b) =>
  b.importance.winnerAccuracy.mean - a.importance.winnerAccuracy.mean
)) {
  const wa  = r.importance.winnerAccuracy;
  const ce  = r.importance.crossEntropyLoss;
  const br  = r.importance.brierScore;
  console.log(
    `${r.name.padEnd(12)} ${(r.weightFraction * 100).toFixed(0).padStart(4)}%` +
    `    ${(wa.mean * 100).toFixed(2).padStart(6)}% ±${(wa.std * 100).toFixed(2)}%` +
    `    ${ce.mean.toFixed(4).padStart(8)} ±${ce.std.toFixed(4)}` +
    `    ${br.mean.toFixed(4).padStart(8)} ±${br.std.toFixed(4)}`
  );
}

// ── Write output ──────────────────────────────────────────────────────────────

const output = {
  generatedAt:    new Date().toISOString(),
  method:         `within-category permutation, N=${N_PERMS}`,
  learnedWeights: { precursor: w[0], history: w[1], buzz: w[2] },
  baseline,
  features:       results,
};

const outPath = join(DATA_DIR, "feature-importance.json");
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`\nWrote ${outPath}`);
