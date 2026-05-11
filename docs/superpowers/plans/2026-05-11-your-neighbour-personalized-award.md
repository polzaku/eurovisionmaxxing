# Your Neighbour Personalized Award — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-viewer `your_neighbour` award that surfaces, for every signed-in room member, their own nearest neighbour (highest pairwise Pearson correlation). Coexists with the existing room-wide `neighbourhood_voters`. Dual-avatar card with a reciprocity badge on mutual top-1 pairs.

**Architecture:** Approach A — read-side compute. No schema migration, no `room_awards` row, no new endpoint, no new realtime event. A new pure helper `buildPersonalNeighbours` runs inside `loadResults` when `room.status === 'done'`; the result rides on the existing `done` payload. The cinematic reveal splices a synthetic `"personal-neighbour"` `CeremonyCard` after `neighbourhood_voters`; the static `/results/[id]` page renders a new `<YourNeighbourCard>` (client component, reads `getSession()`) inline in `<AwardsSection>`'s personality list.

**Tech Stack:** TypeScript (strict), Vitest + RTL, Next.js 14 App Router, next-intl, Supabase (client unchanged). Tests live next to source; RTL via per-file `// @vitest-environment jsdom` pragma + per-file `vi.mock("next-intl", ...)` per the canonical mock shape in `src/components/instant/OwnPointsCeremony.test.tsx`.

**Spec:** [docs/superpowers/specs/2026-05-11-your-neighbour-personalized-award-design.md](../specs/2026-05-11-your-neighbour-personalized-award-design.md)

---

## File Structure

**Create:**
- `src/lib/awards/userVectors.ts` — pure helper that builds the per-user contestant-mean vector map (extracted from the inline block currently inside `buildNeighbourhoodVoters`)
- `src/lib/awards/userVectors.test.ts`
- `src/lib/awards/buildPersonalNeighbours.ts` — pure compute returning `PersonalNeighbour[]`
- `src/lib/awards/buildPersonalNeighbours.test.ts`
- `src/components/results/YourNeighbourCard.tsx` — client component for the static `/results/[id]` slot
- `src/components/results/YourNeighbourCard.test.tsx`

**Modify:**
- `src/lib/awards/computeAwards.ts` — `buildNeighbourhoodVoters` consumes the extracted `buildUserVectors` (refactor, behaviour identical)
- `src/lib/results/loadResults.ts` — `done` discriminant gains `personalNeighbours`; `loadDone()` calls `buildPersonalNeighbours` with the data it already loads
- `src/lib/results/loadResults.test.ts` — assert payload shape, empty when <3 voters, absent on non-`done` discriminants
- `src/lib/awards/awardCeremonySequence.ts` — extended signature (`personalNeighbours?`, `viewerUserId?`); new `kind: "personal-neighbour"` variant on `CeremonyCard`; splice synthetic card right after `neighbourhood_voters`
- `src/lib/awards/awardCeremonySequence.test.ts` — splice position, omission for stranger viewers / no-entry members
- `src/lib/awards/awardExplainers.ts` — add `your_neighbour` resolution to `explainerForAward()` via a separate `YOUR_NEIGHBOUR_EXPLAINER` constant (PersonalityAwardKey type stays narrow)
- `src/components/awards/AwardCeremonyCard.tsx` — third branch for `kind: "personal-neighbour"`: dual avatars, "You & {neighbour}", caption, reciprocity badge, explainer, Pearson stat
- `src/components/awards/AwardCeremonyCard.test.tsx` — render branch + reciprocity badge cases
- `src/components/results/AwardsSection.tsx` — accept optional `personalNeighbours` + `members` (already passed) + viewer info via a single child `<YourNeighbourCard>` rendered inline as a sibling `<li>` right after `neighbourhood_voters`
- `src/components/room/DoneCeremony.tsx` — fetch viewer session id, plumb `personalNeighbours` + `viewerUserId` into `awardCeremonySequence`; widen `DoneFixture` type
- `src/app/results/[id]/page.tsx` — pass `data.personalNeighbours` into `<AwardsSection>`
- `src/locales/en.json` — `awards.your_neighbour.{name,caption,reciprocalBadge}` + `awards.explainers.your_neighbour` + `awards.personality.your_neighbour.{name,stat}`
- `src/locales/locales.test.ts` — no change needed; the test iterates keys present in `en` and expects same in non-`en` bundles, which already follow the skip-empty rule

---

## Task 1: Extract `buildUserVectors` shared helper

The inline `vectors` build inside `buildNeighbourhoodVoters` is the exact map we need to reuse for `buildPersonalNeighbours`. Extract it without changing observable behaviour, then make `buildNeighbourhoodVoters` consume it.

**Files:**
- Create: `src/lib/awards/userVectors.ts`
- Create: `src/lib/awards/userVectors.test.ts`
- Modify: `src/lib/awards/computeAwards.ts` (lines 299–351, the `buildNeighbourhoodVoters` function)

- [ ] **Step 1.1: Write failing tests for `buildUserVectors`**

Create `src/lib/awards/userVectors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Vote, VotingCategory } from "@/types";
import { buildUserVectors } from "./userVectors";

const CATS: VotingCategory[] = [
  { name: "Vocals", weight: 1, key: "vocals" },
  { name: "Outfit", weight: 1, key: "outfit" },
];

const CONTESTANTS = [
  { id: "2026-al", country: "Albania" },
  { id: "2026-be", country: "Belgium" },
];

const USERS = [
  { userId: "u1", displayName: "Alice" },
  { userId: "u2", displayName: "Bob" },
];

function vote(
  userId: string,
  contestantId: string,
  scores: Record<string, number> | null,
  missed = false,
): Vote {
  return {
    id: `v-${userId}-${contestantId}`,
    roomId: "r-1",
    userId,
    contestantId,
    scores,
    missed,
    hotTake: null,
    hotTakeEditedAt: null,
    updatedAt: "2026-04-26T00:00:00Z",
  };
}

describe("buildUserVectors", () => {
  it("builds one vector per user with one entry per contestant (mean of category scores)", () => {
    const result = buildUserVectors({
      categories: CATS,
      contestants: CONTESTANTS,
      users: USERS,
      votes: [
        vote("u1", "2026-al", { Vocals: 10, Outfit: 8 }), // mean 9
        vote("u1", "2026-be", { Vocals: 4, Outfit: 6 }),  // mean 5
        vote("u2", "2026-al", { Vocals: 8, Outfit: 6 }),  // mean 7
        vote("u2", "2026-be", { Vocals: 6, Outfit: 4 }),  // mean 5
      ],
      results: [],
    });
    expect(result.get("u1")).toEqual([9, 5]);
    expect(result.get("u2")).toEqual([7, 5]);
  });

  it("substitutes 0 for missing contestants", () => {
    const result = buildUserVectors({
      categories: CATS,
      contestants: CONTESTANTS,
      users: USERS,
      votes: [
        vote("u1", "2026-al", { Vocals: 10, Outfit: 8 }),
        // u1 has no vote for 2026-be → fills 0
        vote("u2", "2026-al", { Vocals: 8, Outfit: 6 }),
        vote("u2", "2026-be", { Vocals: 6, Outfit: 4 }),
      ],
      results: [],
    });
    expect(result.get("u1")).toEqual([9, 0]);
    expect(result.get("u2")).toEqual([7, 5]);
  });

  it("drops users whose vector is all zeros (zero-signal voter)", () => {
    const result = buildUserVectors({
      categories: CATS,
      contestants: CONTESTANTS,
      users: USERS,
      votes: [
        // u1 has zero signal — only missed votes
        vote("u1", "2026-al", { Vocals: 5 }, true),
        vote("u1", "2026-be", { Vocals: 5 }, true),
        vote("u2", "2026-al", { Vocals: 8, Outfit: 6 }),
      ],
      results: [],
    });
    expect(result.has("u1")).toBe(false);
    expect(result.has("u2")).toBe(true);
  });

  it("returns an empty map when no users have any signal", () => {
    const result = buildUserVectors({
      categories: CATS,
      contestants: CONTESTANTS,
      users: USERS,
      votes: [],
      results: [],
    });
    expect(result.size).toBe(0);
  });

  it("ignores missed votes in the mean", () => {
    const result = buildUserVectors({
      categories: CATS,
      contestants: CONTESTANTS,
      users: USERS,
      votes: [
        vote("u1", "2026-al", { Vocals: 10, Outfit: 8 }), // counted, mean 9
        vote("u1", "2026-be", { Vocals: 5, Outfit: 5 }, true), // missed → 0
        vote("u2", "2026-al", { Vocals: 8 }),
      ],
      results: [],
    });
    expect(result.get("u1")).toEqual([9, 0]);
  });
});
```

- [ ] **Step 1.2: Run the test — expect failure**

Run: `npx vitest run src/lib/awards/userVectors.test.ts`
Expected: FAIL with `Cannot find module './userVectors'`.

- [ ] **Step 1.3: Implement `buildUserVectors`**

Create `src/lib/awards/userVectors.ts`:

```ts
import type { ComputeAwardsInput } from "./computeAwards";

/**
 * Build a per-user vector indexed by contestant. Each entry is the mean of
 * that user's category scores for the contestant; missing or missed votes
 * substitute 0. Users whose entire vector is all zeros are dropped — they
 * carry no signal for correlation-based awards.
 *
 * Shared by `buildNeighbourhoodVoters` (room-wide Pearson) and
 * `buildPersonalNeighbours` (per-viewer Pearson).
 */
export function buildUserVectors(
  input: ComputeAwardsInput,
): Map<string, number[]> {
  const vectors = new Map<string, number[]>();
  for (const u of input.users) {
    const vec = input.contestants.map((c) =>
      userContestantMeanLocal(u.userId, c.id, input.votes) ?? 0,
    );
    if (vec.some((x) => x !== 0)) vectors.set(u.userId, vec);
  }
  return vectors;
}

function userContestantMeanLocal(
  userId: string,
  contestantId: string,
  votes: ComputeAwardsInput["votes"],
): number | null {
  const v = votes.find(
    (x) => x.userId === userId && x.contestantId === contestantId && !x.missed,
  );
  if (!v || !v.scores) return null;
  const values = Object.values(v.scores);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
```

Note: we duplicate `userContestantMean` here rather than exporting the existing private one from `computeAwards.ts` to keep this module independent. If a future PR wants to deduplicate, it can promote one to `awards/internal/userMeans.ts`.

- [ ] **Step 1.4: Run the test — expect pass**

Run: `npx vitest run src/lib/awards/userVectors.test.ts`
Expected: PASS.

- [ ] **Step 1.5: Refactor `buildNeighbourhoodVoters` to consume `buildUserVectors`**

In `src/lib/awards/computeAwards.ts`, replace the existing `buildNeighbourhoodVoters` body lines 302–312 (the inline `vectors` build) with a call to the new helper. Specifically:

Before:
```ts
function buildNeighbourhoodVoters(
  input: ComputeAwardsInput,
): ComputedAward | null {
  if (input.users.length < 2) return null;
  // For each user, build a vector of mean-of-categories per contestant.
  const vectors = new Map<string, number[]>();
  for (const u of input.users) {
    const vec = input.contestants.map(
      (c) => userContestantMean(u.userId, c.id, input.votes) ?? 0,
    );
    // Skip users with no signal at all (all zeros from missing data).
    if (vec.some((x) => x !== 0)) vectors.set(u.userId, vec);
  }
  if (vectors.size < 2) return null;
  // ... rest unchanged
```

