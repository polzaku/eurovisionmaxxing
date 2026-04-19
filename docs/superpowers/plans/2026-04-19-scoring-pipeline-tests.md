# Scoring Pipeline Tests + `scoreRoom()` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the scoring engine the real safety net CLAUDE.md §2.2 requires: comprehensive primitive coverage plus a pure `scoreRoom()` function that composes the primitives per SPEC §9 and ships pinned by fixture tests.

**Architecture:** Keep everything in `src/lib/scoring.ts` (code) and `src/lib/scoring.test.ts` (tests). `scoreRoom()` becomes the module's public entry point; Phase 4's API route will wrap it. No new files.

**Tech Stack:** Vitest 2.x (harness from previous PR), TypeScript 5.5.

**Spec:** [docs/superpowers/specs/2026-04-19-scoring-pipeline-tests-design.md](../specs/2026-04-19-scoring-pipeline-tests-design.md)

**Files touched:**
- Modify: `src/lib/scoring.ts` — append `scoreRoom()` and four interfaces after the existing primitives.
- Modify: `src/lib/scoring.test.ts` — replace the single smoke assertion with ~27 structured tests in six `describe` blocks.
- Modify: `TODO.md` — tick Phase 0 item D at the end (gitignored, not staged).

**Commit strategy:** Two commits.
- Commit 1 (Task 1 end): `test: cover scoring primitives with edge cases` — test file only.
- Commit 2 (Task 2 end): `feat: add scoreRoom pipeline composition` — `scoring.ts` + pipeline tests + both docs files.

---

## Task 1: Primitive + statistical tests for existing functions

Replace the single-assertion smoke test with structured coverage of the four scoring primitives and the two statistical helpers (six `describe` blocks, ~24 cases). These tests pin the behaviour of already-shipped code, so the TDD "watch it fail first" beat does not apply — we write the full suite and confirm green. The `rankToPoints(1) === 12` smoke assertion survives as one case inside `describe("rankToPoints")`.

**Files:**
- Modify: `src/lib/scoring.test.ts`

- [ ] **Step 1: Read the current primitive implementations**

Before writing tests, open [src/lib/scoring.ts](../../../src/lib/scoring.ts) and confirm the signatures and branches each test pins. Especially note:
- `computeWeightedScore` line `const weight = cat.weight || 1;` — this coerces `weight: 0` to `1`. The test below **pins** this quirk.
- `computeMissedFill` uses `Math.round`, which for JS rounds `.5` toward `+Infinity` (`6.5 → 7`, `-0.5 → 0`).
- `rankToPoints` uses `?? 0` for unknown ranks.
- `tiebreak` returns a negative number when `a` ranks higher (better) than `b`.

No code change in this step — just ground yourself in the file.

- [ ] **Step 2: Overwrite `src/lib/scoring.test.ts` with the primitive + statistical suite**

Replace the entire file contents with:

```ts
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
```

Notes:
- The inline `vote()` helper used in `computeMissedFill` tests will be reused in Task 2's pipeline tests. Don't delete it.
- The `VotingCategory` fixtures deliberately omit `hint` — it's optional in the type.

- [ ] **Step 3: Run the suite — expect all green**

```bash
npm test
```

Expected: 24 tests passing across six `describe` blocks, exit 0. Output contains `24 passed` (24 = 5 + 4 + 4 + 5 + 3 + 3).

