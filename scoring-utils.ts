import { clamp } from "./forecast-utils.js";
import type { Strength, NormalizedWeights, ScoreResult, ExperienceConfig, Film } from "./types.js";

// ── Sigmoid parameters ────────────────────────────────────────────────────────
// The weighted sum of precursor/history/buzz lands in [0, 100].  We centre it
// near 55 (slightly above the mid-point because most contenders cluster in the
// upper half of the scale) and scale by 12 so that a 12-point swing in the
// weighted sum produces ≈ 1 standard-deviation change in the sigmoid output.
export const SIGMOID_CENTER = 55;
export const SIGMOID_SCALE  = 12;

// ── Winner raw formula parameters ────────────────────────────────────────────
// winnerRaw = nominationRaw × (WINNER_PRECURSOR_BASE + film.precursor / WINNER_PRECURSOR_NORM)
// WINNER_PRECURSOR_BASE: minimum winner weight even when precursor = 0.
// WINNER_PRECURSOR_NORM: normalises film.precursor (0–100) so the precursor
//   contribution tops out at 100/190 ≈ 0.53, keeping total weight below 1.15.
export const WINNER_PRECURSOR_BASE = 0.6;
export const WINNER_PRECURSOR_NORM = 190;

// ── Projection uplift factors ─────────────────────────────────────────────────
// Calibrated against historical Oscar data to correct the systematic
// under-prediction that arises from raw sigmoid scores summing to 1.
// NOMINATION_PERCENT_UPLIFT nudges nomination probabilities up to match the
// observed historical hit rate; WINNER_PERCENT_UPLIFT does the same for wins.
export const NOMINATION_PERCENT_UPLIFT = 1.14;
export const WINNER_PERCENT_UPLIFT     = 1.2;

// ── Winner ≤ 50% of nomination cap ───────────────────────────────────────────
// Prevents a film's win probability from exceeding half its nomination odds —
// a structural constraint reflecting Oscar voting rules.
export const WINNER_TO_NOMINATION_CAP = 0.5;

// ── Odds clamp bounds ─────────────────────────────────────────────────────────
// Floor/ceiling applied after uplift to keep displayed percentages readable.
// Nomination: min 0.6% (always shows a non-zero chance), max 99%.
// Winner:     min 0.4%, max 92% (preserves uncertainty even for favourites).
export const NOM_ODDS_MIN = 0.6;
export const NOM_ODDS_MAX = 99;
export const WIN_ODDS_MIN = 0.4;
export const WIN_ODDS_MAX = 92;

export function strengthBoost(strength: Strength): number {
  if (strength === "High") return 1.06;
  if (strength === "Medium") return 1.0;
  return 0.94;
}

export function winnerExperienceBoost(
  categoryId: string,
  contenderName: string,
  config?: ExperienceConfig
): number {
  const { priorCategoryWins = {}, recentWinnerPenalty = {}, overdueNarrativeBoost = {} } = config || {};

  const isPersonCategory =
    categoryId === "director" ||
    categoryId === "actor" ||
    categoryId === "actress" ||
    categoryId === "supporting-actor" ||
    categoryId === "supporting-actress";
  if (!isPersonCategory) return 1;

  const wins = priorCategoryWins[categoryId]?.[contenderName] || 0;
  const recentPenaltyLevel = Number(recentWinnerPenalty[categoryId]?.[contenderName] || 0);
  const hasOverdueNarrative = Boolean(overdueNarrativeBoost[categoryId]?.[contenderName]);

  let boost = 1;
  if (wins === 0) {
    boost += 0.06;
  } else {
    boost -= 0.08 + Math.min(wins, 3) * 0.03;
  }

  if (recentPenaltyLevel > 0) boost -= 0.12 * recentPenaltyLevel;
  if (hasOverdueNarrative) boost += 0.08;
  return clamp(boost, 0.55, 1.15);
}

export function scoreFilm(
  categoryId: string,
  film: Film,
  normalizedWeights: NormalizedWeights,
  config?: ExperienceConfig
): ScoreResult {
  const precursorContribution = film.precursor * normalizedWeights.precursor;
  const historyContribution = film.history * normalizedWeights.history;
  const buzzContribution = film.buzz * normalizedWeights.buzz;
  const linear = precursorContribution + historyContribution + buzzContribution;

  const centered = (linear - SIGMOID_CENTER) / SIGMOID_SCALE;
  const strengthMultiplier = strengthBoost(film.strength);
  const winnerHistoryMultiplier = winnerExperienceBoost(categoryId, film.title, config);
  const nominationRaw = (1 / (1 + Math.exp(-centered))) * strengthMultiplier;
  const winnerRaw = nominationRaw * (WINNER_PRECURSOR_BASE + film.precursor / WINNER_PRECURSOR_NORM) * winnerHistoryMultiplier;

  return {
    nominationRaw,
    winnerRaw,
    precursorContribution,
    historyContribution,
    buzzContribution,
    strengthMultiplier,
    winnerHistoryMultiplier
  };
}