After:
```ts
import { buildUserVectors } from "./userVectors";

function buildNeighbourhoodVoters(
  input: ComputeAwardsInput,
): ComputedAward | null {
  if (input.users.length < 2) return null;
  const vectors = buildUserVectors(input);
  if (vectors.size < 2) return null;
  // ... rest unchanged
```

- [ ] **Step 1.6: Run the full awards test suite to confirm no regression**

Run: `npx vitest run src/lib/awards/`
Expected: PASS for both `userVectors.test.ts` and the existing `computeAwards.test.ts` / `awardCeremonySequence.test.ts` / etc.

- [ ] **Step 1.7: Run `tsc --noEmit`**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 1.8: Commit**

```bash
git add src/lib/awards/userVectors.ts src/lib/awards/userVectors.test.ts src/lib/awards/computeAwards.ts
git commit -m "$(cat <<'EOF'
refactor(awards): extract buildUserVectors shared helper (no behaviour change)

Pure-function extraction from buildNeighbourhoodVoters' inline vector
build. Same semantics: per-user, per-contestant mean of category scores;
zero-signal users dropped. Sets up buildPersonalNeighbours to consume
the same primitive.
EOF
)"
```

---

## Task 2: `buildPersonalNeighbours` pure compute

The new compute that produces one row per signal-bearing user, pointing at their nearest neighbour. Pure function; no DB, no I/O.

**Files:**
- Create: `src/lib/awards/buildPersonalNeighbours.ts`
- Create: `src/lib/awards/buildPersonalNeighbours.test.ts`

- [ ] **Step 2.1: Write the failing tests**

Create `src/lib/awards/buildPersonalNeighbours.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Vote, VotingCategory } from "@/types";
import { buildPersonalNeighbours } from "./buildPersonalNeighbours";

const U1 = "11111111-2222-4333-8444-000000000001";
const U2 = "22222222-3333-4444-8555-000000000002";
const U3 = "33333333-4444-4555-8666-000000000003";
const U4 = "44444444-5555-4666-8777-000000000004";

const CATS: VotingCategory[] = [
  { name: "Vocals", weight: 1, key: "vocals" },
  { name: "Outfit", weight: 1, key: "outfit" },
];

const CONTESTANTS = [
  { id: "2026-al", country: "Albania" },
  { id: "2026-be", country: "Belgium" },
  { id: "2026-cr", country: "Croatia" },
  { id: "2026-de", country: "Germany" },
];

function vote(
  userId: string,
  contestantId: string,
  scores: Record<string, number> | null,
  missed = false,
): Vote {
  return {
    id: `v-${userId}-${contestantId}`,
    roomId: "r-1",
    userId,
    contestantId,
    scores,
    missed,
    hotTake: null,
    hotTakeEditedAt: null,
    updatedAt: "2026-04-26T00:00:00Z",
  };
}

describe("buildPersonalNeighbours", () => {
  it("returns [] when there are fewer than 3 signal-bearing users", () => {
    // Only u1 and u2 have signal — 2 users only; the room-wide neighbourhood
    // award already covers them, so the per-viewer award skips.
    const result = buildPersonalNeighbours({
      categories: CATS,
      contestants: CONTESTANTS,
      users: [
        { userId: U1, displayName: "Alice" },
        { userId: U2, displayName: "Bob" },
      ],
      votes: [
        vote(U1, "2026-al", { Vocals: 9, Outfit: 9 }),
        vote(U2, "2026-al", { Vocals: 8, Outfit: 8 }),
      ],
      results: [],
    });
    expect(result).toEqual([]);
  });

  it("returns [] when only one user has signal", () => {
    const result = buildPersonalNeighbours({
      categories: CATS,
      contestants: CONTESTANTS,
      users: [
        { userId: U1, displayName: "Alice" },
        { userId: U2, displayName: "Bob" },
        { userId: U3, displayName: "Carol" },
      ],
      votes: [
        vote(U1, "2026-al", { Vocals: 9 }),
        // u2, u3 — missed everything
        vote(U2, "2026-al", { Vocals: 5 }, true),
        vote(U3, "2026-al", { Vocals: 5 }, true),
      ],
      results: [],
    });
    expect(result).toEqual([]);
  });

  it("returns one entry per signal-bearing user, each pointing at their argmax neighbour", () => {
    // u1 and u3 vote identically (perfect correlation); u2 is the contrarian.
    const result = buildPersonalNeighbours({
      categories: CATS,
      contestants: CONTESTANTS,
      users: [
        { userId: U1, displayName: "Alice" },
        { userId: U2, displayName: "Bob" },
        { userId: U3, displayName: "Carol" },
      ],
      votes: [
        vote(U1, "2026-al", { Vocals: 10, Outfit: 9 }),
        vote(U1, "2026-be", { Vocals: 2, Outfit: 3 }),
        vote(U1, "2026-cr", { Vocals: 7, Outfit: 6 }),
        vote(U1, "2026-de", { Vocals: 5, Outfit: 5 }),
        vote(U2, "2026-al", { Vocals: 2, Outfit: 1 }),
        vote(U2, "2026-be", { Vocals: 9, Outfit: 10 }),
        vote(U2, "2026-cr", { Vocals: 4, Outfit: 5 }),
        vote(U2, "2026-de", { Vocals: 6, Outfit: 7 }),
        vote(U3, "2026-al", { Vocals: 9, Outfit: 10 }),
        vote(U3, "2026-be", { Vocals: 3, Outfit: 2 }),
        vote(U3, "2026-cr", { Vocals: 6, Outfit: 7 }),
        vote(U3, "2026-de", { Vocals: 5, Outfit: 5 }),
      ],
      results: [],
    });
    expect(result).toHaveLength(3);
    const byUser = new Map(result.map((r) => [r.userId, r]));
    expect(byUser.get(U1)?.neighbourUserId).toBe(U3);
    expect(byUser.get(U3)?.neighbourUserId).toBe(U1);
    // u2 is closest to whichever of u1/u3 has higher Pearson; both should be in range.
    expect([U1, U3]).toContain(byUser.get(U2)?.neighbourUserId);
  });

  it("flags isReciprocal=true for mutual top-1 pairs", () => {
    const result = buildPersonalNeighbours({
      categories: CATS,
      contestants: CONTESTANTS,
      users: [
        { userId: U1, displayName: "Alice" },
        { userId: U2, displayName: "Bob" },
        { userId: U3, displayName: "Carol" },
      ],
      votes: [
        vote(U1, "2026-al", { Vocals: 10, Outfit: 9 }),
        vote(U1, "2026-be", { Vocals: 2, Outfit: 3 }),
        vote(U1, "2026-cr", { Vocals: 7, Outfit: 6 }),
        vote(U1, "2026-de", { Vocals: 5, Outfit: 5 }),
        vote(U2, "2026-al", { Vocals: 2, Outfit: 1 }),
        vote(U2, "2026-be", { Vocals: 9, Outfit: 10 }),
        vote(U2, "2026-cr", { Vocals: 4, Outfit: 5 }),
        vote(U2, "2026-de", { Vocals: 6, Outfit: 7 }),
        vote(U3, "2026-al", { Vocals: 9, Outfit: 10 }),
        vote(U3, "2026-be", { Vocals: 3, Outfit: 2 }),
        vote(U3, "2026-cr", { Vocals: 6, Outfit: 7 }),
        vote(U3, "2026-de", { Vocals: 5, Outfit: 5 }),
      ],
      results: [],
    });
    const byUser = new Map(result.map((r) => [r.userId, r]));
    // u1 and u3 are each other's nearest — both flagged reciprocal.
    expect(byUser.get(U1)?.isReciprocal).toBe(true);
    expect(byUser.get(U3)?.isReciprocal).toBe(true);
    // u2's nearest is not nearest to u2 → false.
    expect(byUser.get(U2)?.isReciprocal).toBe(false);
  });

  it("breaks ties alphabetically by neighbour displayName", () => {
    // u1 is exactly equidistant from u2 (Bob) and u3 (Carol). Expect Bob (alphabetical).
    const result = buildPersonalNeighbours({
      categories: CATS,
      contestants: CONTESTANTS,
      users: [
        { userId: U1, displayName: "Alice" },
        { userId: U2, displayName: "Bob" },
        { userId: U3, displayName: "Carol" },
      ],
      votes: [
        // u1's vector: [9, 9, 9, 9]
        vote(U1, "2026-al", { Vocals: 9 }),
        vote(U1, "2026-be", { Vocals: 9 }),
        vote(U1, "2026-cr", { Vocals: 9 }),
        vote(U1, "2026-de", { Vocals: 9 }),
        // u2 and u3 — identical vectors → identical Pearson vs u1.
        vote(U2, "2026-al", { Vocals: 8 }),
        vote(U2, "2026-be", { Vocals: 6 }),
        vote(U2, "2026-cr", { Vocals: 4 }),
        vote(U2, "2026-de", { Vocals: 2 }),
        vote(U3, "2026-al", { Vocals: 8 }),
        vote(U3, "2026-be", { Vocals: 6 }),
        vote(U3, "2026-cr", { Vocals: 4 }),
        vote(U3, "2026-de", { Vocals: 2 }),
      ],
      results: [],
    });
    const row = result.find((r) => r.userId === U1);
    expect(row?.neighbourUserId).toBe(U2);
  });

  it("excludes zero-signal users from the pool (neither as viewer nor neighbour)", () => {
    const result = buildPersonalNeighbours({
      categories: CATS,
      contestants: CONTESTANTS,
      users: [
        { userId: U1, displayName: "Alice" },
        { userId: U2, displayName: "Bob" },
        { userId: U3, displayName: "Carol" },
        { userId: U4, displayName: "Dan" }, // zero signal
      ],
      votes: [
        vote(U1, "2026-al", { Vocals: 9 }),
        vote(U1, "2026-be", { Vocals: 3 }),
        vote(U2, "2026-al", { Vocals: 8 }),
        vote(U2, "2026-be", { Vocals: 4 }),
        vote(U3, "2026-al", { Vocals: 7 }),
        vote(U3, "2026-be", { Vocals: 5 }),
        // u4 — all missed
        vote(U4, "2026-al", { Vocals: 5 }, true),
      ],
      results: [],
    });
    const userIds = result.map((r) => r.userId);
    const neighbourIds = result.map((r) => r.neighbourUserId);
    expect(userIds).not.toContain(U4);
    expect(neighbourIds).not.toContain(U4);
    expect(result).toHaveLength(3);
  });

  it("rounds Pearson to 3 decimals", () => {
    const result = buildPersonalNeighbours({
      categories: CATS,
      contestants: CONTESTANTS,
      users: [
        { userId: U1, displayName: "Alice" },
        { userId: U2, displayName: "Bob" },
        { userId: U3, displayName: "Carol" },
      ],
      votes: [
        vote(U1, "2026-al", { Vocals: 10, Outfit: 9 }),
        vote(U1, "2026-be", { Vocals: 2, Outfit: 3 }),
        vote(U2, "2026-al", { Vocals: 2, Outfit: 1 }),
        vote(U2, "2026-be", { Vocals: 9, Outfit: 10 }),
        vote(U3, "2026-al", { Vocals: 9, Outfit: 10 }),
        vote(U3, "2026-be", { Vocals: 3, Outfit: 2 }),
      ],
      results: [],
    });
    for (const row of result) {
      const fractional = String(row.pearson).split(".")[1] ?? "";
      expect(fractional.length).toBeLessThanOrEqual(3);
    }
  });

  it("is deterministic — same input, same output regardless of user ordering", () => {
    const input = {
      categories: CATS,
      contestants: CONTESTANTS,
      users: [
        { userId: U1, displayName: "Alice" },
        { userId: U2, displayName: "Bob" },
        { userId: U3, displayName: "Carol" },
      ],
      votes: [
        vote(U1, "2026-al", { Vocals: 10, Outfit: 9 }),
        vote(U1, "2026-be", { Vocals: 2, Outfit: 3 }),
        vote(U2, "2026-al", { Vocals: 2, Outfit: 1 }),
        vote(U2, "2026-be", { Vocals: 9, Outfit: 10 }),
        vote(U3, "2026-al", { Vocals: 9, Outfit: 10 }),
        vote(U3, "2026-be", { Vocals: 3, Outfit: 2 }),
      ],
      results: [],
    };
    const a = buildPersonalNeighbours(input);
    const b = buildPersonalNeighbours({
      ...input,
      users: [...input.users].reverse(),
    });
    const sortById = (
      rows: { userId: string; neighbourUserId: string }[],
    ) => [...rows].sort((x, y) => x.userId.localeCompare(y.userId));
    expect(sortById(a)).toEqual(sortById(b));
  });
});
```

