export type Strength = "High" | "Medium" | "Low";

export interface Film {
  title: string;
  studio: string;
  precursor: number;
  history: number;
  buzz: number;
  strength: Strength;
  nominated?: boolean;
}

export interface Projection {
  index: number;
  categoryId: string;
  rawTitle: string;
  rawStudio: string;
  title: string;
  nomination: number;
  winner: number;
  precursorContribution: number;
  historyContribution: number;
  buzzContribution: number;
  strengthMultiplier: number;
  winnerHistoryMultiplier: number;
}

export interface Category {
  id: string;
  name: string;
  nominees: number;
  winnerBase: number;
  films: Film[];
}

export interface RebalanceOptions {
  minTotal: number;
  maxTotal: number;
  targetTotal: number;
  minValue: number;
  maxValue: number;
}

export interface NormalizedWeights {
  precursor: number;
  history: number;
  buzz: number;
}

export interface ScoreResult {
  nominationRaw: number;
  winnerRaw: number;
  precursorContribution: number;
  historyContribution: number;
  buzzContribution: number;
  strengthMultiplier: number;
  winnerHistoryMultiplier: number;
}

export interface ExperienceConfig {
  priorCategoryWins?: Record<string, Record<string, number>>;
  recentWinnerPenalty?: Record<string, Record<string, number>>;
  overdueNarrativeBoost?: Record<string, Record<string, number>>;
}

export interface AggregateSignal {
  title: string;
  combinedScore?: number;
  letterboxdScore?: number;
  redditScore?: number;
  thegamerScore?: number;
}

export interface SourceSnapshot {
  generatedAt: string;
  aggregate: AggregateSignal[];
}

export interface ApplySourceSignalsResult {
  changed: boolean;
  updatedCount: number;
  appliedSnapshotId: string | null;
}

export interface CalcNomOddsParams {
  nominationRaw: number;
  nominationTotal: number;
  nomineeScale: number;
  uplift?: number;
  min?: number;
  max?: number;
}

export interface CalcWinOddsParams {
  winnerRaw: number;
  winnerTotal: number;
  nomination: number;
  winnerBase: number;
  uplift?: number;
  min?: number;
  max?: number;
}

export interface RebalanceCategoryOptions {
  winnerToNominationCap?: number;
  nominationBand?: RebalanceOptions;
  winnerBand?: RebalanceOptions;
}

export interface ApplySourceSignalsParams {
  categories: Array<{ id: string; films: Film[] }>;
  snapshot: unknown;
  lastAppliedSnapshotId: string | null;
}