If any test fails, read the failure carefully:
- Off-by-one math in the `computeWeightedScore` assertions? Fix the test, not the code — these pin existing behaviour.
- `tiebreak` sign confusion (less-than-0 means "a ranks higher")? Re-read [src/lib/scoring.ts:40-56](../../../src/lib/scoring.ts#L40-L56).
- If `computeMissedFill` returns unexpected keys: the function iterates over `categories`, not over the input scores. Align test expectations to categories.

- [ ] **Step 4: Confirm type-check still clean**

```bash
npm run type-check
```

Expected: exit 0, no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoring.test.ts
git commit -m "$(cat <<'EOF'
test: cover scoring primitives with edge cases

Expand src/lib/scoring.test.ts from a single smoke assertion to 24
cases across six describe blocks. Pins current behaviour of the
four scoring primitives (computeWeightedScore, rankToPoints,
tiebreak, computeMissedFill) and the two statistical helpers
(spearmanCorrelation, pearsonCorrelation), including documented
quirks like weight-0 coercion and Math.round half-up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `scoreRoom()` via TDD with fixture pipeline tests

This task introduces the production function the Phase 4 API route will wrap. Strict TDD: write a failing canonical-fixture test first, implement the function until it passes, then add two more fixture tests (missed-fill integration, tiebreak cascade) and confirm they pass too.

**Files:**
- Modify: `src/lib/scoring.ts` — append interfaces + `scoreRoom()` at the end.
- Modify: `src/lib/scoring.test.ts` — append `describe("scoreRoom", …)` block.

- [ ] **Step 1: Write the failing canonical-fixture test FIRST**

First, edit the existing imports at the **top** of `src/lib/scoring.test.ts`:

- Add `scoreRoom` to the `@/lib/scoring` import.
- Add `Vote` to the `@/types` import (currently only imports `VotingCategory`).

After editing, the top of the file should look like:

```ts
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
```

Then append this at the **very end** of the same file (after the `pearsonCorrelation` describe block):

```ts
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
});
```

Note: `makeVote` and the canonical describe block live at the *end* of the test file, after Task 1's primitive blocks.

- [ ] **Step 2: Run it — expect failure "scoreRoom is not a function" (or similar)**

```bash
npm test
```

Expected: the new test file fails at import time or at the first `scoreRoom(…)` call because `scoreRoom` does not yet exist in `src/lib/scoring.ts`. Vitest should surface either a TypeScript/runtime error like `SyntaxError: The requested module '@/lib/scoring' does not provide an export named 'scoreRoom'` or a similar import failure. Exit non-zero.

If instead the test fails with a value mismatch: `scoreRoom` already exists — you skipped reading the current state of `scoring.ts`. Stop, investigate, restart.

- [ ] **Step 3: Implement `scoreRoom()` + its interfaces**

Append to `src/lib/scoring.ts` (after the existing `pearsonCorrelation` function, at the very end of the file):

```ts
// ─── Full-room scoring pipeline ───────────────────────────────────────────────

export interface ScoreRoomInput {
  categories: VotingCategory[];
  contestants: { id: string; country: string }[];
  userIds: string[];
  votes: Vote[];
}

export interface UserResult {
  userId: string;
  contestantId: string;
  weightedScore: number;
  rank: number;
  pointsAwarded: number;
}

export interface LeaderboardEntry {
  contestantId: string;
  totalPoints: number;
}

export interface ScoreRoomOutput {
  filledVotes: Vote[];
  results: UserResult[];
  leaderboard: LeaderboardEntry[];
}

/**
 * Compose the scoring primitives into the full SPEC §9 pipeline.
 * Pure function; does not mutate inputs.
 * Preconditions are the caller's responsibility — see the design doc §3.
 */
export function scoreRoom(input: ScoreRoomInput): ScoreRoomOutput {
  const { categories, contestants, userIds, votes } = input;

  const countryById = new Map(contestants.map((c) => [c.id, c.country]));

  // Group raw votes by user.
  const rawByUser = new Map<string, Vote[]>();
  for (const uid of userIds) rawByUser.set(uid, []);
  for (const v of votes) rawByUser.get(v.userId)?.push(v);

  // Step 1: missed-fill. Produce a new Vote array with filled scores.
  const filledVotes: Vote[] = [];
  for (const uid of userIds) {
    const userVotes = rawByUser.get(uid) ?? [];
    const fillValues = computeMissedFill(userVotes, categories);
    for (const v of userVotes) {
      if (v.missed) {
        filledVotes.push({ ...v, scores: { ...fillValues } });
      } else {
        filledVotes.push({
          ...v,
          scores: v.scores ? { ...v.scores } : null,
        });
      }
    }
  }

  // Group filled votes by user for scoring.
  const filledByUser = new Map<string, Vote[]>();
  for (const uid of userIds) filledByUser.set(uid, []);
  for (const v of filledVotes) filledByUser.get(v.userId)?.push(v);

  // Step 2 + 3 + 4: per-user weighted score, rank, points.
  const results: UserResult[] = [];
  for (const uid of userIds) {
    const userVotes = filledByUser.get(uid) ?? [];
    const scored = userVotes.filter((v) => v.scores !== null);

    const entries = scored.map((v) => ({
      contestantId: v.contestantId,
      scores: v.scores as Record<string, number>,
      country: countryById.get(v.contestantId) ?? "",
      weightedScore: computeWeightedScore(
        v.scores as Record<string, number>,
        categories
      ),
    }));

    entries.sort((a, b) => {
      if (a.weightedScore !== b.weightedScore) {
        return b.weightedScore - a.weightedScore;
      }
      return tiebreak(
        { scores: a.scores, country: a.country },
        { scores: b.scores, country: b.country }
      );
    });

    entries.forEach((e, i) => {
      const rank = i + 1;
      results.push({
        userId: uid,
        contestantId: e.contestantId,
        weightedScore: e.weightedScore,
        rank,
        pointsAwarded: rankToPoints(rank),
      });
    });
  }

  // Step 5: leaderboard totals. Every contestant from input.contestants appears,
  // with 0 if no user awarded them points.
  const totals = new Map<string, number>();
  for (const c of contestants) totals.set(c.id, 0);
  for (const r of results) {
    totals.set(r.contestantId, (totals.get(r.contestantId) ?? 0) + r.pointsAwarded);
  }

  const leaderboard: LeaderboardEntry[] = [...totals.entries()]
    .map(([contestantId, totalPoints]) => ({ contestantId, totalPoints }))
    .sort((a, b) => {
      if (a.totalPoints !== b.totalPoints) return b.totalPoints - a.totalPoints;
      return a.contestantId.localeCompare(b.contestantId);
    });

  return { filledVotes, results, leaderboard };
}
```

Note: the `Vote` import at the top of `scoring.ts` already exists. `VotingCategory` is already imported. No new imports needed.

- [ ] **Step 4: Run the canonical test — expect it to pass**

```bash
npm test
```

Expected: all 25 tests pass (24 primitives + 1 pipeline), exit 0.

If it fails: read the assertion carefully.
- Leaderboard order wrong? Check the `sort` comparator — must be `b.totalPoints - a.totalPoints` (desc), then `a.contestantId.localeCompare(b.contestantId)` (asc).
- Ranks wrong? Check the sort inside the per-user loop uses `b.weightedScore - a.weightedScore` (desc).
- `u-1` results missing one contestant? Verify `filter((v) => v.scores !== null)` — all canonical votes have scores.

- [ ] **Step 5: Add the missed-fill integration test**

Append inside the existing `describe("scoreRoom (pipeline)", …)` block (just after the canonical test):

```ts
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
```

- [ ] **Step 6: Add the tiebreak-cascade integration test**

Append inside the same `describe` block, after the missed-fill test:

```ts
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
```

- [ ] **Step 7: Run all tests — expect 27 passing**

```bash
npm test
```

Expected: 27 tests pass (24 primitives + 3 pipeline), exit 0.

- [ ] **Step 8: Break-and-revert integration-safety check**

Temporarily edit `src/lib/scoring.ts` and change `rankToPoints` so it returns `rank * 2` for all ranks (or any similarly-wrong-but-typesafe change). Example patch:

```ts
// BEFORE
export function rankToPoints(rank: number): number {
  return EUROVISION_POINTS[rank] ?? 0;
}

// TEMPORARY BREAK
export function rankToPoints(rank: number): number {
  return rank * 2;
}
```

Then:
```bash
npm test
```

Expected: multiple tests fail — *at minimum* the `rankToPoints` primitive tests AND at least one `scoreRoom` pipeline test. If ONLY the primitive test fails and no pipeline test fails, the integration safety net is broken — the pipeline tests aren't actually exercising `rankToPoints`. Stop, investigate.

Revert the change so `rankToPoints` returns `EUROVISION_POINTS[rank] ?? 0` again. Run:
```bash
npm test
```
Expected: back to 27 passing.

- [ ] **Step 9: Full verification**

```bash
npm run type-check
npm run pre-push
```

Expected: both exit 0. `pre-push` runs type-check then tests, all green.

- [ ] **Step 10: Review the staged diff**

```bash
git status
git diff -- src/lib/scoring.ts src/lib/scoring.test.ts
```

Expected changes:
- `src/lib/scoring.ts`: ~100 new lines appended (interfaces + `scoreRoom`). No changes above the new section.
- `src/lib/scoring.test.ts`: `describe("scoreRoom (pipeline)", …)` block added at the end, with three `it` cases and the `makeVote` helper.

Eyeball for stray `console.log`, commented-out debug code, or anything unrelated.

- [ ] **Step 11: Stage and commit**

```bash
git add src/lib/scoring.ts src/lib/scoring.test.ts \
        docs/superpowers/specs/2026-04-19-scoring-pipeline-tests-design.md \
        docs/superpowers/plans/2026-04-19-scoring-pipeline-tests.md
git commit -m "$(cat <<'EOF'
feat: add scoreRoom pipeline composition

Introduce scoreRoom() in src/lib/scoring.ts: a pure function
composing the four scoring primitives per SPEC §9 (missed-fill ->
weighted score -> per-user rank with tiebreak -> Eurovision points ->
leaderboard aggregation). Phase 4's /api/rooms/{id}/score route
will wrap this without reimplementing the composition.

Covers it with three fixture tests: canonical happy path,
missed-fill integration, and tiebreak cascade. Verified that
breaking any primitive propagates to at least one pipeline test
(integration safety net intact).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 12: Confirm commit landed**

```bash
git log -1 --stat
git status
```

Expected: one new commit; working tree clean *except* for the unrelated pre-existing edits (icons, page files) that we are deliberately not touching.

---

## Task 3: Tick the TODO

**Files:**
- Modify: `TODO.md` (gitignored — do NOT stage).

- [ ] **Step 1: Tick Phase 0 item D**

Edit `TODO.md` and change:
```
- [ ] First unit test around `src/lib/scoring.ts` to establish the test harness
```
to:
```
- [x] First unit test around `src/lib/scoring.ts` to establish the test harness
```

This item's original intent was "first unit test to establish the harness" — that was achieved by the smoke test in the Vitest-harness PR. This PR delivers the *actual* coverage Phase 0 was reaching for, so ticking it is justified and the Phase 4 entry "Cover the scoring engine with tests" remains open for the fuller fixture suite the API route will add.

`TODO.md` is gitignored (CLAUDE.md §1). Save the file; do not stage or commit it.

- [ ] **Step 2: Save and close**

No commands; just confirm the file saved. The plan is done.

---

## Done when

- `npm test` reports 27/27 passing.
- `npm run pre-push` runs type-check + tests, both green.
- Break-and-revert check propagated a primitive break into a pipeline test failure (verified in Task 2 Step 8).
- Two commits land on `main`:
  1. `test: cover scoring primitives with edge cases`
  2. `feat: add scoreRoom pipeline composition` (with spec + plan docs)
- `TODO.md` Phase 0 item D ticked (local, unstaged).

## Self-review

- **Spec coverage:**
  - Spec §1 (`scoreRoom` signature + pipeline): Task 2 Step 3 implements exactly the interfaces and pipeline order described. ✓
  - Spec §2 (determinism): `leaderboard` tie-order is `contestantId` ascending, pinned in the canonical test's AL(30) vs CR(30) ordering and the missed-fill test's single-user-cases. ✓
  - Spec §3 (α contract, no validation): no precondition checks inside `scoreRoom`. The canonical test uses full vote coverage; the missed-fill test uses a `missed: true` row. Sparse-votes (α) case isn't exercised separately — acceptable per spec's "tests cover happy path + documented edges only". ✓
  - Spec §4 primitive tests (~18): Task 1 Step 2 contains 5+4+4+5 = 18 ✓
  - Spec §4 statistical tests (~6): Task 1 Step 2 contains 3+3 = 6 ✓
  - Spec §4 pipeline tests (~3): Task 2 Steps 1/5/6 are the three fixture tests ✓
  - Spec verification plan: Task 2 Step 8 (break-and-revert) + Step 9 (type-check + pre-push) mirror the spec's four checks. ✓

- **Placeholder scan:** no TBD/TODO/"similar to"; every test body contains concrete numbers and expected values; `scoreRoom` implementation has no stubbed branches.

- **Type consistency:** `ScoreRoomInput`, `ScoreRoomOutput`, `UserResult`, `LeaderboardEntry`, `Vote`, `VotingCategory` spelled identically across spec, plan, implementation, and tests. `scoreRoom` signature in Task 2 Step 1 (test call site) matches Task 2 Step 3 (implementation). `makeVote` shape matches `Vote` from `src/types/index.ts:76-85`.

- **One spec gap patched in the plan:** the spec didn't explicitly say whether contestants with zero votes appear in `leaderboard`. The plan pins "every contestant in `input.contestants` appears, with 0 if no points" in the implementation code — noted in the pipeline comments. Canonical test happens to vote for all contestants, so this is enforced as code-doc rather than a dedicated test. (Could add a dedicated test later; YAGNI for now.)
