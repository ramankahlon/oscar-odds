/**
 * bootstrap-ci.ts
 *
 * Estimates 95% bootstrap confidence intervals on the Oscar prediction model's
 * learned weights and key backtest metrics.
 *
 * Method
 * ──────
 * Classic non-parametric bootstrap (Efron, 1979):
 *
 *   1. Treat the 150 historical (year, category) pairs as the population.
 *   2. Draw B=500 bootstrap samples of 150 pairs WITH REPLACEMENT.
 *      Each sample omits ~37% of pairs (duplicated elsewhere) — this
 *      induces genuine variability in the weight optimisation.
 *   3. For each bootstrap sample, re-fit the model weights using the same
 *      winner-level softmax cross-entropy objective as optimize-weights.ts.
 *      Warm-starting from the global best weight vector keeps each fit fast.
 *   4. Evaluate each bootstrap weight on the ORIGINAL (unsampled) data to
 *      get metric samples for winner accuracy, nomination accuracy, Brier.
 *   5. Report 2.5th/97.5th percentiles as 95% CIs.
 *
 * Output
 * ──────
 * data/bootstrap-ci.json — consumed by:
 *   • /api/bootstrap-ci  (server endpoint)
 *   • app.ts             (client computes per-film CI bands from weight samples)
 *
 * Usage:   npm run bootstrap:ci
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ── Hyperparameters ───────────────────────────────────────────────────────────

const B           = 500;   // bootstrap replicates
const GD_LR       = 0.001; // gradient-descent step size (same as optimize-weights.ts)
const GD_ITERS    = 800;   // iterations per bootstrap fit (warm start → fewer needed)
const GRID_STEP   = 0.05;  // coarse-grid resolution for the global seed
const GD_SEED_ITERS = 2000; // extra iterations for the global seed fit
const TEMPERATURE = 2.0;
const MIN_WEIGHT  = 0.03;
const CENTER      = 55;
const SCALE       = 12;

const CATEGORY_IDS = [
  "picture", "director", "actor", "actress",
  "supporting-actor", "supporting-actress"
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

type W = [number, number, number]; // [precursor, history, buzz]

interface Contender {
  precursor: number; history: number; buzz: number;
  logBoost:  number; nominated: boolean; winner: boolean;
}

interface CatData { nominees: number; contenders: Contender[] }
interface YearData { year: number; cats: Record<string, CatData> }

interface PercentileSummary { p025: number; p500: number; p975: number }
interface WeightSummary     { mean: number; std: number; p025: number; p975: number }

// ── Data loading ──────────────────────────────────────────────────────────────

function loadHistory(): YearData[] {
  const raw = JSON.parse(
    readFileSync(join(__dirname, "../data/oscar-history.json"), "utf8")
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
    cats: Object.fromEntries(
      Object.entries(y.categories).map(([id, cat]) => [
        id,
        {
          nominees:   cat.nominees,
          contenders: cat.contenders.map(c => ({
            precursor: c.precursor, history: c.history, buzz: c.buzz,
            logBoost:  Math.log(c.strength === "High" ? 1.06 : c.strength === "Low" ? 0.94 : 1.0),
            nominated: Boolean(c.nominated),
            winner:    Boolean(c.winner)
          }))
        }
      ])
    )
  }));
}

// ── Model ─────────────────────────────────────────────────────────────────────

function logit(c: Contender, w: W): number {
  return (w[0] * c.precursor + w[1] * c.history + w[2] * c.buzz - CENTER) / SCALE + c.logBoost;
}

// ── Loss + gradient ───────────────────────────────────────────────────────────

/** Pairs (year, category) included in the fit. */
type Pair = { year: YearData; catId: string };

