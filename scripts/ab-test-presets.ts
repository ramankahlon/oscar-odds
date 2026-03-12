/**
 * scripts/ab-test-presets.ts
 *
 * Paired statistical A/B testing of weight preset performance on the
 * 25-year Oscar history (150 (year, category) pairs).
 *
 * For every pair of the 5 built-in presets we run:
 *
 *   • McNemar's test  — whether one preset predicts the winner correctly more
 *                       often than the other (binary outcome per pair).
 *   • Paired t-test   — whether the mean winner-Brier score differs
 *                       significantly (continuous, large-df → normal approx).
 *   • Wilcoxon signed-rank — non-parametric alternative to the t-test.
 *
 * Null hypothesis for every test: the two presets are identically good.
 * Significance level: α = 0.05.
 *
 * Output: data/ab-test.json
 * Usage:  npm run ab-test
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBacktest } from "../backtest.js";
import type { NormalizedWeights } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const DATA_DIR   = join(__dirname, "../data");

// ── Preset definitions ────────────────────────────────────────────────────────

function norm(p: number, h: number, b: number): NormalizedWeights {
  const total = p + h + b;
  return { precursor: p / total, history: h / total, buzz: b / total };
}

const BASE_PRESETS = [
  { name: "Balanced",        weights: norm(58, 30, 12) },
  { name: "Precursor-heavy", weights: norm(75, 18,  7) },
  { name: "History-heavy",   weights: norm(40, 48, 12) },
  { name: "Buzz-driven",     weights: norm(35, 25, 40) },
];

function loadDataDriven() {
  try {
    const raw = JSON.parse(
      readFileSync(join(DATA_DIR, "learned-weights.json"), "utf8")
    ) as { weights: { precursor: number; history: number; buzz: number } };
    return { name: "Data-Driven", weights: raw.weights as NormalizedWeights };
  } catch {
    console.warn("⚠  learned-weights.json not found — using Balanced as stand-in for Data-Driven");
    return { name: "Data-Driven", weights: norm(58, 30, 12) };
  }
}

// ── Statistical functions ─────────────────────────────────────────────────────

/** Abramowitz & Stegun 7.1.26 approximation — max error 1.5×10⁻⁷ */
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
                   - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return sign * y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Two-tailed p-value from χ²(1) distribution. χ²(1) ≡ N(0,1)² so the
 *  survival function is 2·(1 − Φ(√χ²)) = erfc(√(χ²/2)). */
function chiSq1pval(chiSq: number): number {
  return chiSq <= 0 ? 1 : 1 - erf(Math.sqrt(chiSq / 2));
}

/**
 * McNemar's test with Yates continuity correction.
 *
 * aWins: # pairs where A correct  AND B wrong  (discordant, favour A)
 * bWins: # pairs where A wrong    AND B correct (discordant, favour B)
 *
 * χ² = (|aWins − bWins| − 1)² / (aWins + bWins)  ~ χ²(1) under H0
 */
function mcNemar(aWins: number, bWins: number): { chiSq: number; pValue: number } {
  const m = aWins + bWins;
  if (m === 0) return { chiSq: 0, pValue: 1 };
  const chiSq = (Math.max(0, Math.abs(aWins - bWins) - 1) ** 2) / m;
  return { chiSq, pValue: chiSq1pval(chiSq) };
}

/**
 * Paired t-test (two-tailed).
 * For df ≥ 30 the t-distribution is well approximated by the standard normal,
 * which is accurate here (df = 149).
 *
 * diffs[i] = scoreA[i] − scoreB[i]   (positive → A worse for Brier)
 * Returns: t, df, two-tailed p-value, Cohen's d
 */
function pairedT(diffs: number[]): { t: number; df: number; pValue: number; cohenD: number } {
  const n    = diffs.length;
  if (n < 2) return { t: 0, df: 0, pValue: 1, cohenD: 0 };
  const mean = diffs.reduce((s, d) => s + d, 0) / n;
  const vari = diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / (n - 1);
  const std  = Math.sqrt(vari);
  const se   = std / Math.sqrt(n);
  const t    = se > 1e-12 ? mean / se : 0;
  const pValue = 2 * (1 - normalCdf(Math.abs(t)));
  return { t, df: n - 1, pValue, cohenD: std > 1e-12 ? mean / std : 0 };
}

/**
 * Wilcoxon signed-rank test (two-tailed), large-sample normal approximation.
 *
 * diffs[i] = scoreA[i] − scoreB[i]
 * W+ = sum of ranks of positive differences
 * For n ≥ 25: Z = (W+ − n(n+1)/4) / √(n(n+1)(2n+1)/24)  ~ N(0,1)
 */
function wilcoxon(diffs: number[]): { W: number; Z: number; pValue: number } {
  const nz = diffs.filter(d => Math.abs(d) > 1e-10);
  const n  = nz.length;
  if (n === 0) return { W: 0, Z: 0, pValue: 1 };

  // Sort by |d|, assign average ranks for ties
  const items = nz.map(d => ({ d, abs: Math.abs(d), rank: 0 }))
                  .sort((a, b) => a.abs - b.abs);
  let i = 0;
  while (i < items.length) {
    let j = i;
    while (j < items.length && items[j].abs === items[i].abs) j++;
    const avgRank = (i + j + 1) / 2; // 1-indexed
    for (let k = i; k < j; k++) items[k].rank = avgRank;
    i = j;
  }

  const W     = items.filter(r => r.d > 0).reduce((s, r) => s + r.rank, 0);
  const mu    = n * (n + 1) / 4;
  const sigma = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24);
  const Z     = sigma > 0 ? (W - mu) / sigma : 0;
  return { W, Z, pValue: 2 * (1 - normalCdf(Math.abs(Z))) };
}

