import { describe, expect, it } from "vitest";
import {
  applySourceSignals,
  calculateNominationOdds,
  calculateWinnerOdds,
  normalizeSignalKey,
  rebalanceCategory
} from "./app-logic.js";
import type { Film, Strength } from "./types.js";

describe("calculateNominationOdds", () => {
  it("increases with stronger raw score", () => {
    const low = calculateNominationOdds({ nominationRaw: 0.2, nominationTotal: 1, nomineeScale: 0.5, uplift: 1.14 });
    const high = calculateNominationOdds({ nominationRaw: 0.4, nominationTotal: 1, nomineeScale: 0.5, uplift: 1.14 });
    expect(high).toBeGreaterThan(low);
  });

  it("applies uplift multiplier", () => {
    const base = calculateNominationOdds({ nominationRaw: 0.4, nominationTotal: 1, nomineeScale: 0.5, uplift: 1 });
    const boosted = calculateNominationOdds({ nominationRaw: 0.4, nominationTotal: 1, nomineeScale: 0.5, uplift: 1.2 });
    expect(boosted).toBeGreaterThan(base);
  });

  it("respects min and max clamps", () => {
    const minClamped = calculateNominationOdds({ nominationRaw: 0, nominationTotal: 1, nomineeScale: 0.5, min: 0.6 });
    const maxClamped = calculateNominationOdds({ nominationRaw: 10, nominationTotal: 1, nomineeScale: 1, max: 99 });
    expect(minClamped).toBe(0.6);
    expect(maxClamped).toBe(99);
  });

  it("handles zero totals safely", () => {
    const value = calculateNominationOdds({ nominationRaw: 1, nominationTotal: 0, nomineeScale: 1 });
    expect(value).toBeGreaterThan(0);
  });
});

describe("calculateWinnerOdds", () => {
  it("tracks winner raw and nomination context", () => {
    const weak = calculateWinnerOdds({ winnerRaw: 0.2, winnerTotal: 1, nomination: 10, winnerBase: 0.16, uplift: 1.2 });
    const strong = calculateWinnerOdds({ winnerRaw: 0.5, winnerTotal: 1, nomination: 20, winnerBase: 0.16, uplift: 1.2 });
    expect(strong).toBeGreaterThan(weak);
  });
});

describe("rebalanceCategory", () => {
  it("keeps totals inside nomination and winner bands", () => {
    const entries = [
      { nomination: 30, winner: 20 },
      { nomination: 20, winner: 15 },
      { nomination: 10, winner: 12 },
      { nomination: 8, winner: 8 },
      { nomination: 6, winner: 6 }
    ];
    rebalanceCategory(entries);
    const nominationTotal = entries.reduce((sum, item) => sum + item.nomination, 0);
    const winnerTotal = entries.reduce((sum, item) => sum + item.winner, 0);
    expect(nominationTotal).toBeGreaterThanOrEqual(90);
    expect(nominationTotal).toBeLessThanOrEqual(95);
    expect(winnerTotal).toBeGreaterThanOrEqual(30);
    expect(winnerTotal).toBeLessThanOrEqual(45);
  });

  it("enforces winner <= 50% nomination cap", () => {
    const entries = [
      { nomination: 10, winner: 9 },
      { nomination: 20, winner: 12 }
    ];
    rebalanceCategory(entries, {
      nominationBand: { minTotal: 20, maxTotal: 95, targetTotal: 30, minValue: 0.6, maxValue: 50 },
      winnerBand: { minTotal: 1, maxTotal: 45, targetTotal: 20, minValue: 0.4, maxValue: 24 },
      winnerToNominationCap: 0.5
    });
    expect(entries[0].winner).toBeLessThanOrEqual(entries[0].nomination * 0.5);
    expect(entries[1].winner).toBeLessThanOrEqual(entries[1].nomination * 0.5);
  });

  it("handles empty entries", () => {
    const entries: Array<{ nomination: number; winner: number }> = [];
    expect(rebalanceCategory(entries)).toEqual([]);
  });
});

describe("applySourceSignals", () => {
  const makeCategories = (): Array<{ id: string; films: Film[] }> => [
    {
      id: "picture",
      films: [
        { title: "The Odyssey", studio: "Universal", precursor: 80, history: 80, buzz: 80, strength: "Medium" as Strength },
        { title: "The Dish", studio: "Universal", precursor: 50, history: 50, buzz: 50, strength: "Low" as Strength }
      ]
    },
    {
      id: "director",
      films: [{ title: "Steven Spielberg", studio: "The Dish", precursor: 70, history: 70, buzz: 70, strength: "Medium" as Strength }]
    }
  ];

  it("rejects invalid snapshots", () => {
    const categories = makeCategories();
    const result = applySourceSignals({ categories, snapshot: null, lastAppliedSnapshotId: null });
    expect(result.changed).toBe(false);
  });

  it("rejects duplicate snapshot ids", () => {
    const categories = makeCategories();
    const snapshot = { generatedAt: "2026-01-01T00:00:00.000Z", aggregate: [] };
    const result = applySourceSignals({ categories, snapshot, lastAppliedSnapshotId: "2026-01-01T00:00:00.000Z" });
    expect(result.changed).toBe(false);
  });

  it("updates matching films and advances snapshot id", () => {
    const categories = makeCategories();
    const snapshot = {
      generatedAt: "2026-02-01T00:00:00.000Z",
      aggregate: [{ title: "The Odyssey", combinedScore: 0.9, letterboxdScore: 0.8, redditScore: 0.9, thegamerScore: 0.8 }]
    };
    const result = applySourceSignals({ categories, snapshot, lastAppliedSnapshotId: null });
    expect(result.changed).toBe(true);
    expect(result.appliedSnapshotId).toBe("2026-02-01T00:00:00.000Z");
    expect(categories[0].films[0].strength).toBe("High");
    expect(categories[0].films[0].buzz).toBeGreaterThan(80);
  });

  it("matches by studio as fallback", () => {
    const categories = makeCategories();
    const snapshot = {
      generatedAt: "2026-03-01T00:00:00.000Z",
      aggregate: [{ title: "The Dish", combinedScore: 0.6, letterboxdScore: 0.6, redditScore: 0.6, thegamerScore: 0.6 }]
    };
    applySourceSignals({ categories, snapshot, lastAppliedSnapshotId: null });
    expect(categories[1].films[0].precursor).toBeGreaterThan(70);
  });

  it("clamps feature values and sets low strength", () => {
    const categories = makeCategories();
    categories[0].films[1].precursor = 1;
    categories[0].films[1].history = 1;
    categories[0].films[1].buzz = 1;
    const snapshot = {
      generatedAt: "2026-04-01T00:00:00.000Z",
      aggregate: [{ title: "The Dish", combinedScore: 0, letterboxdScore: 0, redditScore: 0, thegamerScore: 0 }]
    };
    applySourceSignals({ categories, snapshot, lastAppliedSnapshotId: null });
    expect(categories[0].films[1].precursor).toBeGreaterThanOrEqual(0);
    expect(categories[0].films[1].history).toBeGreaterThanOrEqual(0);
    expect(categories[0].films[1].buzz).toBeGreaterThanOrEqual(0);
    expect(categories[0].films[1].strength).toBe("Low");
  });
});

describe("normalizeSignalKey", () => {
  it("normalizes punctuation and bracketed text", () => {
    expect(normalizeSignalKey("The Dish [Spielberg Movie]")).toBe("the dish");
  });
});