function winnerCELoss(pairs: Pair[], w: W): number {
  let total = 0, count = 0;
  for (const { year, catId } of pairs) {
    const cat = year.cats[catId];
    if (!cat?.contenders.length) continue;
    const wi = cat.contenders.findIndex(c => c.winner);
    if (wi < 0) continue;
    const logits  = cat.contenders.map(c => TEMPERATURE * logit(c, w));
    const maxL    = Math.max(...logits);
    const logSumE = maxL + Math.log(logits.reduce((s, x) => s + Math.exp(x - maxL), 0));
    total += logSumE - logits[wi];
    count++;
  }
  return count ? total / count : 0;
}

function winnerCEGrad(pairs: Pair[], w: W): W {
  const g: W = [0, 0, 0];
  let count   = 0;
  for (const { year, catId } of pairs) {
    const cat = year.cats[catId];
    if (!cat?.contenders.length) continue;
    const wi = cat.contenders.findIndex(c => c.winner);
    if (wi < 0) continue;
    const logits = cat.contenders.map(c => TEMPERATURE * logit(c, w));
    const maxL   = Math.max(...logits);
    const exps   = logits.map(x => Math.exp(x - maxL));
    const sumE   = exps.reduce((s, e) => s + e, 0);
    const sm     = exps.map(e => e / sumE);
    const sc     = TEMPERATURE / SCALE;
    for (let i = 0; i < cat.contenders.length; i++) {
      const err = sm[i] - (i === wi ? 1 : 0);
      g[0] += sc * err * cat.contenders[i].precursor;
      g[1] += sc * err * cat.contenders[i].history;
      g[2] += sc * err * cat.contenders[i].buzz;
    }
    count++;
  }
  const n = Math.max(count, 1);
  return [g[0] / n, g[1] / n, g[2] / n];
}

// ── Simplex projection ────────────────────────────────────────────────────────

function project(w: number[]): W {
  const c = w.map(x => Math.max(x, MIN_WEIGHT));
  const t = c.reduce((s, x) => s + x, 0);
  return c.map(x => x / t) as W;
}

// ── Optimiser ─────────────────────────────────────────────────────────────────

function gdFit(pairs: Pair[], init: W, iters: number): { w: W; loss: number } {
  let w = project([...init]);
  let prevLoss = winnerCELoss(pairs, w);

  for (let t = 1; t <= iters; t++) {
    const grad = winnerCEGrad(pairs, w);
    w = project(w.map((wi, i) => wi - GD_LR * grad[i]) as W);
    if (t % 100 === 0) {
      const loss = winnerCELoss(pairs, w);
      if (Math.abs(prevLoss - loss) < 1e-9) break;
      prevLoss = loss;
    }
  }
  return { w, loss: winnerCELoss(pairs, w) };
}

// ── Coarse grid search ────────────────────────────────────────────────────────

function gridSeed(pairs: Pair[]): W {
  let best: W = [0.5, 0.13, 0.37];
  let bestL    = Infinity;
  const steps  = Math.round(1 / GRID_STEP);
  for (let pi = 1; pi < steps; pi++) {
    for (let hi = 1; pi + hi < steps; hi++) {
      const bi = steps - pi - hi;
      if (bi < 1) continue;
      const w: W = [pi * GRID_STEP, hi * GRID_STEP, bi * GRID_STEP];
      if (w.some(x => x < MIN_WEIGHT)) continue;
      const l = winnerCELoss(pairs, w);
      if (l < bestL) { bestL = l; best = [...w] as W; }
    }
  }
  return best;
}

// ── Evaluation metrics ────────────────────────────────────────────────────────

