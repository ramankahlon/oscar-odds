import { clamp, rebalanceFieldTotal } from "./forecast-utils.js";
import type {
  AggregateSignal,
  ApplySourceSignalsParams,
  ApplySourceSignalsResult,
  CalcNomOddsParams,
  CalcWinOddsParams,
  Film,
  RebalanceCategoryOptions,
  SourceSnapshot
} from "./types.js";

export function normalizeSignalKey(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

export function calculateNominationOdds({
  nominationRaw,
  nominationTotal,
  nomineeScale,
  uplift = 1,
  min = 0.6,
  max = 99
}: CalcNomOddsParams): number {
  const total = Math.max(Number(nominationTotal) || 0, 1);
  const raw = Number(nominationRaw) || 0;
  const scale = Number(nomineeScale) || 1;
  return clamp(((raw / total) * 100 * scale) * uplift, min, max);
}

export function calculateWinnerOdds({
  winnerRaw,
  winnerTotal,
  nomination,
  winnerBase,
  uplift = 1,
  min = 0.4,
  max = 92
}: CalcWinOddsParams): number {
  const total = Math.max(Number(winnerTotal) || 0, 1);
  const raw = Number(winnerRaw) || 0;
  const nom = Number(nomination) || 0;
  const base = Number(winnerBase) || 0;
  const blended = ((raw / total) * 100 + nom * base) / (1 + base);
  return clamp(blended * uplift, min, max);
}

export function rebalanceCategory<T extends { nomination: number; winner: number }>(
  entries: T[],
  options: RebalanceCategoryOptions = {}
): T[] {
  if (!Array.isArray(entries) || entries.length === 0) return entries;
  const {
    winnerToNominationCap = 0.5,
    nominationBand = { minTotal: 90, maxTotal: 95, targetTotal: 93, minValue: 0.6, maxValue: 50 },
    winnerBand = { minTotal: 30, maxTotal: 45, targetTotal: 38, minValue: 0.4, maxValue: 24 }
  } = options;

  rebalanceFieldTotal(entries as any[], "nomination", nominationBand);
  rebalanceFieldTotal(entries as any[], "winner", winnerBand);
  entries.forEach((entry) => {
    entry.winner = Math.min(Number(entry.winner) || 0, (Number(entry.nomination) || 0) * winnerToNominationCap);
  });
  return entries;
}

export function applySourceSignals({
  categories,
  snapshot,
  lastAppliedSnapshotId
}: ApplySourceSignalsParams): ApplySourceSignalsResult {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray((snapshot as SourceSnapshot).aggregate)) {
    return { changed: false, updatedCount: 0, appliedSnapshotId: lastAppliedSnapshotId || null };
  }
  const snap = snapshot as SourceSnapshot;
  if (!snap.generatedAt || snap.generatedAt === lastAppliedSnapshotId) {
    return { changed: false, updatedCount: 0, appliedSnapshotId: lastAppliedSnapshotId || null };
  }

  const aggregateMap = new Map<string, AggregateSignal>();
  snap.aggregate.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const key = normalizeSignalKey(entry.title);
    if (!key) return;
    aggregateMap.set(key, entry);
  });
  if (aggregateMap.size === 0) {
    return { changed: false, updatedCount: 0, appliedSnapshotId: lastAppliedSnapshotId || null };
  }

  let updatedCount = 0;
  categories.forEach((category) => {
    category.films.forEach((film: Film) => {
      const match =
        aggregateMap.get(normalizeSignalKey(film.title)) ||
        aggregateMap.get(normalizeSignalKey(film.studio));
      if (!match) return;

      const combined = clamp(Number(match.combinedScore || 0), 0, 1);
      const letterboxdScore = clamp(Number(match.letterboxdScore || 0), 0, 1);
      const redditScore = clamp(Number(match.redditScore || 0), 0, 1);
      const thegamerScore = clamp(Number(match.thegamerScore || 0), 0, 1);

      film.precursor = clamp(film.precursor + Math.round((combined - 0.35) * 10), 0, 100);
      film.history = clamp(film.history + Math.round((letterboxdScore + thegamerScore - 0.55) * 8), 0, 100);
      film.buzz = clamp(film.buzz + Math.round((redditScore + thegamerScore - 0.5) * 10), 0, 100);

      if (combined >= 0.7 || redditScore >= 0.75) {
        film.strength = "High";
      } else if (combined >= 0.45) {
        film.strength = "Medium";
      } else {
        film.strength = "Low";
      }
      updatedCount += 1;
    });
  });

  if (updatedCount === 0) {
    return { changed: false, updatedCount: 0, appliedSnapshotId: lastAppliedSnapshotId || null };
  }
  return { changed: true, updatedCount, appliedSnapshotId: snap.generatedAt };
}
