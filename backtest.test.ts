import { describe, it, expect } from "vitest";
import { runBacktest } from "./backtest.js";
import type { NormalizedWeights } from "./types.js";

const W: NormalizedWeights = { precursor: 0.58, history: 0.30, buzz: 0.12 };

describe("runBacktest", () => {
  it("covers 25 years with 6 categories", () => {
    const result = runBacktest(W);
    expect(result.yearsBacktested).toBe(25);
    expect(result.byYear.length).toBe(25 * 6);
    expect(result.byCategory.length).toBe(6);
  });

  it("year range is 1999 to 2023", () => {
    const result = runBacktest(W);
    expect(result.yearRange.from).toBe(1999);
    expect(result.yearRange.to).toBe(2023);
  });

  it("nomination accuracy is between 0 and 1", () => {
    const result = runBacktest(W);
    expect(result.overall.nominationAccuracyAvg).toBeGreaterThanOrEqual(0);
    expect(result.overall.nominationAccuracyAvg).toBeLessThanOrEqual(1);
    for (const row of result.byYear) {
      expect(row.nominationAccuracy).toBeGreaterThanOrEqual(0);
      expect(row.nominationAccuracy).toBeLessThanOrEqual(1);
    }
  });

  it("winner accuracy is between 0 and 100", () => {
    const result = runBacktest(W);
    expect(result.overall.winnerAccuracyPct).toBeGreaterThanOrEqual(0);
    expect(result.overall.winnerAccuracyPct).toBeLessThanOrEqual(100);
  });

  it("Brier scores are non-negative", () => {
    const result = runBacktest(W);
    expect(result.overall.nominationBrierAvg).toBeGreaterThanOrEqual(0);
    expect(result.overall.winnerBrierAvg).toBeGreaterThanOrEqual(0);
    for (const row of result.byYear) {
      expect(row.nominationBrierScore).toBeGreaterThanOrEqual(0);
      expect(row.winnerBrierScore).toBeGreaterThanOrEqual(0);
    }
  });

  it("Best Picture 1999 top prediction is American Beauty", () => {
    const result = runBacktest(W);
    const row = result.byYear.find((r) => r.year === 1999 && r.categoryId === "picture");
    expect(row).toBeDefined();
    expect(row?.topPredicted).toBe("American Beauty");
    expect(row?.actualWinner).toBe("American Beauty");
    expect(row?.winnerCorrect).toBe(true);
  });

  it("each category-year result has valid fields", () => {
    const result = runBacktest(W);
    for (const row of result.byYear) {
      expect(typeof row.year).toBe("number");
      expect(typeof row.ceremony).toBe("number");
      expect(typeof row.categoryId).toBe("string");
      expect(typeof row.nominationAccuracy).toBe("number");
      expect(typeof row.winnerCorrect).toBe("boolean");
      expect(typeof row.topPredicted).toBe("string");
      expect(typeof row.actualWinner).toBe("string");
    }
  });

  it("byCategory has entries for all 6 categories", () => {
    const result = runBacktest(W);
    const ids = result.byCategory.map((c) => c.categoryId);
    expect(ids).toContain("picture");
    expect(ids).toContain("director");
    expect(ids).toContain("actor");
    expect(ids).toContain("actress");
    expect(ids).toContain("supporting-actor");
    expect(ids).toContain("supporting-actress");
  });

  it("weights are reflected in result", () => {
    const result = runBacktest(W);
    expect(result.weights.precursor).toBe(0.58);
    expect(result.weights.history).toBe(0.30);
    expect(result.weights.buzz).toBe(0.12);
  });
});
