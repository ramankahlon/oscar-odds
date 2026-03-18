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

  // ── Extreme inputs ───────────────────────────────────────────────────────────

  it("zero nominationRaw returns the min floor", () => {
    // raw=0 → formula produces 0 → clamp to default min 0.6
    const result = calculateNominationOdds({ nominationRaw: 0, nominationTotal: 100, nomineeScale: 1 });
    expect(result).toBe(0.6);
  });

  it("negative nominationRaw clamps to min", () => {
    // negative raw → negative intermediate → clamp to min
    const result = calculateNominationOdds({ nominationRaw: -50, nominationTotal: 100, nomineeScale: 1 });
    expect(result).toBe(0.6); // default min
  });

  it("negative nominationTotal is treated as 1 (safe division)", () => {
    // Math.max(negative, 1) === 1; result is the same as total=1
    const withNeg = calculateNominationOdds({ nominationRaw: 0.5, nominationTotal: -999, nomineeScale: 1 });
    const withOne = calculateNominationOdds({ nominationRaw: 0.5, nominationTotal: 1,    nomineeScale: 1 });
    expect(withNeg).toBe(withOne);
  });

  it("nomineeScale of zero is coerced to 1 by the || 1 guard", () => {
    // Number(0) || 1 === 1 — a scale of 0 is treated as 1, not a zeroing factor
    const result = calculateNominationOdds({ nominationRaw: 0.4, nominationTotal: 1, nomineeScale: 0 });
    const expected = calculateNominationOdds({ nominationRaw: 0.4, nominationTotal: 1, nomineeScale: 1 });
    expect(result).toBe(expected);
  });

  it("uplift of zero drives result to min floor", () => {
    // any positive raw × uplift=0 → 0 → clamp to min
    const result = calculateNominationOdds({ nominationRaw: 50, nominationTotal: 100, nomineeScale: 1, uplift: 0 });
    expect(result).toBe(0.6);
  });

  it("very large raw / small total clamps to max ceiling", () => {
    const result = calculateNominationOdds({ nominationRaw: 1e9, nominationTotal: 1, nomineeScale: 1 });
    expect(result).toBe(99); // default max
  });

  it("NaN nominationRaw is treated as 0 → returns min floor", () => {
    const result = calculateNominationOdds({ nominationRaw: NaN, nominationTotal: 100, nomineeScale: 1 });
    expect(result).toBe(0.6);
  });

  it("NaN nominationTotal is treated as 1 (safe division)", () => {
    const withNaN = calculateNominationOdds({ nominationRaw: 0.5, nominationTotal: NaN, nomineeScale: 1 });
    const withOne = calculateNominationOdds({ nominationRaw: 0.5, nominationTotal: 1,   nomineeScale: 1 });
    expect(withNaN).toBe(withOne);
  });

  it("result is always within [min, max] regardless of extreme inputs", () => {
    const cases: Parameters<typeof calculateNominationOdds>[0][] = [
      { nominationRaw: Infinity,  nominationTotal: 1,    nomineeScale: 1, min: 1, max: 99 },
      { nominationRaw: -Infinity, nominationTotal: 1,    nomineeScale: 1, min: 1, max: 99 },
      { nominationRaw: 0,         nominationTotal: 0,    nomineeScale: 0, min: 1, max: 99 },
      { nominationRaw: 1e15,      nominationTotal: 1e-9, nomineeScale: 5, min: 1, max: 99 },
    ];
    for (const c of cases) {
      const r = calculateNominationOdds(c);
      expect(r).toBeGreaterThanOrEqual(c.min ?? 0.6);
      expect(r).toBeLessThanOrEqual(c.max ?? 99);
    }
  });
});

