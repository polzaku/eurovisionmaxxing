import { describe, it, expect } from "vitest";
import type { VotingCategory, Vote } from "@/types";
import {
  computeWeightedScore,
  rankToPoints,
  tiebreak,
  computeMissedFill,
  spearmanCorrelation,
  pearsonCorrelation,
  scoreRoom,
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
  it.each([
    [1, 12],
    [2, 10],
    [3, 8],
    [4, 7],
    [5, 6],
    [6, 5],
    [7, 4],
    [8, 3],
    [9, 2],
    [10, 1],
  ])("maps rank %i to %i points", (rank, points) => {
    expect(rankToPoints(rank)).toBe(points);
  });

  it("returns 0 for rank 11", () => {
    expect(rankToPoints(11)).toBe(0);
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

  it("returns 0 when n < 2", () => {
    expect(pearsonCorrelation([1], [1])).toBe(0);
  });
});

// ─── scoreRoom (pipeline) ─────────────────────────────────────────────────────

function makeVote(overrides: Partial<Vote>): Vote {
  return {
    id: "v-0",
    roomId: "r-1",
    userId: "u-1",
    contestantId: "c-1",
    scores: null,
    missed: false,
    hotTake: null,
    updatedAt: "2026-04-19T00:00:00Z",
    ...overrides,
  };
}

describe("scoreRoom (pipeline)", () => {
  const twoEqualCategories: VotingCategory[] = [
    { name: "vocals", weight: 1 },
    { name: "staging", weight: 1 },
  ];

  it("computes per-user ranks, points, and final leaderboard on a canonical fixture", () => {
    const contestants = [
      { id: "2026-AL", country: "Albania" },
      { id: "2026-BE", country: "Belgium" },
      { id: "2026-CR", country: "Croatia" },
      { id: "2026-DE", country: "Germany" },
    ];
    const userIds = ["u-1", "u-2", "u-3"];

    // Scores are designed so each user produces a distinct ranking:
    //   u-1 ranks: AL(10) > BE(8) > CR(6) > DE(4)
    //   u-2 ranks: BE(9) > CR(7) > AL(5) > DE(3)
    //   u-3 ranks: CR(10) > AL(8) > DE(6) > BE(4)
    // Weighted = simple mean since both weights = 1.
    const votes: Vote[] = [
      // u-1
      makeVote({ id: "v1-AL", userId: "u-1", contestantId: "2026-AL", scores: { vocals: 10, staging: 10 } }),
      makeVote({ id: "v1-BE", userId: "u-1", contestantId: "2026-BE", scores: { vocals: 8,  staging: 8  } }),
      makeVote({ id: "v1-CR", userId: "u-1", contestantId: "2026-CR", scores: { vocals: 6,  staging: 6  } }),
      makeVote({ id: "v1-DE", userId: "u-1", contestantId: "2026-DE", scores: { vocals: 4,  staging: 4  } }),
      // u-2
      makeVote({ id: "v2-AL", userId: "u-2", contestantId: "2026-AL", scores: { vocals: 5,  staging: 5  } }),
      makeVote({ id: "v2-BE", userId: "u-2", contestantId: "2026-BE", scores: { vocals: 9,  staging: 9  } }),
      makeVote({ id: "v2-CR", userId: "u-2", contestantId: "2026-CR", scores: { vocals: 7,  staging: 7  } }),
      makeVote({ id: "v2-DE", userId: "u-2", contestantId: "2026-DE", scores: { vocals: 3,  staging: 3  } }),
      // u-3
      makeVote({ id: "v3-AL", userId: "u-3", contestantId: "2026-AL", scores: { vocals: 8,  staging: 8  } }),
      makeVote({ id: "v3-BE", userId: "u-3", contestantId: "2026-BE", scores: { vocals: 4,  staging: 4  } }),
      makeVote({ id: "v3-CR", userId: "u-3", contestantId: "2026-CR", scores: { vocals: 10, staging: 10 } }),
      makeVote({ id: "v3-DE", userId: "u-3", contestantId: "2026-DE", scores: { vocals: 6,  staging: 6  } }),
    ];

    const out = scoreRoom({ categories: twoEqualCategories, contestants, userIds, votes });

    // Sort results for deterministic assertion (spec: results order not part of contract).
    const resultKey = (r: { userId: string; contestantId: string }) =>
      `${r.userId}|${r.contestantId}`;
    const sortedResults = [...out.results].sort((a, b) =>
      resultKey(a).localeCompare(resultKey(b))
    );

    // Points each user awards:
    //   u-1: AL=12, BE=10, CR=8, DE=7
    //   u-2: BE=12, CR=10, AL=8, DE=7
    //   u-3: CR=12, AL=10, DE=8, BE=7
    // Leaderboard totals:
    //   AL = 12 + 8 + 10 = 30
    //   BE = 10 + 12 + 7 = 29
    //   CR = 8 + 10 + 12 = 30
    //   DE = 7 + 7 + 8 = 22
    // Sorted: totalPoints desc, then contestantId asc -> AL(30), CR(30), BE(29), DE(22)
    expect(out.leaderboard).toEqual([
      { contestantId: "2026-AL", totalPoints: 30 },
      { contestantId: "2026-CR", totalPoints: 30 },
      { contestantId: "2026-BE", totalPoints: 29 },
      { contestantId: "2026-DE", totalPoints: 22 },
    ]);

    // Spot-check one user's full row set.
    const u1Results = sortedResults.filter((r) => r.userId === "u-1");
    expect(u1Results).toEqual([
      { userId: "u-1", contestantId: "2026-AL", weightedScore: 10, rank: 1, pointsAwarded: 12 },
      { userId: "u-1", contestantId: "2026-BE", weightedScore: 8,  rank: 2, pointsAwarded: 10 },
      { userId: "u-1", contestantId: "2026-CR", weightedScore: 6,  rank: 3, pointsAwarded: 8 },
      { userId: "u-1", contestantId: "2026-DE", weightedScore: 4,  rank: 4, pointsAwarded: 7 },
    ]);

    // filledVotes preserves all input votes; no missed -> no fills happen.
    expect(out.filledVotes).toHaveLength(votes.length);
  });

  it("fills a missed vote with the user's per-category mean and still ranks them", () => {
    const contestants = [
      { id: "2026-AL", country: "Albania" },
      { id: "2026-BE", country: "Belgium" },
      { id: "2026-CR", country: "Croatia" },
    ];
    const userIds = ["u-1", "u-2"];

    const oneCategory: VotingCategory[] = [{ name: "vocals", weight: 1 }];

    // u-1: scores 10 on AL, MISSED on BE, scores 6 on CR
    //      -> missed fill for BE uses mean(10, 6) = 8 (rounded from 8.0)
    //      -> u-1 weighted: AL=10, BE=8, CR=6 -> ranks 1,2,3 -> pts 12,10,8
    // u-2: scores 7 on all three -> all tied; tiebreak falls to alphabetical by country
    //      -> u-2 ranks: AL,BE,CR (alphabetical) -> pts 12,10,8
    const votes: Vote[] = [
      makeVote({ id: "a1", userId: "u-1", contestantId: "2026-AL", scores: { vocals: 10 } }),
      makeVote({ id: "a2", userId: "u-1", contestantId: "2026-BE", scores: null, missed: true }),
      makeVote({ id: "a3", userId: "u-1", contestantId: "2026-CR", scores: { vocals: 6 } }),
      makeVote({ id: "b1", userId: "u-2", contestantId: "2026-AL", scores: { vocals: 7 } }),
      makeVote({ id: "b2", userId: "u-2", contestantId: "2026-BE", scores: { vocals: 7 } }),
      makeVote({ id: "b3", userId: "u-2", contestantId: "2026-CR", scores: { vocals: 7 } }),
    ];

    const out = scoreRoom({ categories: oneCategory, contestants, userIds, votes });

    // Filled vote for u-1 BE should have vocals = 8 and missed still true.
    const beFilled = out.filledVotes.find(
      (v) => v.userId === "u-1" && v.contestantId === "2026-BE"
    );
    expect(beFilled?.missed).toBe(true);
    expect(beFilled?.scores).toEqual({ vocals: 8 });

    // Leaderboard:
    //   AL = 12 + 12 = 24
    //   BE = 10 + 10 = 20
    //   CR = 8 + 8 = 16
    expect(out.leaderboard).toEqual([
      { contestantId: "2026-AL", totalPoints: 24 },
      { contestantId: "2026-BE", totalPoints: 20 },
      { contestantId: "2026-CR", totalPoints: 16 },
    ]);
  });

  it("resolves a weighted-score tie via peak-category score in the pipeline", () => {
    const contestants = [
      { id: "2026-AL", country: "Albania" },
      { id: "2026-BE", country: "Belgium" },
    ];
    const userIds = ["u-1"];
    const twoCats: VotingCategory[] = [
      { name: "vocals", weight: 1 },
      { name: "staging", weight: 1 },
    ];

    // Both weighted to 6, but AL has the higher peak (9 vs 7).
    const votes: Vote[] = [
      makeVote({ id: "x1", userId: "u-1", contestantId: "2026-AL", scores: { vocals: 9, staging: 3 } }),
      makeVote({ id: "x2", userId: "u-1", contestantId: "2026-BE", scores: { vocals: 7, staging: 5 } }),
    ];

    const out = scoreRoom({ categories: twoCats, contestants, userIds, votes });

    const alResult = out.results.find((r) => r.contestantId === "2026-AL");
    const beResult = out.results.find((r) => r.contestantId === "2026-BE");
    expect(alResult?.rank).toBe(1);
    expect(alResult?.pointsAwarded).toBe(12);
    expect(beResult?.rank).toBe(2);
    expect(beResult?.pointsAwarded).toBe(10);

    expect(out.leaderboard).toEqual([
      { contestantId: "2026-AL", totalPoints: 12 },
      { contestantId: "2026-BE", totalPoints: 10 },
    ]);
  });
});