- [ ] **Step 2.2: Run the test — expect failure**

Run: `npx vitest run src/lib/awards/buildPersonalNeighbours.test.ts`
Expected: FAIL with `Cannot find module './buildPersonalNeighbours'`.

- [ ] **Step 2.3: Implement `buildPersonalNeighbours`**

Create `src/lib/awards/buildPersonalNeighbours.ts`:

```ts
import type { ComputeAwardsInput } from "./computeAwards";
import { buildUserVectors } from "./userVectors";
import { pearsonCorrelation } from "@/lib/scoring";

const EPS = 1e-9;

export interface PersonalNeighbour {
  userId: string;
  neighbourUserId: string;
  /** Pearson correlation, rounded to 3 decimals. Range: [-1, 1]. */
  pearson: number;
  /** True iff the pair is mutually each other's top-1 nearest. */
  isReciprocal: boolean;
}

/**
 * For every signal-bearing user in the room, compute their nearest neighbour
 * (highest pairwise Pearson correlation across per-contestant mean vectors).
 * Returns one row per viewer; the corresponding card is spliced into the
 * cinematic awards sequence after `neighbourhood_voters`. Members without
 * a row (zero-signal voters, or rooms with <3 signal-bearing users) skip
 * the slot in their reveal.
 *
 * Pure function — same inputs always produce the same output. Ties are
 * broken alphabetically by neighbour displayName so the choice is stable
 * across reloads.
 *
 * Skip rule: when fewer than 3 users have signal vectors, the room-wide
 * `neighbourhood_voters` award already covers the only meaningful pair
 * and the personalized version would just duplicate it.
 */
export function buildPersonalNeighbours(
  input: ComputeAwardsInput,
): PersonalNeighbour[] {
  const vectors = buildUserVectors(input);
  if (vectors.size < 3) return [];

  const userIds = [...vectors.keys()];
  const nameById = new Map(input.users.map((u) => [u.userId, u.displayName]));

  type Pick = {
    userId: string;
    neighbourUserId: string;
    pearson: number;
  };

  const picks: Pick[] = [];

  for (const a of userIds) {
    const va = vectors.get(a)!;
    let bestNeighbour: string | null = null;
    let bestCorr = -Infinity;
    let bestName = "";

    for (const b of userIds) {
      if (b === a) continue;
      const vb = vectors.get(b)!;
      const corr = pearsonCorrelation(va, vb);
      const name = nameById.get(b) ?? "";
      if (corr > bestCorr + EPS) {
        bestNeighbour = b;
        bestCorr = corr;
        bestName = name;
      } else if (Math.abs(corr - bestCorr) < EPS) {
        // Tie — alphabetical neighbour displayName wins.
        if (name.localeCompare(bestName) < 0) {
          bestNeighbour = b;
          bestName = name;
        }
      }
    }

    if (bestNeighbour !== null) {
      picks.push({
        userId: a,
        neighbourUserId: bestNeighbour,
        pearson: Number(bestCorr.toFixed(3)),
      });
    }
  }

  // Reciprocity pass: a pair (a→b, b→a) is mutual.
  const neighbourOf = new Map(
    picks.map((p) => [p.userId, p.neighbourUserId]),
  );
  return picks.map((p) => ({
    ...p,
    isReciprocal: neighbourOf.get(p.neighbourUserId) === p.userId,
  }));
}
```

- [ ] **Step 2.4: Run the test — expect pass**

Run: `npx vitest run src/lib/awards/buildPersonalNeighbours.test.ts`
Expected: PASS for all 8 cases.

- [ ] **Step 2.5: Run `tsc --noEmit`**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 2.6: Commit**

```bash
git add src/lib/awards/buildPersonalNeighbours.ts src/lib/awards/buildPersonalNeighbours.test.ts
git commit -m "$(cat <<'EOF'
feat(awards): buildPersonalNeighbours pure compute (your_neighbour award)

Per-viewer nearest-neighbour pick via pairwise Pearson on the same
contestant-mean vectors used by neighbourhood_voters. Alphabetical
tiebreak by neighbour displayName, reciprocity flagged on mutual top-1
pairs, skipped for rooms with <3 signal-bearing voters.

Spec: docs/superpowers/specs/2026-05-11-your-neighbour-personalized-award-design.md §4
EOF
)"
```

---

## Task 3: Extend `loadResults` payload with `personalNeighbours`

Wire the new compute into the read path. The `done` discriminant gains the field; non-`done` arms stay untouched.

**Files:**
- Modify: `src/lib/results/loadResults.ts` (the `done` shape + `loadDone()` function)
- Modify: `src/lib/results/loadResults.test.ts` (add `done` cases)

- [ ] **Step 3.1: Write failing tests in `loadResults.test.ts`**

Append the following block to `src/lib/results/loadResults.test.ts` after the existing `done` describe block (find the existing `describe("loadResults — done", ...)` if present; if not, add a new one). Add this new describe block at the bottom of the file:

```ts
// ─── done — personalNeighbours ─────────────────────────────────────────
// (`vi`, `describe`, `it`, `expect` already imported at top of file)

describe("loadResults — done personalNeighbours", () => {
  const ROOM_ID = "11111111-2222-4333-8444-555555555555";
  const OWNER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const ALICE = "11111111-2222-4333-8444-000000000001";
  const BOB = "22222222-3333-4444-8555-000000000002";
  const CAROL = "33333333-4444-4555-8666-000000000003";

  // Three users each with non-trivial votes → ≥3 signal-bearing → expect entries.
  const doneRoom = {
    data: {
      id: ROOM_ID,
      status: "done",
      pin: "DONEEE",
      year: 2026,
      event: "final",
      owner_user_id: OWNER,
    },
    error: null,
  };

  const memberships = {
    data: [
      { user_id: ALICE, users: { display_name: "Alice", avatar_seed: "alice" } },
      { user_id: BOB, users: { display_name: "Bob", avatar_seed: "bob" } },
      { user_id: CAROL, users: { display_name: "Carol", avatar_seed: "carol" } },
    ],
    error: null,
  };

  it("attaches personalNeighbours array on the done payload", async () => {
    const mock = makeSupabaseMock({
      roomSelect: doneRoom,
      membershipsSelect: memberships,
      resultsSelect: { data: [], error: null },
      awardsSelect: { data: [], error: null },
    });
    const result = await loadResults({ roomId: ROOM_ID }, makeDeps(mock));
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "done") return;
    expect(Array.isArray(result.data.personalNeighbours)).toBe(true);
  });

  it("returns empty personalNeighbours when there are <3 voters with signal", async () => {
    // Memberships exist but no votes loaded → no signal-bearing users.
    const mock = makeSupabaseMock({
      roomSelect: doneRoom,
      membershipsSelect: memberships,
      resultsSelect: { data: [], error: null },
      awardsSelect: { data: [], error: null },
    });
    const result = await loadResults({ roomId: ROOM_ID }, makeDeps(mock));
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "done") return;
    expect(result.data.personalNeighbours).toEqual([]);
  });
});
```

If the existing `loadResults.test.ts` already has a `votesSelect` mock entry on `makeSupabaseMock` (needed for loadDone to read votes), use it; otherwise the votes table call inside `loadDone` is **for hot-takes only** — `loadDone` does not currently SELECT raw votes (only `hot_take` rows with `.not("hot_take", "is", null)`). Confirm this when you start: re-grep `loadDone` for `from("votes")` and note that the personalNeighbours compute will need the raw votes too. This drives **Step 3.2**.

- [ ] **Step 3.2: Decide how votes reach the personalNeighbours compute**

`buildPersonalNeighbours` needs `Vote[]` (post-fill, with `scores` populated). `loadDone` currently doesn't load raw votes — only hot-take rows. The cleanest fix is to add a single new SELECT in `loadDone` for the full votes table for this room, before the personalNeighbours compute. This SELECT loads `user_id, contestant_id, scores, missed` only.

In `src/lib/results/loadResults.ts`, inside `loadDone()`, after the existing `hotTakesQuery` block and before `awardsQuery`, add:

```ts
const votesQuery = await deps.supabase
  .from("votes")
  .select("user_id, contestant_id, scores, missed")
  .eq("room_id", room.id);

if (votesQuery.error) {
  return fail("INTERNAL_ERROR", "Could not load votes for awards.", 500);
}
const voteRows = (votesQuery.data ?? []) as Array<{
  user_id: string;
  contestant_id: string;
  scores: Record<string, number> | null;
  missed: boolean;
}>;
```

Then map these into the `Vote` shape `buildPersonalNeighbours` expects, just before computing. Categories are read from `rooms.categories` — we'll need to add that to the room SELECT.

Update the `roomQuery` SELECT (line 247 in the current file) to include `categories`:

```ts
const roomQuery = await deps.supabase
  .from("rooms")
  .select(
    "id, status, pin, year, event, owner_user_id, categories, announcement_order, announcing_user_id, current_announce_idx, delegate_user_id, announce_skipped_user_ids",
  )
  .eq("id", roomId)
  .maybeSingle();
```

And widen `RoomBase`:

```ts
type RoomBase = {
  id: string;
  status: string;
  pin: string;
  year: number;
  event: string;
  owner_user_id: string;
  categories: unknown; // JSONB; cast below before use
  announcement_order: string[] | null;
  announcing_user_id: string | null;
  current_announce_idx: number | null;
  delegate_user_id: string | null;
  announce_skipped_user_ids: string[] | null;
};
```

This change is additive — every existing caller of `loadResults` still works because the new field is only consumed in `loadDone`.

- [ ] **Step 3.3: Add the `personalNeighbours` field to the `done` discriminant**

In `src/lib/results/loadResults.ts`, locate the `ResultsData` type union (lines 82–120). In the `done` arm, add the new field right after `awards: RoomAward[]`:

