import { describe, it, expect } from "vitest";
import type { VotingCategory } from "@/types";
import {
  computeWeightedScore,
  rankToPoints,
  tiebreak,
  computeMissedFill,
  spearmanCorrelation,
  pearsonCorrelation,
} from "@/lib/scoring";

// ─── computeWeightedScore ─────────────────────────────────────────────────────

describe("computeWeightedScore", () => {
  const equalWeights: VotingCategory[] = [
    { name: "vocals", weight: 1 },
    { name: "staging", weight: 1 },
  ];
  const customWeights: VotingCategory[] = [
    { name: "vocals", weight: 2 },
    { name: "staging", weight: 1 },
  ];

  it("averages scores when weights are equal", () => {
    expect(
      computeWeightedScore({ vocals: 6, staging: 8 }, equalWeights)
    ).toBe(7);
  });

  it("weights scores proportionally with custom weights", () => {
    // (8*2 + 4*1) / (2+1) = 20/3
    expect(
      computeWeightedScore({ vocals: 8, staging: 4 }, customWeights)
    ).toBeCloseTo(20 / 3, 10);
  });

  it("excludes a category whose score is missing from numerator AND denominator", () => {
    // only 'vocals' scored with weight 1 -> 7/1 = 7
    expect(
      computeWeightedScore({ vocals: 7 }, equalWeights)
    ).toBe(7);
  });

  it("returns 0 when no categories are scored (totalWeight short-circuit)", () => {
    expect(computeWeightedScore({}, equalWeights)).toBe(0);
  });

  it("pins: weight:0 is coerced to 1 via `|| 1` (known quirk, SPEC §9.2 says blank=1)", () => {
    const zeroWeighted: VotingCategory[] = [
      { name: "vocals", weight: 0 },
      { name: "staging", weight: 0 },
    ];
    // Both weights coerce to 1, so average of 4 and 8 is 6.
    expect(
      computeWeightedScore({ vocals: 4, staging: 8 }, zeroWeighted)
    ).toBe(6);
  });
});

// ─── rankToPoints ─────────────────────────────────────────────────────────────

describe("rankToPoints", () => {
  it("maps ranks 1..10 to Eurovision points", () => {
    const expected = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1];
    for (let rank = 1; rank <= 10; rank++) {
      expect(rankToPoints(rank)).toBe(expected[rank - 1]);
    }
  });

  it("returns 0 for rank 11", () => {
    expect(rankToPoints(11)).toBe(0);
  });

  it("returns 0 for a very large rank", () => {
    expect(rankToPoints(100)).toBe(0);
  });

  it("returns 0 for rank 0 (not in map, `?? 0` fallback)", () => {
    expect(rankToPoints(0)).toBe(0);
  });
});

// ─── tiebreak ─────────────────────────────────────────────────────────────────

describe("tiebreak", () => {
  it("ranks higher peak score first", () => {
    const a = { scores: { vocals: 9, staging: 5 }, country: "Albania" };
    const b = { scores: { vocals: 7, staging: 7 }, country: "Belgium" };
    expect(tiebreak(a, b)).toBeLessThan(0);
  });

  it("on equal peaks, ranks the contestant with more above-7 scores first", () => {
    const a = { scores: { vocals: 8, staging: 8 }, country: "Albania" };
    const b = { scores: { vocals: 8, staging: 6 }, country: "Belgium" };
    expect(tiebreak(a, b)).toBeLessThan(0);
  });

  it("on equal peaks and equal above-7 counts, breaks ties alphabetically by country", () => {
    const a = { scores: { vocals: 8, staging: 5 }, country: "Albania" };
    const b = { scores: { vocals: 8, staging: 5 }, country: "Belgium" };
    expect(tiebreak(a, b)).toBeLessThan(0);
    expect(tiebreak(b, a)).toBeGreaterThan(0);
  });

  it("is sign-antisymmetric", () => {
    const a = { scores: { vocals: 9, staging: 5 }, country: "Albania" };
    const b = { scores: { vocals: 7, staging: 7 }, country: "Belgium" };
    expect(Math.sign(tiebreak(a, b))).toBe(-Math.sign(tiebreak(b, a)));
  });
});