// ── Pair comparison ───────────────────────────────────────────────────────────

function comparePair(
  nameA: string, resA: ReturnType<typeof runBacktest>,
  nameB: string, resB: ReturnType<typeof runBacktest>,
) {
  const n = resA.byYear.length;

  let aWinsWinner = 0, bWinsWinner = 0, tiesWinner = 0;
  const winBrierDiffs: number[] = [];
  const nomBrierDiffs: number[] = [];

  for (let k = 0; k < n; k++) {
    const rA = resA.byYear[k];
    const rB = resB.byYear[k];
    if      (rA.winnerCorrect && !rB.winnerCorrect) aWinsWinner++;
    else if (!rA.winnerCorrect && rB.winnerCorrect) bWinsWinner++;
    else tiesWinner++;
    winBrierDiffs.push(rA.winnerBrierScore     - rB.winnerBrierScore);
    nomBrierDiffs.push(rA.nominationBrierScore - rB.nominationBrierScore);
  }

  const mnr = mcNemar(aWinsWinner, bWinsWinner);
  const wtT = pairedT(winBrierDiffs);
  const wtW = wilcoxon(winBrierDiffs);
  const ntT = pairedT(nomBrierDiffs);

  return {
    a: nameA,
    b: nameB,
    n,
    winnerAccuracy: {
      aPct:   resA.overall.winnerAccuracyPct,
      bPct:   resB.overall.winnerAccuracyPct,
      delta:  resB.overall.winnerAccuracyPct - resA.overall.winnerAccuracyPct,
      aWins:  aWinsWinner,
      bWins:  bWinsWinner,
      ties:   tiesWinner,
      mcnemar: mnr,
    },
    winnerBrier: {
      aMean:   resA.overall.winnerBrierAvg,
      bMean:   resB.overall.winnerBrierAvg,
      // Positive delta means B has higher (worse) Brier
      delta:   resB.overall.winnerBrierAvg - resA.overall.winnerBrierAvg,
      pairedT: wtT,
      wilcoxon: wtW,
    },
    nomBrier: {
      aMean:   resA.overall.nominationBrierAvg,
      bMean:   resB.overall.nominationBrierAvg,
      delta:   resB.overall.nominationBrierAvg - resA.overall.nominationBrierAvg,
      pairedT: ntT,
    },
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const presets = [...BASE_PRESETS, loadDataDriven()];
console.log(`Running backtest for ${presets.length} presets…`);

const results = presets.map(p => {
  process.stdout.write(`  ${p.name.padEnd(18)}`);
  const res = runBacktest(p.weights);
  console.log(
    `Win acc: ${res.overall.winnerAccuracyPct.toFixed(1)}%  ` +
    `Win BS:  ${res.overall.winnerBrierAvg.toFixed(5)}  ` +
    `Nom BS:  ${res.overall.nominationBrierAvg.toFixed(5)}`
  );
  return { name: p.name, weights: p.weights, overall: res.overall, backtest: res };
});

// All pairwise comparisons (N-choose-2)
const pairwise: ReturnType<typeof comparePair>[] = [];
for (let i = 0; i < results.length; i++) {
  for (let j = i + 1; j < results.length; j++) {
    const r = comparePair(
      results[i].name, results[i].backtest,
      results[j].name, results[j].backtest,
    );
    pairwise.push(r);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log("\n=== A/B Test Results (α = 0.05) ===\n");
const SIG = (p: number) => p < 0.05 ? "✓ SIG" : "     ";

for (const r of pairwise) {
  const wa = r.winnerAccuracy;
  const wb = r.winnerBrier;
  const winner =
    wb.pairedT.pValue  < 0.05 ? (wb.delta < 0 ? r.a : r.b) :
    wa.mcnemar.pValue < 0.05 ? (wa.delta > 0 ? r.b : r.a) :
    "—";
  console.log(`${r.a} vs ${r.b}`);
  console.log(
    `  Win acc:   A=${wa.aPct.toFixed(1)}%  B=${wa.bPct.toFixed(1)}%  Δ=${wa.delta >= 0 ? "+" : ""}${wa.delta.toFixed(1)}pp` +
    `  McNemar p=${wa.mcnemar.pValue.toFixed(3)} ${SIG(wa.mcnemar.pValue)}`
  );
  console.log(
    `  Win Brier: A=${wb.aMean.toFixed(5)}  B=${wb.bMean.toFixed(5)}  Δ=${wb.delta >= 0 ? "+" : ""}${wb.delta.toFixed(5)}` +
    `  t-test p=${wb.pairedT.pValue.toFixed(3)}  Wilcoxon p=${wb.wilcoxon.pValue.toFixed(3)} ${SIG(Math.min(wb.pairedT.pValue, wb.wilcoxon.pValue))}` +
    `  d=${wb.pairedT.cohenD.toFixed(3)}`
  );
  console.log(`  → Best: ${winner}\n`);
}

// ── Write output ──────────────────────────────────────────────────────────────

const presetSummary = results.map(r => ({
  name:    r.name,
  weights: r.weights,
  overall: r.overall,
}));

// Strip raw backtest data — just keep test results
const output = {
  generatedAt:  new Date().toISOString(),
  alpha:        0.05,
  totalPairs:   results[0].backtest.byYear.length,
  presets:      presetSummary,
  pairwise,
};

const outPath = join(DATA_DIR, "ab-test.json");
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`Wrote ${outPath}`);