```ts
| {
    status: "done";
    year: number;
    event: EventType;
    pin: string;
    ownerUserId: string;
    leaderboard: LeaderboardEntry[];
    contestants: Contestant[];
    breakdowns: UserBreakdown[];
    contestantBreakdowns: ContestantBreakdown[];
    hotTakes: HotTakeEntry[];
    awards: RoomAward[];
    /**
     * SPEC §11.2 your_neighbour — per-viewer nearest-neighbour pick. The
     * full mapping for the room is exposed here; the client renderer
     * filters to the caller's session. Empty when <3 voters have signal.
     */
    personalNeighbours: import("@/lib/awards/buildPersonalNeighbours").PersonalNeighbour[];
    members: Array<{
      userId: string;
      displayName: string;
      avatarSeed: string;
    }>;
  };
```

Prefer a top-of-file `import` rather than the inline import — clean it up by adding:

```ts
import type { PersonalNeighbour } from "@/lib/awards/buildPersonalNeighbours";
```

at the top of the file with the other imports, and use `PersonalNeighbour[]` in the type.

- [ ] **Step 3.4: Call `buildPersonalNeighbours` inside `loadDone`**

In `loadDone`, after `contestantBreakdowns` is computed and before the return statement, add:

```ts
import { buildPersonalNeighbours } from "@/lib/awards/buildPersonalNeighbours";
// (move to top of file alongside the other imports)
```

Then in `loadDone()` (top of file imports already done), build the Vote[] adapter and compute the field:

```ts
// Adapt the lightweight vote rows to the `Vote` shape buildPersonalNeighbours expects.
// (Same fields it actually consumes — id/roomId/hotTake/updatedAt are unused by the compute.)
const votesForAwards = voteRows.map((r) => ({
  id: `${r.user_id}-${r.contestant_id}`,
  roomId: room.id,
  userId: r.user_id,
  contestantId: r.contestant_id,
  scores: r.scores,
  missed: r.missed,
  hotTake: null,
  hotTakeEditedAt: null,
  updatedAt: "",
}));

const usersForAwards = members.map((m) => ({
  userId: m.userId,
  displayName: m.displayName,
}));

const categories =
  Array.isArray(room.categories) ? (room.categories as Array<{ name: string; weight: number; key?: string }>) : [];

const personalNeighbours = buildPersonalNeighbours({
  categories,
  contestants: contestants.map((c) => ({ id: c.id, country: c.country })),
  users: usersForAwards,
  votes: votesForAwards,
  results: [],
});
```

Then in the `return { ok: true, data: { ... } }` block, include `personalNeighbours`.

Note: the `results` field on `ComputeAwardsInput` is required by the existing type but unused by `buildPersonalNeighbours` (only `buildEnabler` uses it). Pass an empty array.

- [ ] **Step 3.5: Run the new test — expect pass**

Run: `npx vitest run src/lib/results/loadResults.test.ts -t "personalNeighbours"`
Expected: PASS for both cases.

If the existing `loadResults.test.ts` mock factory doesn't account for the new `votes` SELECT inside `loadDone`, extend `makeSupabaseMock` with a `votesSelect` (defaulting to `{ data: [], error: null }`) and route the `votes` table call appropriately. Look at the existing `votes` table branch (used for hot-takes via `.not("hot_take", "is", null)`) and add a second branch that handles the plain `.eq("room_id", id)` call without the `.not(...)` chain — that's the personalNeighbours-related SELECT.

- [ ] **Step 3.6: Re-run the full `loadResults.test.ts` to catch regressions**

Run: `npx vitest run src/lib/results/loadResults.test.ts`
Expected: PASS for every existing case + the two new ones.

- [ ] **Step 3.7: Run `tsc --noEmit`**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3.8: Commit**

```bash
git add src/lib/results/loadResults.ts src/lib/results/loadResults.test.ts
git commit -m "$(cat <<'EOF'
feat(results): personalNeighbours field on done payload (your_neighbour)

loadDone loads votes + categories alongside the existing reads and runs
buildPersonalNeighbours, attaching the result to the discriminated
done arm. No new endpoint; rides the existing /api/results/{id} and
/api/rooms/{id}/results responses. Empty when <3 signal-bearing voters.

Spec: docs/superpowers/specs/2026-05-11-your-neighbour-personalized-award-design.md §5
EOF
)"
```

---

## Task 4: Extend `awardCeremonySequence` with the synthetic card

Add a `kind: "personal-neighbour"` variant to `CeremonyCard` and splice it after `neighbourhood_voters` when the viewer has an entry.

**Files:**
- Modify: `src/lib/awards/awardCeremonySequence.ts`
- Modify: `src/lib/awards/awardCeremonySequence.test.ts`

- [ ] **Step 4.1: Add failing tests**

Add the following cases to `src/lib/awards/awardCeremonySequence.test.ts` (inside the existing `describe`):

```ts
import type { PersonalNeighbour } from "@/lib/awards/buildPersonalNeighbours";

// helper at file scope (alongside the existing mkAward / mkContestant)
function mkPN(
  userId: string,
  neighbourUserId: string,
  pearson = 0.8,
  isReciprocal = false,
): PersonalNeighbour {
  return { userId, neighbourUserId, pearson, isReciprocal };
}

it("splices the personal-neighbour synthetic card immediately after neighbourhood_voters", () => {
  const members = [
    { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
    { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
    { userId: "u3", displayName: "Carol", avatarSeed: "carol" },
  ];
  const awards: RoomAward[] = [
    mkAward("biggest_stan", { winnerUserId: "u1" }),
    mkAward("neighbourhood_voters", { winnerUserId: "u1", winnerUserIdB: "u2" }),
    mkAward("the_dark_horse", { winnerContestantId: "2026-SE" }),
  ];
  const result = awardCeremonySequence(awards, [mkContestant("2026-SE", "Sweden")], members, [], {
    personalNeighbours: [mkPN("u3", "u1", 0.92, false)],
    viewerUserId: "u3",
  });
  const keys = result.map((c) => c.award.awardKey);
  expect(keys).toEqual([
    "biggest_stan",
    "neighbourhood_voters",
    "your_neighbour",
    "the_dark_horse",
  ]);
});

it("omits the personal-neighbour card when the viewer has no entry", () => {
  const members = [
    { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
    { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
  ];
  const awards: RoomAward[] = [
    mkAward("neighbourhood_voters", { winnerUserId: "u1", winnerUserIdB: "u2" }),
  ];
  const result = awardCeremonySequence(awards, [], members, [], {
    personalNeighbours: [],
    viewerUserId: "u1",
  });
  expect(result.map((c) => c.award.awardKey)).toEqual(["neighbourhood_voters"]);
});

it("omits the personal-neighbour card when viewerUserId is null (stranger)", () => {
  const members = [
    { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
    { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
  ];
  const awards: RoomAward[] = [
    mkAward("neighbourhood_voters", { winnerUserId: "u1", winnerUserIdB: "u2" }),
  ];
  const result = awardCeremonySequence(awards, [], members, [], {
    personalNeighbours: [mkPN("u1", "u2"), mkPN("u2", "u1")],
    viewerUserId: null,
  });
  expect(result.map((c) => c.award.awardKey)).toEqual(["neighbourhood_voters"]);
});

it("carries neighbour avatar + reciprocity into the synthetic card", () => {
  const members = [
    { userId: "u1", displayName: "Alice", avatarSeed: "alice-seed" },
    { userId: "u2", displayName: "Bob", avatarSeed: "bob-seed" },
    { userId: "u3", displayName: "Carol", avatarSeed: "carol-seed" },
  ];
  const awards: RoomAward[] = [
    mkAward("neighbourhood_voters", { winnerUserId: "u1", winnerUserIdB: "u2" }),
  ];
  const result = awardCeremonySequence(awards, [], members, [], {
    personalNeighbours: [mkPN("u3", "u1", 0.881, true)],
    viewerUserId: "u3",
  });
  const synthetic = result.find((c) => c.award.awardKey === "your_neighbour");
  expect(synthetic?.kind).toBe("personal-neighbour");
  if (synthetic?.kind !== "personal-neighbour") return;
  expect(synthetic.viewerUser.userId).toBe("u3");
  expect(synthetic.neighbourUser.userId).toBe("u1");
  expect(synthetic.neighbourUser.avatarSeed).toBe("alice-seed");
  expect(synthetic.pearson).toBe(0.881);
  expect(synthetic.isReciprocal).toBe(true);
});

it("drops the synthetic card defensively if the neighbour can't be resolved against members", () => {
  // Member list missing u1 — invariant should never happen in practice, but
  // exercise the defensive branch.
  const members = [
    { userId: "u3", displayName: "Carol", avatarSeed: "carol" },
  ];
  const result = awardCeremonySequence([], [], members, [], {
    personalNeighbours: [mkPN("u3", "u1")],
    viewerUserId: "u3",
  });
  expect(result).toEqual([]);
});
```

- [ ] **Step 4.2: Run the tests — expect failure**

Run: `npx vitest run src/lib/awards/awardCeremonySequence.test.ts`
Expected: FAIL — current signature doesn't accept a 5th arg / `CeremonyCard` doesn't have `personal-neighbour`.

- [ ] **Step 4.3: Implement the extension**

Modify `src/lib/awards/awardCeremonySequence.ts`:

