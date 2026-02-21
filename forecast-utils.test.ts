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
});
