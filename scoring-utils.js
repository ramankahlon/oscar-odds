import { clamp } from "./forecast-utils.js";

export function strengthBoost(strength) {
  if (strength === "High") return 1.06;
  if (strength === "Medium") return 1.0;
  return 0.94;
}

export function winnerExperienceBoost(categoryId, contenderName, config) {
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

export function scoreFilm(categoryId, film, normalizedWeights, config) {
  const precursorContribution = film.precursor * normalizedWeights.precursor;
  const historyContribution = film.history * normalizedWeights.history;
  const buzzContribution = film.buzz * normalizedWeights.buzz;
  const linear = precursorContribution + historyContribution + buzzContribution;

  const centered = (linear - 55) / 12;
  const strengthMultiplier = strengthBoost(film.strength);
  const winnerHistoryMultiplier = winnerExperienceBoost(categoryId, film.title, config);
  const nominationRaw = (1 / (1 + Math.exp(-centered))) * strengthMultiplier;
  const winnerRaw = nominationRaw * (0.6 + film.precursor / 190) * winnerHistoryMultiplier;

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