```ts
import type { Contestant, RoomAward } from "@/types";
import type { PersonalNeighbour } from "@/lib/awards/buildPersonalNeighbours";
import { PERSONALITY_AWARD_KEYS, categoryAwardKey } from "./awardKeys";

export interface MemberView {
  userId: string;
  displayName: string;
  avatarSeed: string;
}

export interface VotingCategoryLite {
  name: string;
  key?: string;
}

/**
 * Synthetic award shape used by the personal-neighbour ceremony card. Mirrors
 * the `RoomAward` field set so the existing sequence machinery (sorting,
 * keying) keeps working without a special case. `winnerUserId` is the
 * viewer; `winnerUserIdB` is the neighbour.
 */
function syntheticPersonalNeighbourAward(
  viewer: MemberView,
  neighbour: MemberView,
  pearson: number,
): RoomAward {
  return {
    roomId: "",
    awardKey: "your_neighbour",
    awardName: "Your closest neighbour",
    winnerUserId: viewer.userId,
    winnerUserIdB: neighbour.userId,
    winnerContestantId: null,
    statValue: pearson,
    statLabel: `Pearson ${pearson.toFixed(2)}`,
  };
}

export type CeremonyCard =
  | {
      kind: "contestant";
      award: RoomAward;
      contestant: Contestant | null;
    }
  | {
      kind: "user";
      award: RoomAward;
      winner: MemberView | null;
      partner: MemberView | null;
    }
  | {
      kind: "personal-neighbour";
      award: RoomAward;
      viewerUser: MemberView;
      neighbourUser: MemberView;
      pearson: number;
      isReciprocal: boolean;
    };

const PERSONALITY_RANK = new Map<string, number>(
  PERSONALITY_AWARD_KEYS.map((k, i) => [k, i]),
);

// Personal-neighbour slots immediately after neighbourhood_voters in the
// SPEC §11.3 sequence. We give it the rank of neighbourhood_voters + 0.5
// so the existing sort places it correctly without changing the canonical
// PERSONALITY_AWARD_KEYS list (which represents persisted awards only).
const NEIGHBOURHOOD_RANK =
  PERSONALITY_RANK.get("neighbourhood_voters") ?? 99;
const PERSONAL_NEIGHBOUR_RANK = NEIGHBOURHOOD_RANK + 0.5;

export interface PersonalNeighbourOptions {
  personalNeighbours?: PersonalNeighbour[];
  viewerUserId?: string | null;
}

/**
 * Produces the ordered card sequence for the SPEC §11.3 cinematic reveal.
 * Category awards lead in voting-category order; personality awards follow
 * the SPEC-prescribed `PERSONALITY_AWARD_KEYS` order (Biggest stan first,
 * The enabler always last). The synthetic `your_neighbour` card (§11.2 V1.1)
 * is spliced immediately after `neighbourhood_voters` when both
 * `personalNeighbours` and `viewerUserId` resolve to an entry.
 * Awards whose winner can't be resolved against the members/contestants
 * pools are dropped defensively.
 */
export function awardCeremonySequence(
  awards: RoomAward[],
  contestants: Contestant[],
  members: MemberView[],
  categories: VotingCategoryLite[],
  options: PersonalNeighbourOptions = {},
): CeremonyCard[] {
  const contestantById = new Map(contestants.map((c) => [c.id, c]));
  const memberById = new Map(members.map((m) => [m.userId, m]));

  const categoryOrder = new Map<string, number>(
    categories.map((c, i) => [
      categoryAwardKey({ name: c.name, weight: 1, key: c.key }),
      i,
    ]),
  );

  const cards: CeremonyCard[] = [];

  for (const a of awards) {
    if (a.awardKey.startsWith("best_") || a.winnerContestantId) {
      cards.push({
        kind: "contestant",
        award: a,
        contestant: a.winnerContestantId
          ? contestantById.get(a.winnerContestantId) ?? null
          : null,
      });
      continue;
    }

    const winner = a.winnerUserId ? memberById.get(a.winnerUserId) : undefined;
    if (!winner) continue;

    const partner = a.winnerUserIdB
      ? memberById.get(a.winnerUserIdB) ?? null
      : null;

    cards.push({ kind: "user", award: a, winner, partner });
  }

  // Splice the personal-neighbour synthetic card if the viewer has an entry
  // and both ends resolve against the member roster.
  const { personalNeighbours, viewerUserId } = options;
  if (personalNeighbours && viewerUserId) {
    const entry = personalNeighbours.find((p) => p.userId === viewerUserId);
    if (entry) {
      const viewer = memberById.get(entry.userId);
      const neighbour = memberById.get(entry.neighbourUserId);
      if (viewer && neighbour) {
        cards.push({
          kind: "personal-neighbour",
          award: syntheticPersonalNeighbourAward(
            viewer,
            neighbour,
            entry.pearson,
          ),
          viewerUser: viewer,
          neighbourUser: neighbour,
          pearson: entry.pearson,
          isReciprocal: entry.isReciprocal,
        });
      }
    }
  }

  cards.sort((a, b) => {
    const aCat = a.award.awardKey.startsWith("best_");
    const bCat = b.award.awardKey.startsWith("best_");
    if (aCat && !bCat) return -1;
    if (!aCat && bCat) return 1;
    if (aCat && bCat) {
      const ai = categoryOrder.get(a.award.awardKey) ?? 99;
      const bi = categoryOrder.get(b.award.awardKey) ?? 99;
      return ai - bi;
    }
    const ai = rankFor(a.award.awardKey);
    const bi = rankFor(b.award.awardKey);
    return ai - bi;
  });

  return cards;
}

function rankFor(awardKey: string): number {
  if (awardKey === "your_neighbour") return PERSONAL_NEIGHBOUR_RANK;
  return PERSONALITY_RANK.get(awardKey) ?? 99;
}
```

- [ ] **Step 4.4: Run the tests — expect pass**

Run: `npx vitest run src/lib/awards/awardCeremonySequence.test.ts`
Expected: PASS for all existing cases + the 5 new ones.

- [ ] **Step 4.5: Run `tsc --noEmit`**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 4.6: Commit**

```bash
git add src/lib/awards/awardCeremonySequence.ts src/lib/awards/awardCeremonySequence.test.ts
git commit -m "$(cat <<'EOF'
feat(awards): splice your_neighbour synthetic card after neighbourhood_voters

awardCeremonySequence accepts optional personalNeighbours + viewerUserId
and inserts a 'personal-neighbour' kind CeremonyCard for the viewer
right after the room-wide neighbourhood_voters card. Members without
an entry skip the slot silently; strangers (viewerUserId === null) see
no card.

Spec: docs/superpowers/specs/2026-05-11-your-neighbour-personalized-award-design.md §6
EOF
)"
```

---

## Task 5: Extend `awardExplainers` registry

Add `your_neighbour` resolution to `explainerForAward()`.

**Files:**
- Modify: `src/lib/awards/awardExplainers.ts`
- Modify: `src/lib/awards/awardExplainers.test.ts` (if it exists; otherwise create one for this task)

- [ ] **Step 5.1: Check whether a test file exists**

Run: `ls src/lib/awards/awardExplainers.test.ts 2>/dev/null || echo "no test file"`

If the file doesn't exist, create it with the case below. If it exists, append.

- [ ] **Step 5.2: Add a failing test for `your_neighbour`**

Either create `src/lib/awards/awardExplainers.test.ts` or append to it:

```ts
import { describe, it, expect } from "vitest";
import { explainerForAward } from "./awardExplainers";

describe("explainerForAward", () => {
  it("returns the personality explainer for known keys", () => {
    expect(explainerForAward("biggest_stan")).toMatch(/Highest average/);
  });

  it("returns null for category awards", () => {
    expect(explainerForAward("best_vocals")).toBeNull();
  });

  it("returns null for unknown keys", () => {
    expect(explainerForAward("not_a_real_award")).toBeNull();
  });

  it("returns the your_neighbour explainer", () => {
    expect(explainerForAward("your_neighbour")).toMatch(
      /your votes lined up most closely/,
    );
  });
});
```

- [ ] **Step 5.3: Run — expect the your_neighbour case to fail**

Run: `npx vitest run src/lib/awards/awardExplainers.test.ts`
Expected: FAIL only on the `your_neighbour` case.

- [ ] **Step 5.4: Extend `explainerForAward`**

In `src/lib/awards/awardExplainers.ts`, add a constant and a guard:

```ts
import { PERSONALITY_AWARD_KEYS, type PersonalityAwardKey } from "./awardKeys";

export const PERSONALITY_AWARD_EXPLAINERS: Record<PersonalityAwardKey, string> = {
  // ... existing entries unchanged ...
};

/**
 * SPEC §11.2 V1.1 your_neighbour — explainer text used by both the
 * cinematic reveal card and the static results-page card. Not part of
 * PERSONALITY_AWARD_KEYS because the award isn't persisted in
 * `room_awards` (read-side compute only), but it reuses the same
 * explainer machinery.
 */
export const YOUR_NEIGHBOUR_EXPLAINER =
  "Of everyone in the room, this person's votes lined up most closely with yours.";

const PERSONALITY_KEY_SET = new Set<string>(PERSONALITY_AWARD_KEYS);

export function explainerForAward(awardKey: string): string | null {
  if (awardKey === "your_neighbour") return YOUR_NEIGHBOUR_EXPLAINER;
  if (!PERSONALITY_KEY_SET.has(awardKey)) return null;
  return PERSONALITY_AWARD_EXPLAINERS[awardKey as PersonalityAwardKey];
}
```

- [ ] **Step 5.5: Run — expect pass**

Run: `npx vitest run src/lib/awards/awardExplainers.test.ts`
Expected: PASS for all four cases.

- [ ] **Step 5.6: Commit**

```bash
git add src/lib/awards/awardExplainers.ts src/lib/awards/awardExplainers.test.ts
git commit -m "$(cat <<'EOF'
feat(awards): explainer registry resolves your_neighbour

Adds YOUR_NEIGHBOUR_EXPLAINER + explainerForAward('your_neighbour')
support. Reused by both the cinematic <AwardCeremonyCard> branch and
the static <YourNeighbourCard>.
EOF
)"
```

---

## Task 6: Locale keys for `your_neighbour`

Add the new keys to `en.json`. `locales.test.ts` already enforces parity automatically via `flattenKeys` — non-`en` bundles either remain empty (skip-empty rule per Phase L) or get the new keys; we leave non-`en` alone.

**Files:**
- Modify: `src/locales/en.json`

- [ ] **Step 6.1: Add `awards.your_neighbour.*` and update related sub-trees**

In `src/locales/en.json`, locate the `"awards"` block (around line 405). Make three changes:

(1) Add a top-level `your_neighbour` group inside `awards`:

```json
"your_neighbour": {
  "name": "Your closest neighbour",
  "caption": "voted most like you",
  "reciprocalBadge": "you picked each other"
},
```

Place it alphabetically before `endOfShow` for readability.

(2) Inside `awards.explainers`, add:

```json
"your_neighbour": "Of everyone in the room, this person's votes lined up most closely with yours."
```

(3) Inside `awards.personality`, add an entry for completeness so any downstream `awards.personality.<key>.name`/`.stat` consumers find it:

```json
"your_neighbour": { "name": "Your closest neighbour", "stat": "Pearson {value}" }
```

- [ ] **Step 6.2: Confirm `locales.test.ts` still passes**

Run: `npx vitest run src/locales/locales.test.ts`
Expected: PASS. Non-`en` bundles remain empty per the skip-empty rule (`it.todo`); they don't need the new keys until Phase L L3.

- [ ] **Step 6.3: Run `tsc --noEmit`**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 6.4: Commit**

```bash
git add src/locales/en.json
git commit -m "$(cat <<'EOF'
feat(locale): en keys for awards.your_neighbour.{name,caption,reciprocalBadge}

Plus the matching awards.explainers.your_neighbour string and an
awards.personality.your_neighbour entry for consistency with the
existing personality sub-tree. Non-en locales follow the Phase L
skip-empty rule until L3.
EOF
)"
```

---

## Task 7: `<AwardCeremonyCard>` "personal-neighbour" branch

Render the cinematic card variant.

**Files:**
- Modify: `src/components/awards/AwardCeremonyCard.tsx`
- Modify: `src/components/awards/AwardCeremonyCard.test.tsx`

- [ ] **Step 7.1: Add failing RTL tests**

Append to `src/components/awards/AwardCeremonyCard.test.tsx`:

