/**
 * scripts/pr-roc.ts
 *
 * Compute Precision-Recall and ROC curves (+ AUC) for the nomination
 * prediction model across all 25 years of Oscar history.
 *
 * For every (year, category, film) triple the model produces a nomination
 * probability score p ∈ [0,1].  The ground truth label is nominated ∈ {0,1}.
 *
 * Curves are computed globally (all films pooled) and per-category.
 * AUC is the standard trapezoidal integral.
 *
 * Positive-rate reference line for PR: prevalence = positives / n
 * Random classifier AUC-ROC baseline: 0.5
 *
 * Output: data/pr-roc.json
 * Usage:  npm run pr-roc
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scoreFilm,
  NOMINATION_PERCENT_UPLIFT,
  NOM_ODDS_MIN,
  NOM_ODDS_MAX,
} from "../scoring-utils.js";
import { calculateNominationOdds } from "../app-logic.js";
import type { NormalizedWeights } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const DATA_DIR   = join(__dirname, "../data");

// ── Load history ─────────────────────────────────────────────────────────────

interface RawContender {
  title: string; studio: string;
  precursor: number; history: number; buzz: number;
  strength: string; nominated: boolean; winner: boolean;
}
interface RawCategory { nominees: number; winnerBase: number; contenders: RawContender[]; }
interface RawYear     { year: number; ceremony: number; categories: Record<string, RawCategory>; }
interface RawHistory  { schema: number; note: string; years: RawYear[]; }

const rawHistory = JSON.parse(
  readFileSync(join(DATA_DIR, "oscar-history.json"), "utf8")
) as RawHistory;

// ── Load learned weights (or fallback) ───────────────────────────────────────

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

// ── Build scored samples ──────────────────────────────────────────────────────

interface Sample {
  score: number;   // nomination probability [0,1]
  label: number;   // 1 = nominated, 0 = not nominated
  category: string;
}

const CATEGORY_IDS = [
  "picture", "director", "actor", "actress", "supporting-actor", "supporting-actress"
];

const all: Sample[] = [];
const byCat: Record<string, Sample[]> = Object.fromEntries(CATEGORY_IDS.map(c => [c, []]));

for (const rawYear of rawHistory.years) {
  for (const catId of CATEGORY_IDS) {
    const histCat = rawYear.categories[catId];
    if (!histCat || !Array.isArray(histCat.contenders) || histCat.contenders.length === 0) continue;

    const contenders = histCat.contenders.map((c) => ({
      title:     c.title,
      studio:    c.studio,
      precursor: c.precursor,
      history:   c.history,
      buzz:      c.buzz,
      strength:  (c.strength === "High" || c.strength === "Medium" || c.strength === "Low")
                   ? c.strength as "High" | "Medium" | "Low"
                   : "Low" as const,
      nominated: Boolean(c.nominated),
      winner:    Boolean(c.winner),
    }));

    const scored = contenders.map((c) => ({ c, ...scoreFilm(catId, c, weights) }));
    const nominationTotal = scored.reduce((s, x) => s + x.nominationRaw, 0) || 1;
    const nomineeScale    = histCat.nominees / Math.max(1, contenders.length);

    for (const s of scored) {
      const nomOdds = calculateNominationOdds({
        nominationRaw:   s.nominationRaw,
        nominationTotal,
        nomineeScale,
        uplift: NOMINATION_PERCENT_UPLIFT,
        min:    NOM_ODDS_MIN,
        max:    NOM_ODDS_MAX,
      });
      const sample: Sample = { score: nomOdds / 100, label: s.c.nominated ? 1 : 0, category: catId };
      all.push(sample);
      byCat[catId].push(sample);
    }
  }
}

console.log(`Total samples: ${all.length}  positives: ${all.filter(s => s.label === 1).length}`);

// ── Curve computation ─────────────────────────────────────────────────────────

/** Returns ROC curve as {fpr, tpr} sorted by fpr ascending, plus AUC. */
function rocCurve(samples: Sample[]): { points: Array<{ fpr: number; tpr: number }>; auc: number } {
  const sorted = [...samples].sort((a, b) => b.score - a.score);
  const P = samples.filter(s => s.label === 1).length;
  const N = samples.length - P;
  if (P === 0 || N === 0) return { points: [{ fpr: 0, tpr: 0 }, { fpr: 1, tpr: 1 }], auc: 0.5 };

  // Collect (fpr, tpr) at each unique threshold
  const points: Array<{ fpr: number; tpr: number }> = [{ fpr: 0, tpr: 0 }];
  let tp = 0, fp = 0;
  let prevScore = Infinity;

  for (const s of sorted) {
    if (s.score !== prevScore && tp + fp > 0) {
      points.push({ fpr: fp / N, tpr: tp / P });
    }
    if (s.label === 1) tp++; else fp++;
    prevScore = s.score;
  }
  points.push({ fpr: fp / N, tpr: tp / P }); // = (1, 1) if all seen

  // AUC via trapezoid
  let auc = 0;
  for (let i = 1; i < points.length; i++) {
    auc += (points[i].fpr - points[i-1].fpr) * (points[i].tpr + points[i-1].tpr) / 2;
  }

  // Downsample to ≤200 points for JSON compactness
  const step = Math.max(1, Math.floor(points.length / 200));
  const sampled = points.filter((_, i) => i === 0 || i === points.length - 1 || i % step === 0);
  return { points: sampled, auc: Math.max(0, Math.min(1, auc)) };
}