function evalAll(history: YearData[], w: W): {
  winnerAcc: number; nomAcc: number; brier: number
} {
  let winC = 0, winT = 0, nomC = 0, nomT = 0, brierSum = 0, brierN = 0;
  for (const year of history) {
    for (const catId of CATEGORY_IDS) {
      const cat = year.cats[catId];
      if (!cat?.contenders.length) continue;
      const scored = cat.contenders
        .map(c => ({ c, s: (w[0]*c.precursor + w[1]*c.history + w[2]*c.buzz - CENTER) / SCALE + c.logBoost }))
        .sort((a, b) => b.s - a.s);
      if (scored[0]?.c.winner) winC++;
      winT++;
      const topN = new Set(scored.slice(0, cat.nominees).map(x => x.c));
      nomC += [...topN].filter(c => c.nominated).length;
      nomT += cat.nominees;
      for (const { s, c } of scored) {
        const p = 1 / (1 + Math.exp(-Math.max(-50, Math.min(50, s))));
        brierSum += (p - (c.nominated ? 1 : 0)) ** 2;
        brierN++;
      }
    }
  }
  return {
    winnerAcc: winT  ? winC / winT   : 0,
    nomAcc:    nomT  ? nomC / nomT   : 0,
    brier:     brierN ? brierSum / brierN : 0
  };
}

// ── Stats helpers ─────────────────────────────────────────────────────────────

