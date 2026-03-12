/**
 * scripts/joint-probability.ts
 *
 * Computes the historical category co-win matrix from oscar-history.json.
 * For each pair of tracked Oscar categories, calculates how often the same
 * film won both categories in the same year (1999–2023, 25 ceremonies).
 *
 * Output: data/joint-probability.json
 *
 * Usage: npm run joint-probability
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const DATA_DIR   = path.join(__dirname, "..", "data");

// ── Types ────────────────────────────────────────────────────────────────────

interface Contender {
  title: string;
  studio: string;
  winner: boolean;
  nominated?: boolean;
}

interface CategoryData {
  nominees: number;
  winnerBase: number;
  contenders: Contender[];
}

interface YearData {
  year: number;
  ceremony: number;
  categories: Record<string, CategoryData>;
}

interface OscarHistory {
  schema: number;
  years: YearData[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Categories tracked in oscar-history.json that can share a "film"
const TRACKED_CATS = [
  "picture",
  "director",
  "actor",
  "actress",
  "supporting-actor",
  "supporting-actress",
] as const;

type TrackedCat = (typeof TRACKED_CATS)[number];

// In person categories the film title lives in `studio`; in picture it's `title`.
function winnerFilm(catId: string, contenders: Contender[]): string | null {
  const winner = contenders.find((c) => c.winner);
  if (!winner) return null;
  return catId === "picture" ? winner.title : winner.studio;
}

// ── Load data ─────────────────────────────────────────────────────────────────

const history = JSON.parse(
  readFileSync(path.join(DATA_DIR, "oscar-history.json"), "utf8")
) as OscarHistory;

const totalYears = history.years.length;

// ── Compute co-win counts ────────────────────────────────────────────────────

// coWinCounts[a][b] = number of years same film won BOTH category a AND category b
const coWinCounts: Record<TrackedCat, Record<TrackedCat, number>> = {} as never;
for (const a of TRACKED_CATS) {
  coWinCounts[a] = {} as Record<TrackedCat, number>;
  for (const b of TRACKED_CATS) coWinCounts[a][b] = 0;
}

// Also track per-year winners so we can compute conditional rates
const yearlyWinners: Map<number, Map<TrackedCat, string | null>> = new Map();

for (const yr of history.years) {
  const winners = new Map<TrackedCat, string | null>();
  for (const cat of TRACKED_CATS) {
    const catData = yr.categories[cat];
    winners.set(cat, catData ? winnerFilm(cat, catData.contenders) : null);
  }
  yearlyWinners.set(yr.year, winners);

  // Accumulate co-wins
  for (const a of TRACKED_CATS) {
    const filmA = winners.get(a);
    if (!filmA) continue;
    for (const b of TRACKED_CATS) {
      if (a === b) continue;
      const filmB = winners.get(b);
      if (filmB && filmA === filmB) coWinCounts[a][b]++;
    }
  }
}

// ── Derived metrics ──────────────────────────────────────────────────────────

// Co-win rate: fraction of years same film wins both categories
const coWinRates: Record<TrackedCat, Record<TrackedCat, number>> = {} as never;
// Conditional rate: P(wins B | same film wins A)
// = coWinCounts[A][B] / years_where_A_had_winner
const condRates: Record<TrackedCat, Record<TrackedCat, number>> = {} as never;
// Lift: co-win rate relative to chance (base rate ≈ 1/nominees_B)
// Using actual observed winner counts; lift > 1 means positive correlation
const lift: Record<TrackedCat, Record<TrackedCat, number>> = {} as never;

// Count years each category had a winner (should be 25 for all)
const winnerYears: Record<TrackedCat, number> = {} as never;
for (const cat of TRACKED_CATS) {
  winnerYears[cat] = [...yearlyWinners.values()].filter((m) => m.get(cat)).length;
}

for (const a of TRACKED_CATS) {
  coWinRates[a] = {} as Record<TrackedCat, number>;
  condRates[a]  = {} as Record<TrackedCat, number>;
  lift[a]       = {} as Record<TrackedCat, number>;
  for (const b of TRACKED_CATS) {
    const r = coWinCounts[a][b] / totalYears;
    coWinRates[a][b] = r;
    // P(wins B | wins A): how often the A-winner's film also won B
    condRates[a][b]  = winnerYears[a] > 0 ? coWinCounts[a][b] / winnerYears[a] : 0;
    // Lift relative to naive base rate (1 winner out of nomineeCount B contenders)
    // We approximate base rate as 1/nominees_B but we don't have that here,
    // so we use fraction of years B had a winner (= winnerYears[b]/totalYears ≈ 1.0)
    // and the joint rate under independence would be 1/nominees_A × 1/nominees_B
    // Instead we use the simpler marginal lift = r_AB / (p_A_base × p_B_base)
    // where p_base ≈ 1 (each category always produces one winner per year).
    // So lift is only meaningful relative to nominees in each category.
    // We store raw co-win rate; client computes lift using nominee counts.
    lift[a][b] = r;
  }
}

// ── Summary table ─────────────────────────────────────────────────────────────

console.log(`\n=== Category Co-Win Matrix (${totalYears} ceremonies, 1999–2023) ===\n`);
const header = ["", ...TRACKED_CATS.map((c) => c.slice(0, 8))].join("\t");
console.log(header);
for (const a of TRACKED_CATS) {
  const row = [a.slice(0, 12)];
  for (const b of TRACKED_CATS) {
    if (a === b) { row.push("—"); continue; }
    row.push(`${(coWinRates[a][b] * 100).toFixed(0)}%`);
  }
  console.log(row.join("\t"));
}

console.log("\n=== Conditional Co-Win Rates P(wins B | same film wins A) ===\n");
const highPairs: Array<{ a: TrackedCat; b: TrackedCat; rate: number; count: number }> = [];
for (const a of TRACKED_CATS) {
  for (const b of TRACKED_CATS) {
    if (a >= b) continue;
    const r = coWinRates[a][b];
    if (r > 0) highPairs.push({ a, b, rate: r, count: coWinCounts[a][b] });
  }
}
highPairs.sort((x, y) => y.rate - x.rate);
for (const { a, b, rate, count } of highPairs) {
  console.log(
    `  ${a} + ${b}: ${count}/${totalYears} = ${(rate * 100).toFixed(0)}%` +
    `  [P(${b}|${a}): ${(condRates[a][b] * 100).toFixed(0)}%` +
    `,  P(${a}|${b}): ${(condRates[b][a] * 100).toFixed(0)}%]`
  );
}

// ── Write output ─────────────────────────────────────────────────────────────

const output = {
  generatedAt: new Date().toISOString(),
  totalYears,
  yearRange: { first: history.years[0].year, last: history.years.at(-1)!.year },
  categories: [...TRACKED_CATS],
  /**
   * coWinCounts[A][B] = years same film won both A and B
   */
  coWinCounts,
  /**
   * coWinRates[A][B] = coWinCounts[A][B] / totalYears
   * Fraction of all ceremonies where the A-winner's film also won B.
   */
  coWinRates,
  /**
   * condRates[A][B] = P(film wins B | same film wins A)
   * = coWinCounts[A][B] / years_A_had_winner
   * Key parameter for the joint probability model.
   */
  condRates,
};

const outPath = path.join(DATA_DIR, "joint-probability.json");
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`\nWrote ${outPath}`);