/** Returns PR curve as {recall, precision} sorted by recall ascending, plus AUC (area under PR). */
function prCurve(samples: Sample[]): { points: Array<{ recall: number; precision: number }>; auc: number } {
  const sorted = [...samples].sort((a, b) => b.score - a.score);
  const P = samples.filter(s => s.label === 1).length;
  if (P === 0) return { points: [{ recall: 0, precision: 1 }, { recall: 1, precision: 0 }], auc: 0 };

  const raw: Array<{ recall: number; precision: number }> = [];
  let tp = 0, fp = 0;
  let prevScore = Infinity;

  for (const s of sorted) {
    if (s.score !== prevScore && tp + fp > 0) {
      raw.push({ recall: tp / P, precision: tp / (tp + fp) });
    }
    if (s.label === 1) tp++; else fp++;
    prevScore = s.score;
  }
  raw.push({ recall: tp / P, precision: tp / (tp + fp) });

  // Sort by recall ascending for plotting / AUC
  raw.sort((a, b) => a.recall - b.recall);

  // AUC via trapezoid (interpolating in recall direction)
  let auc = 0;
  for (let i = 1; i < raw.length; i++) {
    auc += (raw[i].recall - raw[i-1].recall) * (raw[i].precision + raw[i-1].precision) / 2;
  }

  // Downsample
  const step = Math.max(1, Math.floor(raw.length / 200));
  const sampled = raw.filter((_, i) => i === 0 || i === raw.length - 1 || i % step === 0);
  return { points: sampled, auc: Math.max(0, Math.min(1, auc)) };
}

// ── Compute all curves ────────────────────────────────────────────────────────

function curveSet(samples: Sample[]) {
  const { points: roc, auc: aucRoc } = rocCurve(samples);
  const { points: pr,  auc: aucPr  } = prCurve(samples);
  const positives = samples.filter(s => s.label === 1).length;
  return { n: samples.length, positives, prevalence: positives / Math.max(1, samples.length), aucRoc, aucPr, roc, pr };
}

const overall  = curveSet(all);
const byCategory: Record<string, ReturnType<typeof curveSet>> = {};
for (const catId of CATEGORY_IDS) {
  byCategory[catId] = curveSet(byCat[catId]);
}

// ── Print summary ─────────────────────────────────────────────────────────────

console.log("\nOverall:");
console.log(`  n=${overall.n}  positives=${overall.positives}  prevalence=${(overall.prevalence*100).toFixed(1)}%`);
console.log(`  AUC-ROC = ${overall.aucRoc.toFixed(4)}   AUC-PR = ${overall.aucPr.toFixed(4)}`);
console.log("\nBy category:");
for (const catId of CATEGORY_IDS) {
  const c = byCategory[catId];
  console.log(`  ${catId.padEnd(20)} n=${c.n}  pos=${c.positives}  AUC-ROC=${c.aucRoc.toFixed(4)}  AUC-PR=${c.aucPr.toFixed(4)}`);
}

// ── Write output ──────────────────────────────────────────────────────────────

const output = {
  generatedAt: new Date().toISOString(),
  weights,
  overall,
  byCategory,
};

const outPath = join(DATA_DIR, "pr-roc.json");
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`\nWrote ${outPath}`);