function mean(a: number[]): number { return a.reduce((s, x) => s + x, 0) / (a.length || 1); }
function std(a: number[]): number {
  const m = mean(a);
  return Math.sqrt(mean(a.map(x => (x - m) ** 2)));
}
function pct(a: number[], p: number): number {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.max(0, Math.min(s.length - 1, Math.round((p / 100) * (s.length - 1))))];
}
function summaryW(a: number[]): WeightSummary {
  return { mean: mean(a), std: std(a), p025: pct(a, 2.5), p975: pct(a, 97.5) };
}
function summaryPct(a: number[]): PercentileSummary {
  return { p025: pct(a, 2.5), p500: pct(a, 50), p975: pct(a, 97.5) };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Loading oscar-history.json…");
  const history = loadHistory();

  // Flatten all (year, category) pairs
  const allPairs: Pair[] = [];
  for (const year of history) {
    for (const catId of CATEGORY_IDS) {
      if (year.cats[catId]?.contenders.length) {
        allPairs.push({ year, catId });
      }
    }
  }
  console.log(`  ${history.length} years, ${allPairs.length} category-year pairs\n`);

  // ── Step 1: global fit (finds the optimal basin for warm-starting) ──────────
  console.log("Finding global optimum (grid + GD)…");
  const globalSeed = gridSeed(allPairs);
  const { w: globalBest } = gdFit(allPairs, globalSeed, GD_SEED_ITERS);
  console.log(
    `  Global best: precursor=${(globalBest[0]*100).toFixed(0)}% ` +
    `history=${(globalBest[1]*100).toFixed(0)}% ` +
    `buzz=${(globalBest[2]*100).toFixed(0)}%\n`
  );

  // ── Step 2: bootstrap ───────────────────────────────────────────────────────
  console.log(`Running B=${B} bootstrap replicates…`);

  const samples: W[]      = [];
  const winAccs: number[] = [];
  const nomAccs: number[] = [];
  const briers:  number[] = [];

  let warmStart: W = [...globalBest] as W;

  for (let b = 0; b < B; b++) {
    // Resample allPairs with replacement
    const boot: Pair[] = Array.from({ length: allPairs.length }, () =>
      allPairs[Math.floor(Math.random() * allPairs.length)]
    );

    // Fit weights on bootstrap sample (warm-start)
    const { w } = gdFit(boot, warmStart, GD_ITERS);
    samples.push([...w] as W);

    // Evaluate on the full original dataset (out-of-bootstrap estimate)
    const m = evalAll(history, w);
    winAccs.push(m.winnerAcc);
    nomAccs.push(m.nomAcc);
    briers.push(m.brier);

    // Adaptive warm start: blend previous result with global best for stability
    warmStart = project(w.map((wi, i) => 0.7 * wi + 0.3 * globalBest[i])) as W;

    if ((b + 1) % 50 === 0) {
      const wStr = w.map(x => (x * 100).toFixed(0).padStart(2)).join("/");
      process.stdout.write(`  rep ${String(b + 1).padStart(3)}/${B}  weights=[${wStr}]  win_acc=${(m.winnerAcc * 100).toFixed(1)}%\n`);
    }
  }

  // ── Step 3: summarise ───────────────────────────────────────────────────────
  const precursors = samples.map(s => s[0]);
  const histories  = samples.map(s => s[1]);
  const buzzes     = samples.map(s => s[2]);

  const summary = {
    precursor: summaryW(precursors),
    history:   summaryW(histories),
    buzz:      summaryW(buzzes)
  };
  const metrics = {
    winnerAccuracy:     summaryPct(winAccs),
    nominationAccuracy: summaryPct(nomAccs),
    brierScore:         summaryPct(briers)
  };

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(70)}`);
  console.log(`  Bootstrap CI Report  (B=${B}, 95% CI = p2.5–p97.5)\n`);

  console.log(`  Feature      Mean    Std     p2.5    p97.5`);
  console.log(`  ${"─".repeat(46)}`);
  for (const [name, s] of Object.entries(summary)) {
    console.log(
      `  ${name.padEnd(12)} ${(s.mean*100).toFixed(1).padStart(5)}%  ` +
      `${(s.std*100).toFixed(1).padStart(4)}%   ` +
      `${(s.p025*100).toFixed(0).padStart(4)}%   ${(s.p975*100).toFixed(0).padStart(4)}%`
    );
  }

  console.log(`\n  Metric                   p2.5     p50      p97.5`);
  console.log(`  ${"─".repeat(50)}`);
  for (const [name, s] of Object.entries(metrics)) {
    const fmt = name === "brierScore"
      ? (x: number) => x.toFixed(4)
      : (x: number) => (x * 100).toFixed(1) + "%";
    console.log(`  ${name.padEnd(24)} ${fmt(s.p025).padStart(7)}  ${fmt(s.p500).padStart(7)}  ${fmt(s.p975).padStart(7)}`);
  }
  console.log("");

  // ── Persist ─────────────────────────────────────────────────────────────────
  const output = {
    computedAt:  new Date().toISOString(),
    B,
    globalWeights: {
      precursor: Number(globalBest[0].toFixed(4)),
      history:   Number(globalBest[1].toFixed(4)),
      buzz:      Number(globalBest[2].toFixed(4))
    },
    /** Compact weight samples — [precursor, history, buzz] for each replicate. */
    samples: samples.map(s => [
      Number(s[0].toFixed(4)),
      Number(s[1].toFixed(4)),
      Number(s[2].toFixed(4))
    ]),
    summary: {
      precursor: { mean: r4(summary.precursor.mean), std: r4(summary.precursor.std), p025: r4(summary.precursor.p025), p975: r4(summary.precursor.p975) },
      history:   { mean: r4(summary.history.mean),   std: r4(summary.history.std),   p025: r4(summary.history.p025),   p975: r4(summary.history.p975) },
      buzz:      { mean: r4(summary.buzz.mean),       std: r4(summary.buzz.std),       p025: r4(summary.buzz.p025),       p975: r4(summary.buzz.p975) }
    },
    metrics: {
      winnerAccuracy:     { p025: r4(metrics.winnerAccuracy.p025),     p500: r4(metrics.winnerAccuracy.p500),     p975: r4(metrics.winnerAccuracy.p975) },
      nominationAccuracy: { p025: r4(metrics.nominationAccuracy.p025), p500: r4(metrics.nominationAccuracy.p500), p975: r4(metrics.nominationAccuracy.p975) },
      brierScore:         { p025: r4(metrics.brierScore.p025),         p500: r4(metrics.brierScore.p500),         p975: r4(metrics.brierScore.p975) }
    }
  };

  const outPath = join(__dirname, "../data/bootstrap-ci.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`Results written to ${outPath}`);
  console.log(`  (samples array: ${output.samples.length} × 3 floats)`);
}

function r4(x: number): number { return Number(x.toFixed(4)); }

main().catch(err => { console.error(err); process.exit(1); });