```ts
import type { CeremonyCard } from "@/lib/awards/awardCeremonySequence";

const VIEWER = { userId: "u3", displayName: "Carol", avatarSeed: "carol-seed" };
const NEIGHBOUR = { userId: "u1", displayName: "Alice", avatarSeed: "alice-seed" };

function mkPersonalNeighbourCard(
  overrides: Partial<{ pearson: number; isReciprocal: boolean }> = {},
): CeremonyCard {
  return {
    kind: "personal-neighbour",
    award: {
      roomId: "",
      awardKey: "your_neighbour",
      awardName: "Your closest neighbour",
      winnerUserId: VIEWER.userId,
      winnerUserIdB: NEIGHBOUR.userId,
      winnerContestantId: null,
      statValue: overrides.pearson ?? 0.84,
      statLabel: `Pearson ${(overrides.pearson ?? 0.84).toFixed(2)}`,
    },
    viewerUser: VIEWER,
    neighbourUser: NEIGHBOUR,
    pearson: overrides.pearson ?? 0.84,
    isReciprocal: overrides.isReciprocal ?? false,
  };
}

describe("AwardCeremonyCard — personal-neighbour", () => {
  it("renders the award name + neighbour name + 'You & {name}' line", () => {
    render(<AwardCeremonyCard card={mkPersonalNeighbourCard()} />);
    expect(screen.getByText("Your closest neighbour")).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    // The locale mock returns the key verbatim — the caption is the locale key.
    expect(screen.getByText(/awards\.your_neighbour\.caption/)).toBeInTheDocument();
  });

  it("shows the reciprocity badge when isReciprocal=true", () => {
    render(
      <AwardCeremonyCard
        card={mkPersonalNeighbourCard({ isReciprocal: true })}
      />,
    );
    expect(
      screen.getByText(/awards\.your_neighbour\.reciprocalBadge/),
    ).toBeInTheDocument();
  });

  it("hides the reciprocity badge when isReciprocal=false", () => {
    render(
      <AwardCeremonyCard
        card={mkPersonalNeighbourCard({ isReciprocal: false })}
      />,
    );
    expect(
      screen.queryByText(/awards\.your_neighbour\.reciprocalBadge/),
    ).not.toBeInTheDocument();
  });

  it("renders the Pearson stat line via the synthetic award.statLabel", () => {
    render(
      <AwardCeremonyCard card={mkPersonalNeighbourCard({ pearson: 0.84 })} />,
    );
    expect(screen.getByText("Pearson 0.84")).toBeInTheDocument();
  });

  it("renders the explainer paragraph", () => {
    render(<AwardCeremonyCard card={mkPersonalNeighbourCard()} />);
    expect(
      screen.getByText(/your votes lined up most closely/),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 7.2: Run — expect failure**

Run: `npx vitest run src/components/awards/AwardCeremonyCard.test.tsx`
Expected: FAIL — `CeremonyCard` lacks the `personal-neighbour` discriminant (already added in Task 4 — so this only fails if the component itself doesn't handle the kind).

- [ ] **Step 7.3: Add the branch to `<AwardCeremonyCard>`**

In `src/components/awards/AwardCeremonyCard.tsx`, add a third branch BEFORE the existing `card.kind === "contestant"` check (since the new branch is more specific):

```tsx
"use client";

import { useTranslations } from "next-intl";
import Avatar from "@/components/ui/Avatar";
import type { CeremonyCard } from "@/lib/awards/awardCeremonySequence";
import { explainerForAward } from "@/lib/awards/awardExplainers";

interface AwardCeremonyCardProps {
  card: CeremonyCard;
}

export default function AwardCeremonyCard({ card }: AwardCeremonyCardProps) {
  const t = useTranslations();
  const explainer = explainerForAward(card.award.awardKey);

  if (card.kind === "personal-neighbour") {
    return (
      <div className="flex flex-col items-center text-center gap-4 motion-safe:animate-fade-in">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {card.award.awardName}
        </p>
        <div className="flex -space-x-3">
          <Avatar
            seed={card.viewerUser.avatarSeed}
            size={88}
            className="ring-4 ring-background"
          />
          <Avatar
            seed={card.neighbourUser.avatarSeed}
            size={88}
            className="ring-4 ring-background"
          />
        </div>
        <p className="text-2xl font-bold">
          You &amp; {card.neighbourUser.displayName}
        </p>
        <p className="text-sm text-muted-foreground italic">
          {t("awards.your_neighbour.caption")}
        </p>
        {card.isReciprocal ? (
          <p className="inline-flex items-center rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
            {t("awards.your_neighbour.reciprocalBadge")}
          </p>
        ) : null}
        {explainer ? (
          <p className="max-w-prose text-sm text-muted-foreground leading-relaxed">
            {explainer}
          </p>
        ) : null}
        {card.award.statLabel ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            {card.award.statLabel}
          </p>
        ) : null}
      </div>
    );
  }

  if (card.kind === "contestant") {
    // ... existing block unchanged
  }

  // ... existing default (user) block unchanged
}
```

Keep the existing two branches exactly as they are; only insert the new one at the top.

- [ ] **Step 7.4: Run — expect pass**

Run: `npx vitest run src/components/awards/AwardCeremonyCard.test.tsx`
Expected: PASS for all existing cases + the 5 new ones.

- [ ] **Step 7.5: Run `tsc --noEmit`**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 7.6: Commit**

```bash
git add src/components/awards/AwardCeremonyCard.tsx src/components/awards/AwardCeremonyCard.test.tsx
git commit -m "$(cat <<'EOF'
feat(awards): AwardCeremonyCard renders personal-neighbour branch

Dual-avatar (viewer + neighbour), 'You & {name}' line, locale caption,
conditional reciprocity badge, registry explainer, Pearson stat. Reuses
the same fade-in animation and layout primitives as the existing
contestant + user branches.
EOF
)"
```

---

## Task 8: Plumb session into `<DoneCeremony>` and forward to the sequence builder

`<DoneCeremony>` is the cinematic-reveal root on `/room/[id]`. It needs the viewer's session userId and the new `personalNeighbours` array; both feed `awardCeremonySequence`.

**Files:**
- Modify: `src/components/room/DoneCeremony.tsx`
- Modify: `src/components/room/DoneCeremony.test.tsx` (if it covers the sequence-build path; otherwise leave existing tests alone — they assert higher-level orchestration)

- [ ] **Step 8.1: Inspect `DoneFixture` and the existing sequence build**

Re-read `src/components/room/DoneCeremony.tsx` around lines 19–28 (the `DoneFixture` interface) and lines 66–74 (the `useMemo` that calls `awardCeremonySequence`).

- [ ] **Step 8.2: Widen `DoneFixture` and the sequence build**

Modify `src/components/room/DoneCeremony.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import LeaderboardCeremony from "@/components/instant/LeaderboardCeremony";
import AwardsCeremony from "@/components/awards/AwardsCeremony";
import EndOfShowCtas from "@/components/awards/EndOfShowCtas";
import { awardCeremonySequence } from "@/lib/awards/awardCeremonySequence";
import { formatRoomSummary } from "@/lib/results/formatRoomSummary";
import { getSession } from "@/lib/session";
import type { PersonalNeighbour } from "@/lib/awards/buildPersonalNeighbours";
import type { Contestant, EventType, RoomAward } from "@/types";
import type { LeaderboardEntry } from "@/lib/results/formatRoomSummary";

interface DoneCeremonyProps {
  roomId: string;
  isAdmin: boolean;
  categories: Array<{ name: string; weight: number; key?: string }>;
}

interface DoneFixture {
  status: "done";
  year: number;
  event: EventType;
  pin: string;
  contestants: Contestant[];
  leaderboard: LeaderboardEntry[];
  awards: RoomAward[];
  members: Array<{ userId: string; displayName: string; avatarSeed: string }>;
  /** SPEC §11.2 your_neighbour — per-viewer entries, possibly []. */
  personalNeighbours?: PersonalNeighbour[];
}

type Phase = "leaderboard" | "awards" | "ctas";

