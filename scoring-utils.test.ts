import { describe, expect, it } from "vitest";
import { scoreFilm, winnerExperienceBoost } from "./scoring-utils.js";

const config = {
  priorCategoryWins: {
    actress: {
      "Mikey Madison": 1,
      "Jessie Buckley": 1
    },
    director: {
      "Steven Spielberg": 2
    }
  },
  recentWinnerPenalty: {
    actress: {
      "Mikey Madison": 2,
      "Jessie Buckley": 2
    }
  },
  overdueNarrativeBoost: {
    actress: {
      "Amy Adams": 1
    }
  }
};

describe("winnerExperienceBoost", () => {
  it("penalizes recent winners more than overdue contenders", () => {
    const mikey = winnerExperienceBoost("actress", "Mikey Madison", config);
    const amy = winnerExperienceBoost("actress", "Amy Adams", config);

    expect(mikey).toBeLessThan(amy);
    expect(mikey).toBeLessThan(1);
    expect(amy).toBeGreaterThan(1);
  });

  it("applies no person-category penalty/boost to film categories", () => {
    expect(winnerExperienceBoost("picture", "The Odyssey", config)).toBe(1);
  });
});

describe("scoreFilm", () => {
  it("returns coherent contribution and multiplier fields", () => {
    const result = scoreFilm(
      "director",
      {
        title: "Steven Spielberg",
        studio: "",
        precursor: 78,
        history: 90,
        buzz: 72,
        strength: "High"
      },
      {
        precursor: 0.58,
        history: 0.3,
        buzz: 0.12
      },
      config
    );

    expect(result.nominationRaw).toBeGreaterThan(0);
    expect(result.winnerRaw).toBeGreaterThan(0);
    expect(result.precursorContribution + result.historyContribution + result.buzzContribution).toBeGreaterThan(0);
    expect(result.strengthMultiplier).toBe(1.06);
    expect(result.winnerHistoryMultiplier).toBeGreaterThan(0.55);
    expect(result.winnerHistoryMultiplier).toBeLessThanOrEqual(1.15);
  });
});