// ─── computeMissedFill ────────────────────────────────────────────────────────

describe("computeMissedFill", () => {
  const categories: VotingCategory[] = [
    { name: "vocals", weight: 1 },
    { name: "staging", weight: 1 },
  ];

  const vote = (overrides: {
    contestantId: string;
    scores: Record<string, number> | null;
    missed?: boolean;
  }) => ({
    id: `v-${overrides.contestantId}`,
    roomId: "r-1",
    userId: "u-1",
    contestantId: overrides.contestantId,
    scores: overrides.scores,
    missed: overrides.missed ?? false,
    hotTake: null,
    updatedAt: "2026-04-19T00:00:00Z",
  });

  it("fills each category with round(mean) of the user's non-missed scores", () => {
    const votes = [
      vote({ contestantId: "c-1", scores: { vocals: 8, staging: 4 } }),
      vote({ contestantId: "c-2", scores: { vocals: 6, staging: 6 } }),
    ];
    // vocals mean = 7, staging mean = 5
    expect(computeMissedFill(votes, categories)).toEqual({ vocals: 7, staging: 5 });
  });

  it("falls back to 5 per category when the user has no non-missed votes", () => {
    const votes = [
      vote({ contestantId: "c-1", scores: null, missed: true }),
    ];
    expect(computeMissedFill(votes, categories)).toEqual({ vocals: 5, staging: 5 });
  });

  it("excludes missed votes from the mean source", () => {
    const votes = [
      vote({ contestantId: "c-1", scores: { vocals: 9, staging: 9 } }),
      vote({ contestantId: "c-2", scores: null, missed: true }),
      vote({ contestantId: "c-3", scores: { vocals: 3, staging: 3 } }),
    ];
    // only c-1 and c-3 contribute; mean = 6
    expect(computeMissedFill(votes, categories)).toEqual({ vocals: 6, staging: 6 });
  });

  it("computes per-category means independently", () => {
    const votes = [
      vote({ contestantId: "c-1", scores: { vocals: 10, staging: 2 } }),
      vote({ contestantId: "c-2", scores: { vocals: 8,  staging: 6 } }),
    ];
    // vocals: round((10+8)/2) = 9; staging: round((2+6)/2) = 4
    expect(computeMissedFill(votes, categories)).toEqual({ vocals: 9, staging: 4 });
  });

  it("pins JS Math.round behaviour: 6.5 rounds to 7", () => {
    const votes = [
      vote({ contestantId: "c-1", scores: { vocals: 6 } }),
      vote({ contestantId: "c-2", scores: { vocals: 7 } }),
    ];
    // mean = 6.5 → Math.round → 7
    const onlyVocals: VotingCategory[] = [{ name: "vocals", weight: 1 }];
    expect(computeMissedFill(votes, onlyVocals)).toEqual({ vocals: 7 });
  });
});

// ─── spearmanCorrelation ──────────────────────────────────────────────────────

describe("spearmanCorrelation", () => {
  it("returns 1 for identical rank sequences", () => {
    expect(spearmanCorrelation([1, 2, 3, 4], [1, 2, 3, 4])).toBe(1);
  });

  it("returns -1 for perfectly reversed rank sequences", () => {
    expect(spearmanCorrelation([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
  });

  it("returns 0 when n < 2", () => {
    expect(spearmanCorrelation([1], [1])).toBe(0);
  });
});

// ─── pearsonCorrelation ───────────────────────────────────────────────────────

describe("pearsonCorrelation", () => {
  it("returns 1 for identical series", () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [1, 2, 3, 4])).toBe(1);
  });

  it("returns -1 for perfect negative relationship", () => {
    expect(pearsonCorrelation([1, 2, 3], [3, 2, 1])).toBe(-1);
  });

  it("returns 0 when one series has zero variance (constant)", () => {
    expect(pearsonCorrelation([5, 5, 5], [1, 2, 3])).toBe(0);
  });
});