describe("calculateWinnerOdds", () => {
  it("tracks winner raw and nomination context", () => {
    const weak = calculateWinnerOdds({ winnerRaw: 0.2, winnerTotal: 1, nomination: 10, winnerBase: 0.16, uplift: 1.2 });
    const strong = calculateWinnerOdds({ winnerRaw: 0.5, winnerTotal: 1, nomination: 20, winnerBase: 0.16, uplift: 1.2 });
    expect(strong).toBeGreaterThan(weak);
  });

  // ── Extreme inputs ───────────────────────────────────────────────────────────

  it("zero winnerRaw with zero nomination returns min floor", () => {
    // blended = (0 + 0) / (1 + base) → 0 → uplift has no effect → clamp to min
    const result = calculateWinnerOdds({ winnerRaw: 0, winnerTotal: 1, nomination: 0, winnerBase: 0.16 });
    expect(result).toBe(0.4); // default min
  });

  it("zero winnerTotal is safe (treated as 1)", () => {
    // Math.max(0, 1) === 1 — no division by zero
    expect(() =>
      calculateWinnerOdds({ winnerRaw: 0.5, winnerTotal: 0, nomination: 20, winnerBase: 0.16 })
    ).not.toThrow();
    const withZero = calculateWinnerOdds({ winnerRaw: 0.5, winnerTotal: 0,  nomination: 20, winnerBase: 0.16 });
    const withOne  = calculateWinnerOdds({ winnerRaw: 0.5, winnerTotal: 1,  nomination: 20, winnerBase: 0.16 });
    expect(withZero).toBe(withOne);
  });

  it("negative winnerTotal is treated as 1", () => {
    const withNeg = calculateWinnerOdds({ winnerRaw: 0.5, winnerTotal: -999, nomination: 20, winnerBase: 0.16 });
    const withOne = calculateWinnerOdds({ winnerRaw: 0.5, winnerTotal: 1,    nomination: 20, winnerBase: 0.16 });
    expect(withNeg).toBe(withOne);
  });

  it("winnerBase of zero removes nomination context (pure raw share)", () => {
    // denominator = 1 + 0 = 1; blended = (raw/total)*100 * uplift
    const result   = calculateWinnerOdds({ winnerRaw: 0.5, winnerTotal: 1, nomination: 50, winnerBase: 0 });
    const expected = calculateWinnerOdds({ winnerRaw: 0.5, winnerTotal: 1, nomination: 0,  winnerBase: 0 });
    // nomination doesn't contribute when base=0
    expect(result).toBe(expected);
  });

  it("very high nomination with high winnerBase can reach max ceiling", () => {
    // nomination=99, winnerBase=10 → second term dominates; result should hit max
    const result = calculateWinnerOdds({ winnerRaw: 1, winnerTotal: 1, nomination: 99, winnerBase: 10, uplift: 1.5 });
    expect(result).toBe(92); // default max
  });

  it("uplift of zero drives result to min floor", () => {
    const result = calculateWinnerOdds({ winnerRaw: 0.9, winnerTotal: 1, nomination: 90, winnerBase: 0.5, uplift: 0 });
    expect(result).toBe(0.4);
  });

  it("negative winnerRaw clamps to min", () => {
    const result = calculateWinnerOdds({ winnerRaw: -100, winnerTotal: 1, nomination: 0, winnerBase: 0 });
    expect(result).toBe(0.4);
  });

  it("NaN winnerRaw and NaN nomination are treated as 0 → returns min floor", () => {
    const result = calculateWinnerOdds({ winnerRaw: NaN, winnerTotal: 1, nomination: NaN, winnerBase: 0.16 });
    expect(result).toBe(0.4);
  });

  it("result is always within [min, max] regardless of extreme inputs", () => {
    const cases: Parameters<typeof calculateWinnerOdds>[0][] = [
      { winnerRaw: Infinity,  winnerTotal: 1,    nomination: 99,  winnerBase: 1,   min: 1, max: 92 },
      { winnerRaw: -Infinity, winnerTotal: 1,    nomination: 0,   winnerBase: 0,   min: 1, max: 92 },
      { winnerRaw: 0,         winnerTotal: 0,    nomination: 0,   winnerBase: 0,   min: 1, max: 92 },
      { winnerRaw: 1e15,      winnerTotal: 1e-9, nomination: 100, winnerBase: 100, min: 1, max: 92 },
    ];
    for (const c of cases) {
      const r = calculateWinnerOdds(c);
      expect(r).toBeGreaterThanOrEqual(c.min ?? 0.4);
      expect(r).toBeLessThanOrEqual(c.max ?? 92);
    }
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
        { title: "Disclosure Day", studio: "Universal", precursor: 50, history: 50, buzz: 50, strength: "Low" as Strength }
      ]
    },
    {
      id: "director",
      films: [{ title: "Steven Spielberg", studio: "Disclosure Day", precursor: 70, history: 70, buzz: 70, strength: "Medium" as Strength }]
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
      aggregate: [{ title: "Disclosure Day", combinedScore: 0.6, letterboxdScore: 0.6, redditScore: 0.6, thegamerScore: 0.6 }]
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
      aggregate: [{ title: "Disclosure Day", combinedScore: 0, letterboxdScore: 0, redditScore: 0, thegamerScore: 0 }]
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
    expect(normalizeSignalKey("Disclosure Day")).toBe("disclosure day");
  });
});
