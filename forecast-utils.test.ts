import { describe, expect, it } from "vitest";
import { clamp, rebalanceFieldTotal } from "./forecast-utils.js";

describe("clamp", () => {
  it("bounds values within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-2, 0, 10)).toBe(0);
    expect(clamp(20, 0, 10)).toBe(10);
  });
});

describe("rebalanceFieldTotal", () => {
  it("rebalances values to target band", () => {
    const entries = [{ nomination: 40 }, { nomination: 30 }, { nomination: 20 }];

    rebalanceFieldTotal(entries, "nomination", {
      minTotal: 80,
      maxTotal: 95,
      targetTotal: 88,
      minValue: 0.4,
      maxValue: 45
    });

    const total = entries.reduce((sum, e) => sum + e.nomination, 0);
    expect(total).toBeGreaterThanOrEqual(80);
    expect(total).toBeLessThanOrEqual(95);
  });

  it("handles zero totals by spreading evenly", () => {
    const entries = [{ winner: 0 }, { winner: 0 }, { winner: 0 }, { winner: 0 }];

    rebalanceFieldTotal(entries, "winner", {
      minTotal: 80,
      maxTotal: 95,
      targetTotal: 86,
      minValue: 0.2,
      maxValue: 42
    });

    const total = entries.reduce((sum, e) => sum + e.winner, 0);
    expect(total).toBeGreaterThanOrEqual(80);
    expect(total).toBeLessThanOrEqual(95);
  });

  // ── Edge cases ──────────────────────────────────────────────────────────────

  it("zero total: clamps each entry to maxValue when target/n exceeds maxValue", () => {
    // 3 entries at 0; clampedTarget/n = 30/3 = 10, but maxValue = 5.
    // The function distributes 5 to each entry, then can't scale up further
    // because all entries are already at maxValue — exits gracefully.
    const entries = [{ v: 0 }, { v: 0 }, { v: 0 }];
    rebalanceFieldTotal(entries, "v", {
      minTotal: 25,
      maxTotal: 40,
      targetTotal: 30,
      minValue: 0,
      maxValue: 5,
    });
    // Each entry is pinned at maxValue.
    entries.forEach((e) => expect(e.v).toBe(5));
    // Total (15) is below minTotal (25) — maxValue is the binding constraint.
    const total = entries.reduce((s, e) => s + e.v, 0);
    expect(total).toBe(15);
  });

  it("negative total is treated the same as zero: spreads evenly", () => {
    // total <= 0 branch fires; entries are redistributed from the even share.
    const entries = [{ v: -10 }, { v: -5 }, { v: -3 }];
    rebalanceFieldTotal(entries, "v", {
      minTotal: 70,
      maxTotal: 90,
      targetTotal: 80,
      minValue: 0,
      maxValue: 50,
    });
    const total = entries.reduce((s, e) => s + e.v, 0);
    expect(total).toBeGreaterThanOrEqual(70);
    expect(total).toBeLessThanOrEqual(90);
    entries.forEach((e) => {
      expect(e.v).toBeGreaterThanOrEqual(0);
      expect(e.v).toBeLessThanOrEqual(50);
    });
  });

  it("all entries at maxValue: adjustment loop exits immediately with no adjustable entries", () => {
    // 4 entries all at maxValue=20; target=100 but 4×20=80 < minTotal=90.
    // After the initial scale (which keeps all at 20), the loop sees no entry
    // below maxValue − 0.001 and returns via !adjustable.length.
    const entries = [{ v: 20 }, { v: 20 }, { v: 20 }, { v: 20 }];
    rebalanceFieldTotal(entries, "v", {
      minTotal: 90,
      maxTotal: 110,
      targetTotal: 100,
      minValue: 0,
      maxValue: 20,
    });
    entries.forEach((e) => expect(e.v).toBe(20));
    // Total remains 80 (4 × maxValue), below minTotal — the band is unreachable.
    expect(entries.reduce((s, e) => s + e.v, 0)).toBe(80);
  });

  it("all entries at minValue: adjustment loop exits immediately with no adjustable entries", () => {
    // 5 entries all at minValue=10; target=20 but 5×10=50 > maxTotal=30.
    // After scaling down, clamp keeps all at minValue — loop exits via !adjustable.
    const entries = [{ v: 10 }, { v: 10 }, { v: 10 }, { v: 10 }, { v: 10 }];
    rebalanceFieldTotal(entries, "v", {
      minTotal: 15,
      maxTotal: 30,
      targetTotal: 20,
      minValue: 10,
      maxValue: 50,
    });
    entries.forEach((e) => expect(e.v).toBeGreaterThanOrEqual(10));
    entries.forEach((e) => expect(e.v).toBeLessThanOrEqual(50));
  });

  it("minTotal > maxTotal: terminates without throwing and keeps values in [minValue, maxValue]", () => {
    // Inverted band: clamp(target, 100, 50) returns 100 (Math.max wins).
    // The band-membership exit (total >= min && total <= max) can never fire
    // because no number satisfies both >= 100 and <= 50 simultaneously.
    // The function must terminate via the convergence or all-clamped exits.
    const entries = [{ v: 30 }, { v: 40 }, { v: 50 }];
    expect(() =>
      rebalanceFieldTotal(entries, "v", {
        minTotal: 100,
        maxTotal: 50,
        targetTotal: 75,
        minValue: 0,
        maxValue: 95,
      })
    ).not.toThrow();
    entries.forEach((e) => {
      expect(e.v).toBeGreaterThanOrEqual(0);
      expect(e.v).toBeLessThanOrEqual(95);
    });
  });

  it("minTotal > maxTotal with entries pinned at maxValue: terminates via all-clamped exit", () => {
    // clampedTarget = clamp(75, 100, 50) = 100.  Entries (all at 20) scale to
    // clamp(20 × 100/60, 0, 20) = 20 — still at max.  Loop exits immediately.
    const entries = [{ v: 20 }, { v: 20 }, { v: 20 }];
    expect(() =>
      rebalanceFieldTotal(entries, "v", {
        minTotal: 100,
        maxTotal: 50,
        targetTotal: 75,
        minValue: 0,
        maxValue: 20,
      })
    ).not.toThrow();
    entries.forEach((e) => expect(e.v).toBe(20));
  });

  it("single entry: scales directly to clampedTarget", () => {
    const entries = [{ v: 30 }];
    rebalanceFieldTotal(entries, "v", {
      minTotal: 80,
      maxTotal: 100,
      targetTotal: 90,
      minValue: 0,
      maxValue: 95,
    });
    expect(entries[0].v).toBe(90);
  });

  it("empty entries array: returns without error", () => {
    expect(() =>
      rebalanceFieldTotal([], "v", {
        minTotal: 80,
        maxTotal: 100,
        targetTotal: 90,
        minValue: 0,
        maxValue: 95,
      })
    ).not.toThrow();
  });
});