export default function DoneCeremony({
  roomId,
  isAdmin,
  categories,
}: DoneCeremonyProps) {
  const t = useTranslations();
  const [data, setData] = useState<DoneFixture | null>(null);
  const [phase, setPhase] = useState<Phase>("leaderboard");
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);

  useEffect(() => {
    setViewerUserId(getSession()?.userId ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/results/${encodeURIComponent(roomId)}`);
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        if (body.status === "done") setData(body as DoneFixture);
      } catch {
        /* render falls through to leaderboard's own loading shimmer */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const sequence = useMemo(() => {
    if (!data) return [];
    return awardCeremonySequence(
      data.awards,
      data.contestants,
      data.members,
      categories,
      {
        personalNeighbours: data.personalNeighbours ?? [],
        viewerUserId,
      },
    );
  }, [data, categories, viewerUserId]);

  // ... rest of the function unchanged (shareUrl / textSummary / phase render)
}
```

Leave the rest of the function (`shareUrl`, `textSummary`, the phase render switch) untouched.

- [ ] **Step 8.3: Run all `<DoneCeremony>` tests**

Run: `npx vitest run src/components/room/DoneCeremony.test.tsx`
Expected: PASS. Existing tests don't assert anything about the personal-neighbour slot, so widening the fixture type is non-breaking.

- [ ] **Step 8.4: Run `tsc --noEmit`**

Run: `npm run type-check`
Expected: PASS. The component now reads from the fixture's optional `personalNeighbours` field; the field flows from `loadResults` (Task 3) → `/api/results/{id}` → `<DoneCeremony>` automatically.

- [ ] **Step 8.5: Commit**

```bash
git add src/components/room/DoneCeremony.tsx
git commit -m "$(cat <<'EOF'
feat(room): plumb viewer session + personalNeighbours into reveal sequence

DoneCeremony reads getSession()?.userId on mount and forwards it plus
the new personalNeighbours field from /api/results/{id} into
awardCeremonySequence. The synthetic card lands between
neighbourhood_voters and the_dark_horse in the viewer's reveal; members
without an entry skip the slot silently.
EOF
)"
```

---

## Task 9: `<YourNeighbourCard>` static results component

Client component rendered inside `<AwardsSection>` on `/results/[id]`. Reads `getSession()`; renders nothing for non-members or members without an entry.

**Files:**
- Create: `src/components/results/YourNeighbourCard.tsx`
- Create: `src/components/results/YourNeighbourCard.test.tsx`

- [ ] **Step 9.1: Write the failing RTL tests**

Create `src/components/results/YourNeighbourCard.test.tsx`:

```tsx
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
}));

import YourNeighbourCard from "./YourNeighbourCard";
import type { PersonalNeighbour } from "@/lib/awards/buildPersonalNeighbours";

const MEMBERS = [
  { userId: "u1", displayName: "Alice", avatarSeed: "alice-seed" },
  { userId: "u2", displayName: "Bob", avatarSeed: "bob-seed" },
  { userId: "u3", displayName: "Carol", avatarSeed: "carol-seed" },
];

function mkPN(
  userId: string,
  neighbourUserId: string,
  pearson = 0.84,
  isReciprocal = false,
): PersonalNeighbour {
  return { userId, neighbourUserId, pearson, isReciprocal };
}

describe("YourNeighbourCard", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
  });

  it("renders nothing when there is no session", () => {
    mockGetSession.mockReturnValue(null);
    const { container } = render(
      <YourNeighbourCard
        members={MEMBERS}
        personalNeighbours={[mkPN("u3", "u1")]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the session userId has no entry in personalNeighbours", () => {
    mockGetSession.mockReturnValue({
      userId: "stranger-id",
      expiresAt: "2099-01-01",
    });
    const { container } = render(
      <YourNeighbourCard
        members={MEMBERS}
        personalNeighbours={[mkPN("u3", "u1")]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when personalNeighbours is empty", () => {
    mockGetSession.mockReturnValue({ userId: "u3", expiresAt: "2099-01-01" });
    const { container } = render(
      <YourNeighbourCard members={MEMBERS} personalNeighbours={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the viewer's neighbour with name, caption, and Pearson stat", () => {
    mockGetSession.mockReturnValue({ userId: "u3", expiresAt: "2099-01-01" });
    render(
      <YourNeighbourCard
        members={MEMBERS}
        personalNeighbours={[mkPN("u3", "u1", 0.84, false)]}
      />,
    );
    expect(
      screen.getByText("awards.your_neighbour.name"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText("Pearson 0.84")).toBeInTheDocument();
    expect(
      screen.getByText("awards.your_neighbour.caption"),
    ).toBeInTheDocument();
  });

  it("renders the reciprocity badge when isReciprocal=true", () => {
    mockGetSession.mockReturnValue({ userId: "u3", expiresAt: "2099-01-01" });
    render(
      <YourNeighbourCard
        members={MEMBERS}
        personalNeighbours={[mkPN("u3", "u1", 0.84, true)]}
      />,
    );
    expect(
      screen.getByText("awards.your_neighbour.reciprocalBadge"),
    ).toBeInTheDocument();
  });

  it("hides the reciprocity badge when isReciprocal=false", () => {
    mockGetSession.mockReturnValue({ userId: "u3", expiresAt: "2099-01-01" });
    render(
      <YourNeighbourCard
        members={MEMBERS}
        personalNeighbours={[mkPN("u3", "u1", 0.84, false)]}
      />,
    );
    expect(
      screen.queryByText("awards.your_neighbour.reciprocalBadge"),
    ).not.toBeInTheDocument();
  });

  it("renders nothing when the neighbour can't be resolved against members (defensive)", () => {
    mockGetSession.mockReturnValue({ userId: "u3", expiresAt: "2099-01-01" });
    const { container } = render(
      <YourNeighbourCard
        members={[MEMBERS[0]] /* missing u3 + u1's match */}
        personalNeighbours={[mkPN("u3", "missing-user")]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("includes the explainer text", () => {
    mockGetSession.mockReturnValue({ userId: "u3", expiresAt: "2099-01-01" });
    render(
      <YourNeighbourCard
        members={MEMBERS}
        personalNeighbours={[mkPN("u3", "u1")]}
      />,
    );
    expect(
      screen.getByText(/your votes lined up most closely/),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 9.2: Run — expect failure**

Run: `npx vitest run src/components/results/YourNeighbourCard.test.tsx`
Expected: FAIL with `Cannot find module './YourNeighbourCard'`.

- [ ] **Step 9.3: Implement `<YourNeighbourCard>`**

Create `src/components/results/YourNeighbourCard.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Avatar from "@/components/ui/Avatar";
import { getSession } from "@/lib/session";
import { explainerForAward } from "@/lib/awards/awardExplainers";
import type { PersonalNeighbour } from "@/lib/awards/buildPersonalNeighbours";

interface MemberView {
  userId: string;
  displayName: string;
  avatarSeed: string;
}

interface YourNeighbourCardProps {
  members: MemberView[];
  personalNeighbours: PersonalNeighbour[];
}

/**
 * SPEC §11.2 V1.1 your_neighbour — per-viewer card on the static
 * `/results/[id]` page. Rendered as an `<li>` inside `<AwardsSection>`
 * directly after the room-wide `neighbourhood_voters` card.
 *
 * Visibility gate (client-side, since `getSession` is localStorage-only):
 * the card renders only when the viewer's session userId matches an
 * entry in `personalNeighbours` AND both that entry's viewer + neighbour
 * resolve against the `members` roster. Strangers and zero-signal
 * members see nothing.
 */
export default function YourNeighbourCard({
  members,
  personalNeighbours,
}: YourNeighbourCardProps) {
  const t = useTranslations();
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);

  useEffect(() => {
    setViewerUserId(getSession()?.userId ?? null);
  }, []);

  if (!viewerUserId) return null;

  const entry = personalNeighbours.find((p) => p.userId === viewerUserId);
  if (!entry) return null;

  const memberById = new Map(members.map((m) => [m.userId, m]));
  const viewer = memberById.get(entry.userId);
  const neighbour = memberById.get(entry.neighbourUserId);
  if (!viewer || !neighbour) return null;

  const explainer = explainerForAward("your_neighbour");
  const statLabel = `Pearson ${entry.pearson.toFixed(2)}`;

  return (
    <div className="rounded-xl border-2 border-border bg-card px-4 py-3 space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          <Avatar
            seed={viewer.avatarSeed}
            size={36}
            className="ring-2 ring-card"
          />
          <Avatar
            seed={neighbour.avatarSeed}
            size={36}
            className="ring-2 ring-card"
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">
            {t("awards.your_neighbour.name")}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {neighbour.displayName} · {t("awards.your_neighbour.caption")} ·{" "}
            {statLabel}
          </p>
        </div>
      </div>
      {entry.isReciprocal ? (
        <p className="inline-flex items-center rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-accent">
          {t("awards.your_neighbour.reciprocalBadge")}
        </p>
      ) : null}
      {explainer ? (
        <details className="group">
          <summary
            className="text-xs text-muted-foreground hover:text-foreground cursor-pointer list-none flex items-center gap-1 select-none"
            data-testid="award-explainer-toggle"
          >
            <span aria-hidden>ⓘ</span>
            <span>{t("awards.explainerToggle")}</span>
          </summary>
          <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
            {explainer}
          </p>
        </details>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 9.4: Run — expect pass**

Run: `npx vitest run src/components/results/YourNeighbourCard.test.tsx`
Expected: PASS for all 8 cases.

- [ ] **Step 9.5: Run `tsc --noEmit`**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 9.6: Commit**

```bash
git add src/components/results/YourNeighbourCard.tsx src/components/results/YourNeighbourCard.test.tsx
git commit -m "$(cat <<'EOF'
feat(results): YourNeighbourCard client component for /results/[id]

Client-only card that reads getSession() and renders the viewer's own
nearest neighbour with avatar, caption, Pearson stat, conditional
reciprocity badge, and the standard explainer accordion. Hidden for
strangers and members without an entry.

Spec: docs/superpowers/specs/2026-05-11-your-neighbour-personalized-award-design.md §7
EOF
)"
```

---

## Task 10: Slot `<YourNeighbourCard>` into `<AwardsSection>`

The card needs to render right after the `neighbourhood_voters` row in the personality list.

**Files:**
- Modify: `src/components/results/AwardsSection.tsx`
- Modify: `src/components/results/AwardsSection.test.tsx`

- [ ] **Step 10.1: Add a failing test**

Append to `src/components/results/AwardsSection.test.tsx` (or create with the standard jsdom/next-intl mock if it doesn't exist):

```tsx
import type { PersonalNeighbour } from "@/lib/awards/buildPersonalNeighbours";

it("renders YourNeighbourCard immediately after neighbourhood_voters when personalNeighbours is provided", () => {
  // Note: <YourNeighbourCard> renders nothing without a matching session;
  // since this test runs without a mocked session, we assert ordering by
  // testid presence on the wrapper <li> instead.
  const members = [
    { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
    { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
  ];
  const personalNeighbours: PersonalNeighbour[] = [
    { userId: "u1", neighbourUserId: "u2", pearson: 0.9, isReciprocal: true },
  ];
  render(
    <AwardsSection
      awards={[
        {
          roomId: "r",
          awardKey: "neighbourhood_voters",
          awardName: "Neighbourhood voters",
          winnerUserId: "u1",
          winnerUserIdB: "u2",
          winnerContestantId: null,
          statValue: null,
          statLabel: null,
        },
        {
          roomId: "r",
          awardKey: "the_dark_horse",
          awardName: "The dark horse",
          winnerUserId: null,
          winnerUserIdB: null,
          winnerContestantId: "2026-SE",
          statValue: null,
          statLabel: null,
        },
      ]}
      contestants={[
        {
          id: "2026-SE",
          year: 2026,
          event: "final",
          countryCode: "SE",
          country: "Sweden",
          artist: "A",
          song: "S",
          flagEmoji: "🇸🇪",
          runningOrder: 1,
        },
      ]}
      members={members}
      personalNeighbours={personalNeighbours}
      labels={{
        sectionHeading: "Awards",
        categoryHeading: "Best in category",
        personalityHeading: "And the room said…",
        jointCaption: "joint winners",
        neighbourhoodCaption: "voted most alike",
      }}
    />,
  );
  // The slot wrapper <li data-testid="your-neighbour-slot"> sits right
  // after the neighbourhood_voters card.
  const slot = screen.getByTestId("your-neighbour-slot");
  const items = Array.from(
    slot.parentElement?.querySelectorAll(":scope > li") ?? [],
  );
  const idxOfPair = items.findIndex(
    (li) => li.textContent?.includes("Neighbourhood voters") ?? false,
  );
  const idxOfSlot = items.indexOf(slot);
  expect(idxOfSlot).toBe(idxOfPair + 1);
});

it("does not render the slot when personalNeighbours is undefined", () => {
  render(
    <AwardsSection
      awards={[
        {
          roomId: "r",
          awardKey: "neighbourhood_voters",
          awardName: "Neighbourhood voters",
          winnerUserId: "u1",
          winnerUserIdB: "u2",
          winnerContestantId: null,
          statValue: null,
          statLabel: null,
        },
      ]}
      contestants={[]}
      members={[
        { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
        { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
      ]}
      // personalNeighbours intentionally omitted
      labels={{
        sectionHeading: "Awards",
        categoryHeading: "Best in category",
        personalityHeading: "And the room said…",
        jointCaption: "joint winners",
        neighbourhoodCaption: "voted most alike",
      }}
    />,
  );
  expect(screen.queryByTestId("your-neighbour-slot")).not.toBeInTheDocument();
});
```

If `AwardsSection.test.tsx` doesn't exist, create it with the standard pragma + mock at the top:

```tsx
// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import AwardsSection from "./AwardsSection";
import type { PersonalNeighbour } from "@/lib/awards/buildPersonalNeighbours";

describe("AwardsSection", () => {
  // append the test cases above here
});
```

- [ ] **Step 10.2: Run — expect failure**

Run: `npx vitest run src/components/results/AwardsSection.test.tsx`
Expected: FAIL — `personalNeighbours` prop doesn't exist, slot not rendered.

- [ ] **Step 10.3: Add the prop + slot**

Modify `src/components/results/AwardsSection.tsx`:

```tsx
import Avatar from "@/components/ui/Avatar";
import type { Contestant, RoomAward } from "@/types";
import type { PersonalNeighbour } from "@/lib/awards/buildPersonalNeighbours";
import { explainerForAward } from "@/lib/awards/awardExplainers";
import YourNeighbourCard from "./YourNeighbourCard";

interface MemberView {
  userId: string;
  displayName: string;
  avatarSeed: string;
}

interface AwardsSectionProps {
  awards: RoomAward[];
  contestants: Contestant[];
  members: MemberView[];
  /** SPEC §11.2 V1.1 your_neighbour — per-viewer pairings. Omit on pre-V1.1 fixtures. */
  personalNeighbours?: PersonalNeighbour[];
  labels: {
    sectionHeading: string;
    categoryHeading: string;
    personalityHeading: string;
    jointCaption: string;
    neighbourhoodCaption: string;
  };
}

export default function AwardsSection({
  awards,
  contestants,
  members,
  personalNeighbours,
  labels,
}: AwardsSectionProps) {
  if (awards.length === 0) return null;

  const contestantById = new Map(contestants.map((c) => [c.id, c]));
  const memberById = new Map(members.map((m) => [m.userId, m]));

  const category = awards.filter((a) => a.awardKey.startsWith("best_"));
  const personality = awards.filter((a) => !a.awardKey.startsWith("best_"));

  return (
    <section className="space-y-6">
      <h2 className="text-xl font-semibold">{labels.sectionHeading}</h2>

      {category.length > 0 ? (
        // ... existing category block unchanged
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {labels.categoryHeading}
          </h3>
          <ul className="space-y-2">
            {category.map((a) => (
              <li key={a.awardKey}>
                <ContestantAwardCard
                  award={a}
                  contestant={
                    a.winnerContestantId
                      ? contestantById.get(a.winnerContestantId)
                      : undefined
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {personality.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {labels.personalityHeading}
          </h3>
          <ul className="space-y-2">
            {personality.map((a) => {
              const node = renderPersonalityRow({
                award: a,
                contestantById,
                memberById,
                neighbourhoodCaption: labels.neighbourhoodCaption,
                jointCaption: labels.jointCaption,
              });
              const showYourNeighbour =
                a.awardKey === "neighbourhood_voters" &&
                personalNeighbours !== undefined;
              return (
                <>
                  <li key={a.awardKey}>{node}</li>
                  {showYourNeighbour ? (
                    <li
                      key={`${a.awardKey}-your-neighbour-slot`}
                      data-testid="your-neighbour-slot"
                    >
                      <YourNeighbourCard
                        members={members}
                        personalNeighbours={personalNeighbours!}
                      />
                    </li>
                  ) : null}
                </>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// renderPersonalityRow is a small helper that returns the existing
// <ContestantAwardCard> or <UserAwardCard> based on award shape — extracted
// from the old inline ternary so the map's return value is single-rooted.
function renderPersonalityRow({
  award,
  contestantById,
  memberById,
  neighbourhoodCaption,
  jointCaption,
}: {
  award: RoomAward;
  contestantById: Map<string, Contestant>;
  memberById: Map<string, MemberView>;
  neighbourhoodCaption: string;
  jointCaption: string;
}) {
  if (award.winnerContestantId) {
    return (
      <ContestantAwardCard
        award={award}
        contestant={contestantById.get(award.winnerContestantId)}
      />
    );
  }
  const winner = award.winnerUserId
    ? memberById.get(award.winnerUserId)
    : undefined;
  const partner = award.winnerUserIdB
    ? memberById.get(award.winnerUserIdB)
    : undefined;
  return (
    <UserAwardCard
      award={award}
      winner={winner}
      partner={partner}
      captionForKey={
        award.awardKey === "neighbourhood_voters"
          ? neighbourhoodCaption
          : partner
            ? jointCaption
            : null
      }
    />
  );
}

// ... existing ContestantAwardCard, UserAwardCard, AwardExplainer
// definitions stay exactly as they are below this point.
```

React's `<>` fragment inside `.map` needs an outer `key` — use `<React.Fragment key={a.awardKey + '-row'}>` instead:

```tsx
import { Fragment } from "react";
// ...
{personality.map((a) => {
  // ... compute node + showYourNeighbour
  return (
    <Fragment key={a.awardKey}>
      <li>{node}</li>
      {showYourNeighbour ? (
        <li data-testid="your-neighbour-slot">
          <YourNeighbourCard
            members={members}
            personalNeighbours={personalNeighbours!}
          />
        </li>
      ) : null}
    </Fragment>
  );
})}
```

- [ ] **Step 10.4: Run — expect pass**

Run: `npx vitest run src/components/results/AwardsSection.test.tsx`
Expected: PASS for both new cases. Existing `AwardsSection.test.tsx` cases (if any) still pass — the prop is optional.

- [ ] **Step 10.5: Run `tsc --noEmit`**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 10.6: Commit**

```bash
git add src/components/results/AwardsSection.tsx src/components/results/AwardsSection.test.tsx
git commit -m "$(cat <<'EOF'
feat(results): slot YourNeighbourCard into AwardsSection personality list

AwardsSection accepts optional personalNeighbours; when provided, an
extra <li data-testid='your-neighbour-slot'> renders <YourNeighbourCard>
directly after the neighbourhood_voters row. The card itself owns the
session-aware visibility gate, so the slot is harmless when the viewer
isn't a room member.

Spec: docs/superpowers/specs/2026-05-11-your-neighbour-personalized-award-design.md §7
EOF
)"
```

---

## Task 11: Wire `personalNeighbours` through the `/results/[id]` page

Final glue — the server-rendered page passes the new field from `loadResults` into `<AwardsSection>`.

**Files:**
- Modify: `src/app/results/[id]/page.tsx`

- [ ] **Step 11.1: Add the prop pass-through**

In `src/app/results/[id]/page.tsx`, in the `DoneBody` function (around lines 247–260), update the `<AwardsSection>` invocation to pass `personalNeighbours`:

```tsx
{data.awards.length > 0 ? (
  <AwardsSection
    awards={data.awards}
    contestants={data.contestants}
    members={data.members}
    personalNeighbours={data.personalNeighbours}
    labels={{
      sectionHeading: t("headings.awards"),
      categoryHeading: t("headings.categoryAwards"),
      personalityHeading: t("headings.personalityAwards"),
      jointCaption: tAwards("jointCaption"),
      neighbourhoodCaption: tAwards("neighbourhoodCaption"),
    }}
  />
) : null}
```

`data.personalNeighbours` already exists on the `done` arm of `ResultsData` (added in Task 3). The TypeScript narrowing on `data: Extract<ResultsData, { status: "done" }>` makes this safe.

- [ ] **Step 11.2: Run `tsc --noEmit`**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 11.3: Run the full test suite for regression**

Run: `npm test`
Expected: PASS for everything (no test asserts on the page-level wiring directly; this step is a regression check).

- [ ] **Step 11.4: Commit**

```bash
git add src/app/results/[id]/page.tsx
git commit -m "$(cat <<'EOF'
feat(results): pass personalNeighbours into AwardsSection on results page

Final wire-up. AwardsSection now receives the per-viewer pairings from
loadResults; the client-side YourNeighbourCard renders the matching
entry. Strangers opening the share link see no your_neighbour card.

Spec: docs/superpowers/specs/2026-05-11-your-neighbour-personalized-award-design.md §7
EOF
)"
```

---

## Task 12: End-to-end manual verification

Pure-function tests + RTL cover the unit and integration layers. This step is the verification-before-completion handshake: spin up the app, exercise the new card in real Chrome.

**Files:** none (manual smoke).

- [ ] **Step 12.1: Run the full test suite + type-check**

Run: `npm test && npm run type-check`
Expected: PASS for both.

- [ ] **Step 12.2: Start the dev server**

Run: `npm run dev`
Expected: listening on http://localhost:3000.

- [ ] **Step 12.3: Seed a 3-user `done` room**

Run: `npm run seed:room -- done-with-awards`
Expected: a fixture room with 3 users in `status='done'` and awards populated. PIN printed on stdout.

- [ ] **Step 12.4: Open the static results page**

In a private/incognito window (no session), navigate to `http://localhost:3000/results/<roomId>`.
Expected: leaderboard renders, awards section renders, `neighbourhood_voters` card visible, `your_neighbour` card **NOT** visible (stranger has no session).

- [ ] **Step 12.5: Open the static results page as a member**

In a normal window, complete the room's onboarding (the seed script's first user has a known PIN; use it via `/join`). Then navigate to `/results/<roomId>`.
Expected: same page renders + the new `your_neighbour` card appears immediately after `neighbourhood_voters`. The card shows the viewer's avatar + their nearest neighbour's avatar + Pearson stat. If the seed fixture has mutual top-1 between u1 and u2, the reciprocity badge appears.

- [ ] **Step 12.6: Open the cinematic reveal as a member**

Navigate to `/room/<roomId>` with the same session. The room is in `status='done'`, so the cinematic flow runs automatically: leaderboard ceremony → awards ceremony.
Expected: after the `neighbourhood_voters` card, the next "Next award" tap reveals the `your_neighbour` card with two avatars + "You & {neighbour}" + Pearson stat. Tap again continues to `the_dark_horse`.

- [ ] **Step 12.7: Open the cinematic reveal as a different member**

Switch sessions (clear localStorage, complete onboarding as a different member, navigate back). Re-enter the room.
Expected: the cinematic reveal shows a *different* neighbour on the `your_neighbour` card — proves the personalization is wired through.

- [ ] **Step 12.8: Sanity-check the public share link from a fresh device/profile**

Open `/results/<roomId>` from a profile with no session at all.
Expected: page renders, `neighbourhood_voters` still appears, `your_neighbour` is absent.

- [ ] **Step 12.9: Update TODO.md**

Add a single line under Phase V2 (or wherever V1.1+ feature ticks live in the user's TODO.md) marking the slice complete:

```markdown
- [x] **`your_neighbour` personalized award (V1.1).** _(landed on `feat/your-neighbour-award` — `buildUserVectors` extracted; `buildPersonalNeighbours` pure compute + 8 unit tests; `loadResults` `done` payload extended; `awardCeremonySequence` splices a `personal-neighbour` synthetic card after `neighbourhood_voters`; `<AwardCeremonyCard>` third branch; new `<YourNeighbourCard>` client component on `/results/[id]` with session-aware visibility; locale keys + explainer registry. Spec: `docs/superpowers/specs/2026-05-11-your-neighbour-personalized-award-design.md`.)_
```

- [ ] **Step 12.10: Final commit**

```bash
git add TODO.md
git commit -m "$(cat <<'EOF'
docs(todo): tick your_neighbour personalized award (V1.1)
EOF
)"
```

---

## Spec coverage check

| Spec section | Implemented in |
|---|---|
| §2 Naming | Task 4 (`syntheticPersonalNeighbourAward`), Task 6 (locale keys) |
| §3 Reveal-sequence position | Task 4 (`PERSONAL_NEIGHBOUR_RANK = NEIGHBOURHOOD_RANK + 0.5`) |
| §4.1 `buildUserVectors` extraction | Task 1 |
| §4.2 `buildPersonalNeighbours` algorithm | Task 2 |
| §4.3 Wiring (read-side, no `room_awards` write) | Task 3 (`loadDone` call site) |
| §5.1 Payload shape | Task 3.3 |
| §5.2 Endpoints + no new auth | Task 3 (both routes share `loadResults`) |
| §6.1 `awardCeremonySequence` extension | Task 4 |
| §6.2 `<AwardCeremonyCard>` new branch | Task 7 |
| §6.3 Reveal driver wiring (viewerUserId) | Task 8 |
| §7 `<YourNeighbourCard>` static surface | Task 9 + Task 10 + Task 11 |
| §8 Locale keys | Task 6 |
| §9.1 `buildPersonalNeighbours` unit tests | Task 2.1 |
| §9.2 `loadResults` integration tests | Task 3.1 |
| §9.3 Sequence splice tests | Task 4.1 |
| §9.4 `<AwardCeremonyCard>` RTL | Task 7.1 |
| §9.5 `<YourNeighbourCard>` RTL | Task 9.1 |
| §10 Out-of-scope (exports, persistence, server-filter, public list, realtime, contestant variant) | Not implemented — explicit non-goals from the spec |
| §11 Rollout (no schema, no endpoint, no flag, reversible) | Confirmed in Tasks 1–11; no schema/RLS/realtime changes |
| §12 SPEC.md edits | Out of scope for this plan — SPEC edits are a separate commit per the user's "SPEC is contract-grade" policy in CLAUDE.md §5. Suggest a follow-up `docs(spec)` commit covering §11.0 / §11.2 / §11.3 / §12.5 / §17a.5 once the implementation lands. |
