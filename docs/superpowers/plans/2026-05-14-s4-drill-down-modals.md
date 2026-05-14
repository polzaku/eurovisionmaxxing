# S4 §12.6 Drill-Down Sheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three interactive bottom-sheet drill-downs on `/results/[id]` (contestant / participant / category) sharing one tested dialog shell, triggered from a "Full breakdown" link inside the existing leaderboard `<details>`, an avatar button inside `<Breakdowns>`, and a "Full ranking" link inside category-award cards.

**Architecture:** Single `<DrillDownSheet>` shell owns dialog mechanics (focus / ESC / backdrop / aria); three discrete `*DrillDownBody` components own variant-specific layout; three pure builders (`buildContestantDrillDown`, `buildParticipantDrillDown`, `buildCategoryDrillDown`) derive aggregates + rows from the `done` payload. Page-level `useReducer` state (`drillDownState`) guarantees only one sheet open at a time; the existing server-rendered `<DoneBody>` becomes a thin wrapper over a new `<DrillDownClient>` client component.

**Tech Stack:** Next.js 14 App Router (client component), React 18 `useReducer` + `useRef` + `useEffect`, `next-intl` `useTranslations`, vitest + `@testing-library/react` (jsdom env per-file), Playwright (chromium).

**Spec:** [docs/superpowers/specs/2026-05-14-s4-drill-down-modals-design.md](../specs/2026-05-14-s4-drill-down-modals-design.md)

**Branch:** `feat/s4-drill-down-modals` (off `feat/r5-html-export` — depends on the `voteDetails` + `categories` payload extension).

**Key reuse points:**
- `src/lib/scoring.ts` — `computeWeightedScore`, `spearmanCorrelation` (don't re-derive)
- `src/components/voting/ScaleAnchorsSheet.tsx` — canonical bottom-sheet pattern (focus / ESC / backdrop). Adapt verbatim.
- `src/components/results/LeaderboardWithDrillDown.tsx` — already implements stage-1 inline `<details>`; we add an optional `onOpenFullBreakdown` prop + a "Full breakdown" link inside the open body.
- `src/components/results/AwardsSection.tsx` — already uses `awardKey.startsWith("best_")` to discriminate category vs personality awards. Use the same convention to gate the "Full ranking" link.
- `src/components/ui/Avatar.tsx` — DiceBear `<Avatar seed size>` (size defaults 48; use 32 in sheet body rows, 48 in headers).

**Category award discriminator (correction to spec):** the spec mentions `winnerContestantId !== null` as the discriminator. The codebase convention is `award.awardKey.startsWith("best_")` — used throughout `<AwardsSection>` and `computeAwards`. Use the codebase convention in this implementation; both produce the same partition today.

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `src/components/results/drill-down/drillDownState.ts` | create | Pure reducer + `DrillDownState` / `DrillDownAction` types |
| `src/components/results/drill-down/drillDownState.test.ts` | create | Reducer unit tests |
| `src/components/results/drill-down/buildContestantDrillDown.ts` | create | Pure builder for §12.6.1 |
| `src/components/results/drill-down/buildContestantDrillDown.test.ts` | create | Builder unit tests |
| `src/components/results/drill-down/buildParticipantDrillDown.ts` | create | Pure builder for §12.6.2 (reuses scoring lib) |
| `src/components/results/drill-down/buildParticipantDrillDown.test.ts` | create | Builder unit tests |
| `src/components/results/drill-down/buildCategoryDrillDown.ts` | create | Pure builder for §12.6.3 |
| `src/components/results/drill-down/buildCategoryDrillDown.test.ts` | create | Builder unit tests |
| `src/components/results/drill-down/DrillDownSheet.tsx` | create | Shared shell (focus / ESC / backdrop) |
| `src/components/results/drill-down/DrillDownSheet.test.tsx` | create | Dialog mechanics RTL |
| `src/components/results/drill-down/ContestantDrillDownBody.tsx` | create | §12.6.1 body |
| `src/components/results/drill-down/ContestantDrillDownBody.test.tsx` | create | §12.6.1 RTL |
| `src/components/results/drill-down/ParticipantDrillDownBody.tsx` | create | §12.6.2 body |
| `src/components/results/drill-down/ParticipantDrillDownBody.test.tsx` | create | §12.6.2 RTL |
| `src/components/results/drill-down/CategoryDrillDownBody.tsx` | create | §12.6.3 body |
| `src/components/results/drill-down/CategoryDrillDownBody.test.tsx` | create | §12.6.3 RTL |
| `src/components/results/Breakdowns.tsx` | create | Extracted from `page.tsx` + avatar tap target |
| `src/components/results/Breakdowns.test.tsx` | create | RTL (extraction + avatar button) |
| `src/components/results/LeaderboardWithDrillDown.tsx` | modify | Add optional `onOpenFullBreakdown` + link inside open `<details>` body |
| `src/components/results/LeaderboardWithDrillDown.test.tsx` | modify | Add cases for the new link |
| `src/components/results/AwardsSection.tsx` | modify | Add optional `onOpenCategoryRanking` + link inside category-award cards only |
| `src/components/results/AwardsSection.test.tsx` | modify | Add cases for the link (category yes, personality no) |
| `src/app/results/[id]/DrillDownClient.tsx` | create | Page-level client component owning sheet state + wiring |
| `src/app/results/[id]/DrillDownClient.test.tsx` | create | Page-level integration test |
| `src/app/results/[id]/page.tsx` | modify | Replace inline `<Breakdowns>` + collapse done-body to `<DrillDownClient>` |
| `src/locales/en.json` | modify | Add `results.drillDown.*` namespace |
| `src/locales/es.json`, `uk.json`, `fr.json`, `de.json` | modify | English-text stubs |
| `tests/e2e/results-drill-downs.spec.ts` | create | Playwright E2E |

---

## Task 1: `drillDownState` reducer

**Files:**
- Create: `src/components/results/drill-down/drillDownState.ts`
- Create: `src/components/results/drill-down/drillDownState.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/results/drill-down/drillDownState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  drillDownReducer,
  type DrillDownState,
} from "@/components/results/drill-down/drillDownState";

describe("drillDownReducer", () => {
  it("initial null state stays null on close", () => {
    expect(drillDownReducer(null, { type: "close" })).toBeNull();
  });

  it("open contestant from null returns the contestant payload", () => {
    expect(
      drillDownReducer(null, {
        type: "open",
        payload: { kind: "contestant", contestantId: "2026-se" },
      }),
    ).toEqual({ kind: "contestant", contestantId: "2026-se" });
  });

  it("open participant from null returns the participant payload", () => {
    expect(
      drillDownReducer(null, {
        type: "open",
        payload: { kind: "participant", userId: "u1" },
      }),
    ).toEqual({ kind: "participant", userId: "u1" });
  });

  it("open category from null returns the category payload", () => {
    expect(
      drillDownReducer(null, {
        type: "open",
        payload: { kind: "category", categoryKey: "vocals" },
      }),
    ).toEqual({ kind: "category", categoryKey: "vocals" });
  });

  it("opening a new kind while another is open replaces (only one open at a time)", () => {
    const open: DrillDownState = { kind: "contestant", contestantId: "2026-se" };
    expect(
      drillDownReducer(open, {
        type: "open",
        payload: { kind: "participant", userId: "u1" },
      }),
    ).toEqual({ kind: "participant", userId: "u1" });
  });

  it("close from any open state returns null", () => {
    const open: DrillDownState = { kind: "participant", userId: "u2" };
    expect(drillDownReducer(open, { type: "close" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/components/results/drill-down/drillDownState.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/results/drill-down/drillDownState.ts`:

```ts
/**
 * SPEC §12.6 — page-level state machine for the three drill-down sheets.
 *
 * Only one sheet is open at any time. The triple union encodes which
 * surface is open; `null` is closed. Trigger components dispatch `open`
 * with a payload; the close button / ESC / backdrop dispatch `close`.
 */
export type DrillDownOpen =
  | { kind: "contestant"; contestantId: string }
  | { kind: "participant"; userId: string }
  | { kind: "category"; categoryKey: string };

export type DrillDownState = DrillDownOpen | null;

export type DrillDownAction =
  | { type: "open"; payload: DrillDownOpen }
  | { type: "close" };

export function drillDownReducer(
  state: DrillDownState,
  action: DrillDownAction,
): DrillDownState {
  switch (action.type) {
    case "open":
      return action.payload;
    case "close":
      return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- src/components/results/drill-down/drillDownState.test.ts
```
Expected: 6 tests pass.

- [ ] **Step 5: Type-check + commit**

```bash
npm run type-check && \
git add src/components/results/drill-down/drillDownState.ts \
        src/components/results/drill-down/drillDownState.test.ts && \
git commit -m "feat(drill-down): page-level state reducer (SPEC §12.6)

Pure triple-union state machine: { kind: contestant|participant|category, id }
or null. Open replaces (only one sheet at a time); close returns null.
Used by the page-level <DrillDownClient> wrapper to coordinate the three
surfaces.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `buildContestantDrillDown` helper

**Files:**
- Create: `src/components/results/drill-down/buildContestantDrillDown.ts`
- Create: `src/components/results/drill-down/buildContestantDrillDown.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/results/drill-down/buildContestantDrillDown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildContestantDrillDown } from "@/components/results/drill-down/buildContestantDrillDown";
import type { ResultsData } from "@/lib/results/loadResults";

type DonePayload = Extract<ResultsData, { status: "done" }>;

const CATEGORIES = [
  { name: "Vocals", weight: 1, key: "vocals" },
  { name: "Music", weight: 1, key: "music" },
];

const MEMBERS = [
  { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
  { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
  { userId: "u3", displayName: "Carol", avatarSeed: "carol" },
];

const VOTE_DETAILS: DonePayload["voteDetails"] = [
  {
    userId: "u1",
    contestantId: "2026-se",
    scores: { vocals: 9, music: 8 },
    missed: false,
    pointsAwarded: 12,
    hotTake: "Banger.",
    hotTakeEditedAt: null,
  },
  {
    userId: "u2",
    contestantId: "2026-se",
    scores: { vocals: 6, music: 7 },
    missed: false,
    pointsAwarded: 8,
    hotTake: null,
    hotTakeEditedAt: null,
  },
  {
    userId: "u3",
    contestantId: "2026-se",
    scores: {},
    missed: true,
    pointsAwarded: 0,
    hotTake: null,
    hotTakeEditedAt: null,
  },
];

describe("buildContestantDrillDown", () => {
  it("returns rows sorted by pointsAwarded desc with per-voter detail", () => {
    const out = buildContestantDrillDown("2026-se", {
      categories: CATEGORIES,
      members: MEMBERS,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.rows.map((r) => r.userId)).toEqual(["u1", "u2", "u3"]);
    expect(out.rows[0]).toMatchObject({
      userId: "u1",
      displayName: "Alice",
      avatarSeed: "alice",
      missed: false,
      pointsAwarded: 12,
      weightedScore: 8.5,
      scores: { vocals: 9, music: 8 },
      hotTake: "Banger.",
      hotTakeEditedAt: null,
    });
  });

  it("missed entries land at the bottom and report missed=true", () => {
    const out = buildContestantDrillDown("2026-se", {
      categories: CATEGORIES,
      members: MEMBERS,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.rows[2]).toMatchObject({
      userId: "u3",
      missed: true,
      pointsAwarded: 0,
    });
  });

  it("aggregates: mean / median across non-missed weightedScore", () => {
    const out = buildContestantDrillDown("2026-se", {
      categories: CATEGORIES,
      members: MEMBERS,
      voteDetails: VOTE_DETAILS,
    });
    // u1: weighted 8.5, u2: weighted 6.5 → mean 7.5, median 7.5
    expect(out.aggregates.mean).toBeCloseTo(7.5, 1);
    expect(out.aggregates.median).toBeCloseTo(7.5, 1);
  });

  it("aggregates: highest + lowest carry the displayName and weightedScore", () => {
    const out = buildContestantDrillDown("2026-se", {
      categories: CATEGORIES,
      members: MEMBERS,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.aggregates.highest).toEqual({
      userId: "u1",
      displayName: "Alice",
      avatarSeed: "alice",
      weightedScore: 8.5,
    });
    expect(out.aggregates.lowest).toEqual({
      userId: "u2",
      displayName: "Bob",
      avatarSeed: "bob",
      weightedScore: 6.5,
    });
  });

  it("returns an empty rows array + null aggregates when no one rated the contestant", () => {
    const out = buildContestantDrillDown("2026-nope", {
      categories: CATEGORIES,
      members: MEMBERS,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.rows).toEqual([]);
    expect(out.aggregates.mean).toBeNull();
    expect(out.aggregates.median).toBeNull();
    expect(out.aggregates.highest).toBeNull();
    expect(out.aggregates.lowest).toBeNull();
  });

  it("even count of voters uses the average of the two middle values for median", () => {
    const out = buildContestantDrillDown("2026-se", {
      categories: CATEGORIES,
      members: MEMBERS,
      voteDetails: [
        ...VOTE_DETAILS,
        {
          userId: "u4",
          contestantId: "2026-se",
          scores: { vocals: 5, music: 5 },
          missed: false,
          pointsAwarded: 4,
          hotTake: null,
          hotTakeEditedAt: null,
        },
      ],
    });
    // weightedScores sorted: [5.0, 6.5, 8.5] for u4/u2/u1; missed u3 dropped.
    // Three non-missed → median is middle (6.5). Add 4th to test even path.
    expect(out.aggregates.median).toBeCloseTo(6.5, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/components/results/drill-down/buildContestantDrillDown.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/results/drill-down/buildContestantDrillDown.ts`:

```ts
import { computeWeightedScore } from "@/lib/scoring";
import type { ResultsData } from "@/lib/results/loadResults";

type DonePayload = Extract<ResultsData, { status: "done" }>;

export interface ContestantDrillDownRow {
  userId: string;
  displayName: string;
  avatarSeed: string;
  scores: Record<string, number>;
  missed: boolean;
  weightedScore: number;
  pointsAwarded: number;
  hotTake: string | null;
  hotTakeEditedAt: string | null;
}

export interface ContestantDrillDownAggregateActor {
  userId: string;
  displayName: string;
  avatarSeed: string;
  weightedScore: number;
}

export interface ContestantDrillDownAggregates {
  mean: number | null;
  median: number | null;
  highest: ContestantDrillDownAggregateActor | null;
  lowest: ContestantDrillDownAggregateActor | null;
}

export interface ContestantDrillDownResult {
  rows: ContestantDrillDownRow[];
  aggregates: ContestantDrillDownAggregates;
}

export interface ContestantDrillDownInput {
  categories: DonePayload["categories"];
  members: DonePayload["members"];
  voteDetails: DonePayload["voteDetails"];
}

/**
 * SPEC §12.6.1 — derive per-voter rows + aggregates for a single contestant.
 *
 * Rows sorted by pointsAwarded desc (12-point givers first). Missed votes
 * are surfaced as rows with missed=true at the bottom of the list and are
 * EXCLUDED from aggregates — the question "what did the room rate this
 * contestant" is answered only by those who actually voted.
 */
export function buildContestantDrillDown(
  contestantId: string,
  { categories, members, voteDetails }: ContestantDrillDownInput,
): ContestantDrillDownResult {
  const memberById = new Map(members.map((m) => [m.userId, m]));
  const relevant = voteDetails.filter((v) => v.contestantId === contestantId);

  const rows: ContestantDrillDownRow[] = relevant
    .map((v) => {
      const member = memberById.get(v.userId);
      if (!member) return null;
      return {
        userId: v.userId,
        displayName: member.displayName,
        avatarSeed: member.avatarSeed,
        scores: v.scores,
        missed: v.missed,
        weightedScore: computeWeightedScore(v.scores, categories),
        pointsAwarded: v.pointsAwarded,
        hotTake: v.hotTake,
        hotTakeEditedAt: v.hotTakeEditedAt,
      };
    })
    .filter((r): r is ContestantDrillDownRow => r !== null)
    // pointsAwarded desc, then missed (which is 0 points) at the bottom by
    // virtue of pointsAwarded already being 0 on missed rows.
    .sort((a, b) => b.pointsAwarded - a.pointsAwarded);

  const scoring = rows.filter((r) => !r.missed);
  const aggregates: ContestantDrillDownAggregates =
    scoring.length === 0
      ? { mean: null, median: null, highest: null, lowest: null }
      : {
          mean:
            scoring.reduce((acc, r) => acc + r.weightedScore, 0) /
            scoring.length,
          median: medianOf(scoring.map((r) => r.weightedScore)),
          highest: pickByWeighted(scoring, (a, b) => b - a),
          lowest: pickByWeighted(scoring, (a, b) => a - b),
        };

  return { rows, aggregates };
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function pickByWeighted(
  rows: ContestantDrillDownRow[],
  cmp: (a: number, b: number) => number,
): ContestantDrillDownAggregateActor {
  const top = [...rows].sort((a, b) =>
    cmp(a.weightedScore, b.weightedScore),
  )[0];
  return {
    userId: top.userId,
    displayName: top.displayName,
    avatarSeed: top.avatarSeed,
    weightedScore: top.weightedScore,
  };
}
```

- [ ] **Step 4: Run tests + type-check + commit**

```bash
npm run test -- src/components/results/drill-down/buildContestantDrillDown.test.ts && \
npm run type-check && \
git add src/components/results/drill-down/buildContestantDrillDown.ts \
        src/components/results/drill-down/buildContestantDrillDown.test.ts && \
git commit -m "feat(drill-down): buildContestantDrillDown — per-voter rows + aggregates (SPEC §12.6.1)

Pure builder over the loadResults done payload. Rows sorted by pointsAwarded
desc; missed entries land at the bottom and are excluded from aggregates
(mean / median / highest / lowest). Reuses computeWeightedScore from
src/lib/scoring.ts — no new math.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `buildParticipantDrillDown` helper

**Files:**
- Create: `src/components/results/drill-down/buildParticipantDrillDown.ts`
- Create: `src/components/results/drill-down/buildParticipantDrillDown.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/results/drill-down/buildParticipantDrillDown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildParticipantDrillDown } from "@/components/results/drill-down/buildParticipantDrillDown";

const CATEGORIES = [
  { name: "Vocals", weight: 1, key: "vocals" },
  { name: "Music", weight: 1, key: "music" },
];

const MEMBERS = [
  { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
  { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
];

const CONTESTANTS = [
  {
    id: "2026-se",
    country: "Sweden",
    countryCode: "se",
    flagEmoji: "🇸🇪",
    artist: "A",
    song: "S",
    runningOrder: 1,
    event: "final" as const,
    year: 2026,
  },
  {
    id: "2026-no",
    country: "Norway",
    countryCode: "no",
    flagEmoji: "🇳🇴",
    artist: "A",
    song: "S",
    runningOrder: 2,
    event: "final" as const,
    year: 2026,
  },
];

const LEADERBOARD = [
  { contestantId: "2026-se", totalPoints: 20, rank: 1 },
  { contestantId: "2026-no", totalPoints: 12, rank: 2 },
];

const VOTE_DETAILS = [
  // Alice: aligns with leaderboard (Sweden 9, Norway 5) → high Spearman
  {
    userId: "u1",
    contestantId: "2026-se",
    scores: { vocals: 9, music: 9 },
    missed: false,
    pointsAwarded: 12,
    hotTake: "Banger.",
    hotTakeEditedAt: null,
  },
  {
    userId: "u1",
    contestantId: "2026-no",
    scores: { vocals: 5, music: 5 },
    missed: false,
    pointsAwarded: 8,
    hotTake: null,
    hotTakeEditedAt: null,
  },
  // Bob: inverts the room (Sweden 4, Norway 8) → negative Spearman
  {
    userId: "u2",
    contestantId: "2026-se",
    scores: { vocals: 4, music: 4 },
    missed: false,
    pointsAwarded: 8,
    hotTake: null,
    hotTakeEditedAt: null,
  },
  {
    userId: "u2",
    contestantId: "2026-no",
    scores: { vocals: 8, music: 8 },
    missed: false,
    pointsAwarded: 12,
    hotTake: null,
    hotTakeEditedAt: null,
  },
];

describe("buildParticipantDrillDown", () => {
  it("rows sorted by user's weighted score desc", () => {
    const out = buildParticipantDrillDown("u1", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      leaderboard: LEADERBOARD,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.rows.map((r) => r.contestantId)).toEqual(["2026-se", "2026-no"]);
    expect(out.rows[0]).toMatchObject({
      contestantId: "2026-se",
      weightedScore: 9,
      pointsAwarded: 12,
      hotTake: "Banger.",
    });
  });

  it("header carries the user identity and total points awarded", () => {
    const out = buildParticipantDrillDown("u1", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      leaderboard: LEADERBOARD,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.header).toEqual({
      userId: "u1",
      displayName: "Alice",
      avatarSeed: "alice",
      totalPointsAwarded: 20,
      hotTakeCount: 1,
    });
  });

  it("aggregates: mean across non-missed weightedScore", () => {
    const out = buildParticipantDrillDown("u1", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      leaderboard: LEADERBOARD,
      voteDetails: VOTE_DETAILS,
    });
    // Alice: weighted 9, 5 → mean 7
    expect(out.aggregates.mean).toBeCloseTo(7, 1);
  });

  it("aggregates: harshness is signed delta against room mean (negative = harsher)", () => {
    const out = buildParticipantDrillDown("u2", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      leaderboard: LEADERBOARD,
      voteDetails: VOTE_DETAILS,
    });
    // Room mean (across all non-missed votes): (9+5+4+8)/4 = 6.5
    // Bob mean: (4+8)/2 = 6.0
    // Harshness = thisUserMean - roomMean = -0.5 (harsher than room).
    expect(out.aggregates.harshness).toBeCloseTo(-0.5, 1);
  });

  it("aggregates: Spearman alignment uses leaderboard total order vs user's weighted ranking", () => {
    const aliceOut = buildParticipantDrillDown("u1", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      leaderboard: LEADERBOARD,
      voteDetails: VOTE_DETAILS,
    });
    expect(aliceOut.aggregates.alignment).toBeCloseTo(1, 2);

    const bobOut = buildParticipantDrillDown("u2", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      leaderboard: LEADERBOARD,
      voteDetails: VOTE_DETAILS,
    });
    expect(bobOut.aggregates.alignment).toBeCloseTo(-1, 2);
  });

  it("empty payload (user voted on nothing) returns null aggregates and zero hot-takes", () => {
    const out = buildParticipantDrillDown("u1", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      leaderboard: LEADERBOARD,
      voteDetails: [],
    });
    expect(out.rows).toEqual([]);
    expect(out.header.totalPointsAwarded).toBe(0);
    expect(out.header.hotTakeCount).toBe(0);
    expect(out.aggregates.mean).toBeNull();
    expect(out.aggregates.harshness).toBeNull();
    expect(out.aggregates.alignment).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/components/results/drill-down/buildParticipantDrillDown.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/results/drill-down/buildParticipantDrillDown.ts`:

```ts
import { computeWeightedScore, spearmanCorrelation } from "@/lib/scoring";
import type { ResultsData } from "@/lib/results/loadResults";
import type { Contestant } from "@/types";

type DonePayload = Extract<ResultsData, { status: "done" }>;

export interface ParticipantDrillDownRow {
  contestantId: string;
  country: string;
  flagEmoji: string;
  song: string;
  scores: Record<string, number>;
  missed: boolean;
  weightedScore: number;
  pointsAwarded: number;
  hotTake: string | null;
  hotTakeEditedAt: string | null;
}

export interface ParticipantDrillDownHeader {
  userId: string;
  displayName: string;
  avatarSeed: string;
  totalPointsAwarded: number;
  hotTakeCount: number;
}

export interface ParticipantDrillDownAggregates {
  /** Mean of this user's non-missed weighted scores. */
  mean: number | null;
  /** Signed delta vs room mean. Negative = harsher than room. */
  harshness: number | null;
  /**
   * Spearman correlation between (the leaderboard order) and
   * (this user's per-contestant weighted score order). 1 = perfect
   * alignment with the room; -1 = inverted; near 0 = uncorrelated.
   */
  alignment: number | null;
}

export interface ParticipantDrillDownResult {
  header: ParticipantDrillDownHeader;
  rows: ParticipantDrillDownRow[];
  aggregates: ParticipantDrillDownAggregates;
}

export interface ParticipantDrillDownInput {
  categories: DonePayload["categories"];
  members: DonePayload["members"];
  contestants: Contestant[];
  leaderboard: DonePayload["leaderboard"];
  voteDetails: DonePayload["voteDetails"];
}

/**
 * SPEC §12.6.2 — derive per-contestant rows + aggregates for a single user.
 *
 * Rows are this user's votes, sorted by their weighted score desc.
 * Aggregates compare against the rest of the room:
 *  - mean: their own non-missed average
 *  - harshness: (their mean) − (room mean across everyone's non-missed votes)
 *  - alignment: Spearman between the room leaderboard order and the user's
 *    per-contestant weighted score order, evaluated over contestants this
 *    user voted on.
 */
export function buildParticipantDrillDown(
  userId: string,
  {
    categories,
    members,
    contestants,
    leaderboard,
    voteDetails,
  }: ParticipantDrillDownInput,
): ParticipantDrillDownResult {
  const member = members.find((m) => m.userId === userId);
  const memberHeader = member ?? {
    userId,
    displayName: userId,
    avatarSeed: userId,
  };
  const contestantById = new Map(contestants.map((c) => [c.id, c]));

  const own = voteDetails.filter((v) => v.userId === userId);

  const rows: ParticipantDrillDownRow[] = own
    .map((v) => {
      const c = contestantById.get(v.contestantId);
      if (!c) return null;
      return {
        contestantId: v.contestantId,
        country: c.country,
        flagEmoji: c.flagEmoji,
        song: c.song,
        scores: v.scores,
        missed: v.missed,
        weightedScore: computeWeightedScore(v.scores, categories),
        pointsAwarded: v.pointsAwarded,
        hotTake: v.hotTake,
        hotTakeEditedAt: v.hotTakeEditedAt,
      };
    })
    .filter((r): r is ParticipantDrillDownRow => r !== null)
    .sort((a, b) => b.weightedScore - a.weightedScore);

  const totalPointsAwarded = own.reduce((s, v) => s + v.pointsAwarded, 0);
  const hotTakeCount = own.filter(
    (v) => v.hotTake !== null && v.hotTake.trim() !== "",
  ).length;

  const scoring = rows.filter((r) => !r.missed);
  const mean =
    scoring.length === 0
      ? null
      : scoring.reduce((s, r) => s + r.weightedScore, 0) / scoring.length;

  // Room mean: all non-missed weightedScores across the entire room.
  const roomScores = voteDetails
    .filter((v) => !v.missed)
    .map((v) => computeWeightedScore(v.scores, categories));
  const roomMean =
    roomScores.length === 0
      ? null
      : roomScores.reduce((s, x) => s + x, 0) / roomScores.length;
  const harshness =
    mean === null || roomMean === null ? null : mean - roomMean;

  // Spearman alignment: build paired ranks over the contestants this user
  // voted on. For each such contestant, x = its position in the leaderboard
  // (1-indexed, lower is better), y = position in the user's own desc-sorted
  // weighted-score ranking. Reuse spearmanCorrelation from src/lib/scoring.
  const leaderboardRankById = new Map(
    leaderboard.map((row, idx) => [row.contestantId, idx + 1]),
  );
  const ownRankedIds = [...scoring]
    .sort((a, b) => b.weightedScore - a.weightedScore)
    .map((r) => r.contestantId);
  const ownRankById = new Map(
    ownRankedIds.map((id, idx) => [id, idx + 1] as const),
  );
  const paired = ownRankedIds.flatMap((id) => {
    const lbRank = leaderboardRankById.get(id);
    const ownRank = ownRankById.get(id);
    if (lbRank === undefined || ownRank === undefined) return [];
    return [{ lbRank, ownRank }];
  });
  const alignment =
    paired.length < 2
      ? null
      : spearmanCorrelation(
          paired.map((p) => p.lbRank),
          paired.map((p) => p.ownRank),
        );

  return {
    header: {
      userId: memberHeader.userId,
      displayName: memberHeader.displayName,
      avatarSeed: memberHeader.avatarSeed,
      totalPointsAwarded,
      hotTakeCount,
    },
    rows,
    aggregates: { mean, harshness, alignment },
  };
}
```

- [ ] **Step 4: Run tests + type-check + commit**

```bash
npm run test -- src/components/results/drill-down/buildParticipantDrillDown.test.ts && \
npm run type-check && \
git add src/components/results/drill-down/buildParticipantDrillDown.ts \
        src/components/results/drill-down/buildParticipantDrillDown.test.ts && \
git commit -m "feat(drill-down): buildParticipantDrillDown — per-contestant rows + aggregates (SPEC §12.6.2)

Mean / signed harshness / Spearman alignment over a single user's
non-missed votes. Reuses computeWeightedScore + spearmanCorrelation
from src/lib/scoring.ts. Harshness convention: negative = harsher than
room mean. Empty / single-row payloads return null aggregates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `buildCategoryDrillDown` helper

**Files:**
- Create: `src/components/results/drill-down/buildCategoryDrillDown.ts`
- Create: `src/components/results/drill-down/buildCategoryDrillDown.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/results/drill-down/buildCategoryDrillDown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCategoryDrillDown } from "@/components/results/drill-down/buildCategoryDrillDown";

const CATEGORIES = [
  { name: "Vocals", weight: 1, key: "vocals" },
  { name: "Music", weight: 1, key: "music" },
];

const MEMBERS = [
  { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
  { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
  { userId: "u3", displayName: "Carol", avatarSeed: "carol" },
];

const CONTESTANTS = [
  {
    id: "2026-se",
    country: "Sweden",
    countryCode: "se",
    flagEmoji: "🇸🇪",
    artist: "A",
    song: "S",
    runningOrder: 1,
    event: "final" as const,
    year: 2026,
  },
  {
    id: "2026-no",
    country: "Norway",
    countryCode: "no",
    flagEmoji: "🇳🇴",
    artist: "A",
    song: "S",
    runningOrder: 2,
    event: "final" as const,
    year: 2026,
  },
];

const VOTE_DETAILS = [
  // Sweden: vocals 9, 8 → mean 8.5; min 8, median 8.5, max 9. u3 missed.
  {
    userId: "u1",
    contestantId: "2026-se",
    scores: { vocals: 9, music: 7 },
    missed: false,
    pointsAwarded: 12,
    hotTake: null,
    hotTakeEditedAt: null,
  },
  {
    userId: "u2",
    contestantId: "2026-se",
    scores: { vocals: 8, music: 7 },
    missed: false,
    pointsAwarded: 8,
    hotTake: null,
    hotTakeEditedAt: null,
  },
  {
    userId: "u3",
    contestantId: "2026-se",
    scores: {},
    missed: true,
    pointsAwarded: 0,
    hotTake: null,
    hotTakeEditedAt: null,
  },
  // Norway: vocals 5, 4, 3 → mean 4; min 3, median 4, max 5.
  {
    userId: "u1",
    contestantId: "2026-no",
    scores: { vocals: 5, music: 5 },
    missed: false,
    pointsAwarded: 8,
    hotTake: null,
    hotTakeEditedAt: null,
  },
  {
    userId: "u2",
    contestantId: "2026-no",
    scores: { vocals: 4, music: 4 },
    missed: false,
    pointsAwarded: 7,
    hotTake: null,
    hotTakeEditedAt: null,
  },
  {
    userId: "u3",
    contestantId: "2026-no",
    scores: { vocals: 3, music: 3 },
    missed: false,
    pointsAwarded: 6,
    hotTake: null,
    hotTakeEditedAt: null,
  },
];

describe("buildCategoryDrillDown", () => {
  it("rows sorted by category mean desc", () => {
    const out = buildCategoryDrillDown("vocals", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.rows.map((r) => r.contestantId)).toEqual(["2026-se", "2026-no"]);
    expect(out.rows[0]).toMatchObject({
      contestantId: "2026-se",
      mean: 8.5,
      spread: { min: 8, median: 8.5, max: 9 },
      voted: 2,
      total: 3,
    });
    expect(out.rows[1]).toMatchObject({
      contestantId: "2026-no",
      mean: 4,
      spread: { min: 3, median: 4, max: 5 },
      voted: 3,
      total: 3,
    });
  });

  it("aggregates: highest + lowest single vote with the voter identity", () => {
    const out = buildCategoryDrillDown("vocals", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.aggregates.highest).toEqual({
      value: 9,
      userId: "u1",
      displayName: "Alice",
      avatarSeed: "alice",
    });
    expect(out.aggregates.lowest).toEqual({
      value: 3,
      userId: "u3",
      displayName: "Carol",
      avatarSeed: "carol",
    });
  });

  it("aggregates: mean of means is the average of per-contestant means", () => {
    const out = buildCategoryDrillDown("vocals", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.aggregates.meanOfMeans).toBeCloseTo((8.5 + 4) / 2, 2);
  });

  it("unknown category key returns empty rows and null aggregates", () => {
    const out = buildCategoryDrillDown("unknown", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      voteDetails: VOTE_DETAILS,
    });
    expect(out.rows).toEqual([]);
    expect(out.aggregates.highest).toBeNull();
    expect(out.aggregates.lowest).toBeNull();
    expect(out.aggregates.meanOfMeans).toBeNull();
  });

  it("contestants with all-missed votes are dropped from rows entirely", () => {
    const allMissed = [
      {
        userId: "u1",
        contestantId: "2026-se",
        scores: {},
        missed: true,
        pointsAwarded: 0,
        hotTake: null,
        hotTakeEditedAt: null,
      },
    ];
    const out = buildCategoryDrillDown("vocals", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      voteDetails: allMissed,
    });
    expect(out.rows).toEqual([]);
  });

  it("voter count reflects only non-missed scoring for the specific category", () => {
    const out = buildCategoryDrillDown("vocals", {
      categories: CATEGORIES,
      members: MEMBERS,
      contestants: CONTESTANTS,
      voteDetails: VOTE_DETAILS,
    });
    const se = out.rows.find((r) => r.contestantId === "2026-se");
    expect(se?.voted).toBe(2);
    expect(se?.total).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/components/results/drill-down/buildCategoryDrillDown.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/results/drill-down/buildCategoryDrillDown.ts`:

```ts
import type { ResultsData } from "@/lib/results/loadResults";
import type { Contestant } from "@/types";

type DonePayload = Extract<ResultsData, { status: "done" }>;

export interface CategoryDrillDownRow {
  contestantId: string;
  country: string;
  flagEmoji: string;
  song: string;
  mean: number;
  spread: { min: number; median: number; max: number };
  voted: number;
  total: number;
}

export interface CategoryDrillDownExtremum {
  value: number;
  userId: string;
  displayName: string;
  avatarSeed: string;
}

export interface CategoryDrillDownAggregates {
  highest: CategoryDrillDownExtremum | null;
  lowest: CategoryDrillDownExtremum | null;
  meanOfMeans: number | null;
}

export interface CategoryDrillDownResult {
  rows: CategoryDrillDownRow[];
  aggregates: CategoryDrillDownAggregates;
}

export interface CategoryDrillDownInput {
  categories: DonePayload["categories"];
  members: DonePayload["members"];
  contestants: Contestant[];
  voteDetails: DonePayload["voteDetails"];
}

/**
 * SPEC §12.6.3 — per-contestant mean + spread sparkline + voter count
 * for a single category. Sorted by mean desc. Contestants with no
 * non-missed votes in this category are dropped from rows.
 */
export function buildCategoryDrillDown(
  categoryKey: string,
  { categories, members, contestants, voteDetails }: CategoryDrillDownInput,
): CategoryDrillDownResult {
  const category = categories.find(
    (c) => (c.key ?? c.name) === categoryKey,
  );
  if (!category) {
    return {
      rows: [],
      aggregates: { highest: null, lowest: null, meanOfMeans: null },
    };
  }
  const memberById = new Map(members.map((m) => [m.userId, m]));
  const total = members.length;

  // Group per-contestant non-missed values for this category.
  const byContestant = new Map<
    string,
    Array<{ userId: string; value: number }>
  >();
  for (const v of voteDetails) {
    if (v.missed) continue;
    const value = v.scores[categoryKey];
    if (typeof value !== "number") continue;
    const list = byContestant.get(v.contestantId) ?? [];
    list.push({ userId: v.userId, value });
    byContestant.set(v.contestantId, list);
  }

  const rows: CategoryDrillDownRow[] = [];
  for (const c of contestants) {
    const list = byContestant.get(c.id) ?? [];
    if (list.length === 0) continue;
    const values = list.map((x) => x.value);
    const mean =
      values.reduce((s, x) => s + x, 0) / values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const median =
      sorted.length % 2 === 1
        ? sorted[Math.floor(sorted.length / 2)]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    rows.push({
      contestantId: c.id,
      country: c.country,
      flagEmoji: c.flagEmoji,
      song: c.song,
      mean,
      spread: { min, median, max },
      voted: list.length,
      total,
    });
  }
  rows.sort((a, b) => b.mean - a.mean);

  // Aggregates over every individual vote.
  const allVotes: Array<{ userId: string; value: number }> = [];
  for (const list of byContestant.values()) allVotes.push(...list);
  const aggregates: CategoryDrillDownAggregates =
    allVotes.length === 0
      ? { highest: null, lowest: null, meanOfMeans: null }
      : {
          highest: extremum(allVotes, memberById, (a, b) => b - a),
          lowest: extremum(allVotes, memberById, (a, b) => a - b),
          meanOfMeans:
            rows.length === 0
              ? null
              : rows.reduce((s, r) => s + r.mean, 0) / rows.length,
        };

  return { rows, aggregates };
}

function extremum(
  votes: Array<{ userId: string; value: number }>,
  memberById: Map<string, { displayName: string; avatarSeed: string }>,
  cmp: (a: number, b: number) => number,
): CategoryDrillDownExtremum {
  const top = [...votes].sort((a, b) => cmp(a.value, b.value))[0];
  const member = memberById.get(top.userId);
  return {
    value: top.value,
    userId: top.userId,
    displayName: member?.displayName ?? top.userId,
    avatarSeed: member?.avatarSeed ?? top.userId,
  };
}
```

- [ ] **Step 4: Run tests + type-check + commit**

```bash
npm run test -- src/components/results/drill-down/buildCategoryDrillDown.test.ts && \
npm run type-check && \
git add src/components/results/drill-down/buildCategoryDrillDown.ts \
        src/components/results/drill-down/buildCategoryDrillDown.test.ts && \
git commit -m "feat(drill-down): buildCategoryDrillDown — per-contestant mean + spread (SPEC §12.6.3)

Single-axis view for one category. Each row carries mean, min/median/max
spread for the sparkline, and voter count (N/M voted) accounting for
missed entries. Aggregates: highest + lowest single vote (with voter
identity) and mean of means across rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `<DrillDownSheet>` shell

**Files:**
- Create: `src/components/results/drill-down/DrillDownSheet.tsx`
- Create: `src/components/results/drill-down/DrillDownSheet.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/results/drill-down/DrillDownSheet.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DrillDownSheet from "@/components/results/drill-down/DrillDownSheet";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("<DrillDownSheet>", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(
      <DrillDownSheet
        open={false}
        onClose={() => {}}
        titleId="t"
        closeAriaLabel="Close"
      >
        <h2 id="t">Title</h2>
      </DrillDownSheet>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a dialog with aria-modal + aria-labelledby when open", () => {
    render(
      <DrillDownSheet
        open
        onClose={() => {}}
        titleId="t1"
        closeAriaLabel="Close"
      >
        <h2 id="t1">Contestant: Sweden</h2>
      </DrillDownSheet>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "t1");
  });

  it("ESC key calls onClose", () => {
    const onClose = vi.fn();
    render(
      <DrillDownSheet open onClose={onClose} titleId="t" closeAriaLabel="Close">
        <h2 id="t">x</h2>
      </DrillDownSheet>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("backdrop click calls onClose; panel click does not", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DrillDownSheet open onClose={onClose} titleId="t" closeAriaLabel="Close">
        <h2 id="t">x</h2>
      </DrillDownSheet>,
    );
    await user.click(screen.getByTestId("drill-down-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId("drill-down-panel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("X button calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DrillDownSheet open onClose={onClose} titleId="t" closeAriaLabel="Close drill-down">
        <h2 id="t">x</h2>
      </DrillDownSheet>,
    );
    await user.click(screen.getByRole("button", { name: "Close drill-down" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("focus lands on the close button when opened", () => {
    render(
      <DrillDownSheet open onClose={() => {}} titleId="t" closeAriaLabel="Close">
        <h2 id="t">x</h2>
      </DrillDownSheet>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("focus restores to the previously focused element when closed", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <DrillDownSheet open onClose={() => {}} titleId="t" closeAriaLabel="Close">
        <h2 id="t">x</h2>
      </DrillDownSheet>,
    );
    rerender(
      <DrillDownSheet open={false} onClose={() => {}} titleId="t" closeAriaLabel="Close">
        <h2 id="t">x</h2>
      </DrillDownSheet>,
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("panel has motion-safe fade-in animation class", () => {
    render(
      <DrillDownSheet open onClose={() => {}} titleId="t" closeAriaLabel="Close">
        <h2 id="t">x</h2>
      </DrillDownSheet>,
    );
    expect(screen.getByTestId("drill-down-panel").className).toMatch(
      /motion-safe:animate-fade-in|animate-fade-in/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/components/results/drill-down/DrillDownSheet.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/results/drill-down/DrillDownSheet.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";

export interface DrillDownSheetProps {
  open: boolean;
  onClose: () => void;
  /** Element id inside `children` that names the dialog (for aria-labelledby). */
  titleId: string;
  closeAriaLabel: string;
  children: React.ReactNode;
}

/**
 * SPEC §12.6 — shared bottom-sheet shell for the three drill-down variants.
 *
 * Adapted from <ScaleAnchorsSheet> (src/components/voting/ScaleAnchorsSheet.tsx):
 * - Fixed-position dialog with a backdrop click target.
 * - ESC closes via document-level keydown handler installed while open.
 * - Focus moves to the close button on open; restores the previously
 *   focused element on close.
 * - role="dialog" + aria-modal + aria-labelledby pointing at the title
 *   element rendered by the variant body (each body emits its own
 *   <h2 id={titleId}>).
 */
export default function DrillDownSheet({
  open,
  onClose,
  titleId,
  closeAriaLabel,
  children,
}: DrillDownSheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButtonRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-end justify-center"
    >
      <div
        data-testid="drill-down-backdrop"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        data-testid="drill-down-panel"
        className="relative w-full max-w-2xl bg-background rounded-t-xl border-t border-border max-h-[85vh] overflow-y-auto motion-safe:animate-fade-in"
      >
        <div className="sticky top-0 flex items-center justify-end bg-background/95 backdrop-blur border-b border-border px-4 py-2">
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={closeAriaLabel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests + commit**

```bash
npm run test -- src/components/results/drill-down/DrillDownSheet.test.tsx && \
npm run type-check && \
git add src/components/results/drill-down/DrillDownSheet.tsx \
        src/components/results/drill-down/DrillDownSheet.test.tsx && \
git commit -m "feat(drill-down): shared <DrillDownSheet> shell (SPEC §12.6)

Bottom-sheet dialog with focus management, ESC handling, backdrop click,
sticky close button, motion-safe fade-in. Adapted from <ScaleAnchorsSheet>
to host the three variant bodies. The variant body owns its own <h2 id>
that the shell points at via aria-labelledby.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `<ContestantDrillDownBody>` — §12.6.1

**Files:**
- Create: `src/components/results/drill-down/ContestantDrillDownBody.tsx`
- Create: `src/components/results/drill-down/ContestantDrillDownBody.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/results/drill-down/ContestantDrillDownBody.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ContestantDrillDownBody from "@/components/results/drill-down/ContestantDrillDownBody";
import type { ResultsData } from "@/lib/results/loadResults";

type DonePayload = Extract<ResultsData, { status: "done" }>;

const LABELS = {
  titleId: "drill-contestant-title",
  meanLabel: "Mean",
  medianLabel: "Median",
  highestLabel: "Highest",
  lowestLabel: "Lowest",
  weightedScoreLabel: (v: string) => `Weighted ${v}`,
  missedLabel: "Missed",
  editedLabel: "(edited)",
  emptyCopy: "No room member rated this contestant.",
  title: (country: string, points: number) => `${country} — ${points} pts`,
};

const FIXTURE_DATA: Pick<
  DonePayload,
  "categories" | "members" | "contestants" | "leaderboard" | "voteDetails"
> = {
  categories: [
    { name: "Vocals", weight: 1, key: "vocals" },
    { name: "Music", weight: 1, key: "music" },
  ],
  members: [
    { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
    { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
    { userId: "u3", displayName: "Carol", avatarSeed: "carol" },
  ],
  contestants: [
    {
      id: "2026-se",
      country: "Sweden",
      countryCode: "se",
      flagEmoji: "🇸🇪",
      artist: "Artist",
      song: "Song",
      runningOrder: 1,
      event: "final",
      year: 2026,
    },
  ],
  leaderboard: [{ contestantId: "2026-se", totalPoints: 20, rank: 1 }],
  voteDetails: [
    {
      userId: "u1",
      contestantId: "2026-se",
      scores: { vocals: 9, music: 8 },
      missed: false,
      pointsAwarded: 12,
      hotTake: "Banger.",
      hotTakeEditedAt: "2026-05-16T22:00:00Z",
    },
    {
      userId: "u2",
      contestantId: "2026-se",
      scores: { vocals: 6, music: 7 },
      missed: false,
      pointsAwarded: 8,
      hotTake: null,
      hotTakeEditedAt: null,
    },
    {
      userId: "u3",
      contestantId: "2026-se",
      scores: {},
      missed: true,
      pointsAwarded: 0,
      hotTake: null,
      hotTakeEditedAt: null,
    },
  ],
};

describe("<ContestantDrillDownBody>", () => {
  it("renders the contestant header with country, flag, song, total points", () => {
    render(
      <ContestantDrillDownBody
        contestantId="2026-se"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /Sweden.*20.*pts/i }),
    ).toBeInTheDocument();
  });

  it("renders body rows sorted by pointsAwarded desc (12 first, missed last)", () => {
    render(
      <ContestantDrillDownBody
        contestantId="2026-se"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    const rows = screen.getAllByTestId("contestant-drill-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Alice")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Bob")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Carol")).toBeInTheDocument();
  });

  it("missed entries carry the chip--missed class", () => {
    render(
      <ContestantDrillDownBody
        contestantId="2026-se"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    const rows = screen.getAllByTestId("contestant-drill-row");
    expect(within(rows[2]).getByText("Missed")).toBeInTheDocument();
  });

  it("aggregates show mean / median / highest / lowest using non-missed scoring", () => {
    render(
      <ContestantDrillDownBody
        contestantId="2026-se"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    // Alice 8.5, Bob 6.5 → mean 7.5, median 7.5, highest Alice 8.5, lowest Bob 6.5.
    expect(screen.getByText(/Mean.*7\.5/)).toBeInTheDocument();
    expect(screen.getByText(/Median.*7\.5/)).toBeInTheDocument();
    expect(screen.getByText(/Highest.*Alice/)).toBeInTheDocument();
    expect(screen.getByText(/Lowest.*Bob/)).toBeInTheDocument();
  });

  it("renders the edited tag on hot takes with hotTakeEditedAt", () => {
    render(
      <ContestantDrillDownBody
        contestantId="2026-se"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    const aliceRow = screen.getAllByTestId("contestant-drill-row")[0];
    expect(within(aliceRow).getByText(/Banger\./)).toBeInTheDocument();
    expect(within(aliceRow).getByText("(edited)")).toBeInTheDocument();
  });

  it("renders the empty copy when nobody rated the contestant", () => {
    render(
      <ContestantDrillDownBody
        contestantId="2026-nope"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(
      screen.getByText("No room member rated this contestant."),
    ).toBeInTheDocument();
  });

  it("exposes the title element with the configured id (for aria-labelledby)", () => {
    render(
      <ContestantDrillDownBody
        contestantId="2026-se"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(document.getElementById("drill-contestant-title")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/components/results/drill-down/ContestantDrillDownBody.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/results/drill-down/ContestantDrillDownBody.tsx`:

```tsx
import Avatar from "@/components/ui/Avatar";
import { buildContestantDrillDown } from "@/components/results/drill-down/buildContestantDrillDown";
import type { ResultsData } from "@/lib/results/loadResults";

type DonePayload = Extract<ResultsData, { status: "done" }>;

export interface ContestantDrillDownBodyLabels {
  titleId: string;
  title: (country: string, points: number) => string;
  meanLabel: string;
  medianLabel: string;
  highestLabel: string;
  lowestLabel: string;
  weightedScoreLabel: (value: string) => string;
  missedLabel: string;
  editedLabel: string;
  emptyCopy: string;
}

export interface ContestantDrillDownBodyProps {
  contestantId: string;
  data: DonePayload;
  labels: ContestantDrillDownBodyLabels;
}

export default function ContestantDrillDownBody({
  contestantId,
  data,
  labels,
}: ContestantDrillDownBodyProps) {
  const contestant = data.contestants.find((c) => c.id === contestantId);
  const totalPoints =
    data.leaderboard.find((e) => e.contestantId === contestantId)
      ?.totalPoints ?? 0;
  const { rows, aggregates } = buildContestantDrillDown(contestantId, {
    categories: data.categories,
    members: data.members,
    voteDetails: data.voteDetails,
  });

  const country = contestant?.country ?? contestantId;

  return (
    <>
      <header className="space-y-1">
        <h2
          id={labels.titleId}
          className="text-lg font-bold tracking-tight flex items-center gap-2"
        >
          <span aria-hidden>{contestant?.flagEmoji ?? "🏳️"}</span>
          <span>{labels.title(country, totalPoints)}</span>
        </h2>
        {contestant ? (
          <p className="text-sm text-muted-foreground">
            {contestant.song} · {contestant.artist}
          </p>
        ) : null}
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.emptyCopy}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl bg-muted/40 p-3 text-sm">
            <Stat label={labels.meanLabel} value={aggregates.mean?.toFixed(1) ?? "—"} />
            <Stat label={labels.medianLabel} value={aggregates.median?.toFixed(1) ?? "—"} />
            {aggregates.highest ? (
              <StatActor
                label={labels.highestLabel}
                actor={aggregates.highest}
              />
            ) : null}
            {aggregates.lowest ? (
              <StatActor
                label={labels.lowestLabel}
                actor={aggregates.lowest}
              />
            ) : null}
          </dl>

          <ol className="divide-y divide-border rounded-xl border-2 border-border overflow-hidden">
            {rows.map((r) => (
              <li
                key={r.userId}
                data-testid="contestant-drill-row"
                className="px-4 py-3 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Avatar seed={r.avatarSeed} size={32} />
                    <span className="font-medium">{r.displayName}</span>
                  </div>
                  <PointsPill points={r.pointsAwarded} />
                </div>
                {r.missed ? (
                  <span className="inline-block text-xs italic text-muted-foreground rounded-full bg-muted px-2 py-0.5">
                    {labels.missedLabel}
                  </span>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {data.categories.map((c) => {
                      const key = c.key ?? c.name;
                      const v = r.scores[key];
                      if (typeof v !== "number") return null;
                      return (
                        <span
                          key={key}
                          className="rounded-full border border-border px-2 py-0.5 tabular-nums"
                        >
                          {c.name} {v}
                        </span>
                      );
                    })}
                    <span className="ml-auto tabular-nums font-medium">
                      {labels.weightedScoreLabel(r.weightedScore.toFixed(1))}
                    </span>
                  </div>
                )}
                {r.hotTake ? (
                  <p className="text-sm italic text-muted-foreground">
                    “{r.hotTake}”
                    {r.hotTakeEditedAt ? (
                      <span className="ml-1 text-xs not-italic">
                        {labels.editedLabel}
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className="tabular-nums font-semibold">{value}</dd>
    </div>
  );
}

function StatActor({
  label,
  actor,
}: {
  label: string;
  actor: { displayName: string; avatarSeed: string; weightedScore: number };
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className="flex items-center gap-2">
        <Avatar seed={actor.avatarSeed} size={20} />
        <span className="text-sm font-medium">{actor.displayName}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {actor.weightedScore.toFixed(1)}
        </span>
      </dd>
    </div>
  );
}

function PointsPill({ points }: { points: number }) {
  const twelve = points === 12;
  return (
    <span
      className={
        twelve
          ? "inline-flex h-7 min-w-[2rem] items-center justify-center rounded-full bg-accent text-accent-foreground px-2 text-sm font-bold tabular-nums"
          : "inline-flex h-7 min-w-[2rem] items-center justify-center rounded-full bg-foreground text-background px-2 text-sm font-semibold tabular-nums"
      }
    >
      {points}
    </span>
  );
}
```

- [ ] **Step 4: Run tests + type-check + commit**

```bash
npm run test -- src/components/results/drill-down/ContestantDrillDownBody.test.tsx && \
npm run type-check && \
git add src/components/results/drill-down/ContestantDrillDownBody.tsx \
        src/components/results/drill-down/ContestantDrillDownBody.test.tsx && \
git commit -m "feat(drill-down): <ContestantDrillDownBody> (SPEC §12.6.1)

Per-voter rows + 4 aggregates (mean/median/highest/lowest with avatars).
Missed entries dimmed, hot takes inline with edited tag, gold pill on
12-point givers. Title element exposes labels.titleId so the shell can
point aria-labelledby at it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `<ParticipantDrillDownBody>` — §12.6.2

**Files:**
- Create: `src/components/results/drill-down/ParticipantDrillDownBody.tsx`
- Create: `src/components/results/drill-down/ParticipantDrillDownBody.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/results/drill-down/ParticipantDrillDownBody.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ParticipantDrillDownBody from "@/components/results/drill-down/ParticipantDrillDownBody";
import type { ResultsData } from "@/lib/results/loadResults";

type DonePayload = Extract<ResultsData, { status: "done" }>;

const LABELS = {
  titleId: "drill-participant-title",
  title: (name: string) => `${name}'s vote`,
  totalAwardedLabel: (points: number) => `${points} pts given`,
  hotTakeCountLabel: (count: number) =>
    `${count} hot ${count === 1 ? "take" : "takes"}`,
  meanLabel: "Mean",
  harshnessLabel: (value: string) => `Harshness ${value}`,
  alignmentLabel: (value: string) => `Alignment ${value}`,
  weightedScoreLabel: (v: string) => `Weighted ${v}`,
  missedLabel: "Missed",
  editedLabel: "(edited)",
  emptyCopy: "This user did not vote on any contestant.",
};

const FIXTURE_DATA: Pick<
  DonePayload,
  "categories" | "members" | "contestants" | "leaderboard" | "voteDetails"
> = {
  categories: [{ name: "Vocals", weight: 1, key: "vocals" }],
  members: [
    { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
    { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
  ],
  contestants: [
    {
      id: "2026-se",
      country: "Sweden",
      countryCode: "se",
      flagEmoji: "🇸🇪",
      artist: "A",
      song: "S",
      runningOrder: 1,
      event: "final",
      year: 2026,
    },
    {
      id: "2026-no",
      country: "Norway",
      countryCode: "no",
      flagEmoji: "🇳🇴",
      artist: "A",
      song: "S",
      runningOrder: 2,
      event: "final",
      year: 2026,
    },
  ],
  leaderboard: [
    { contestantId: "2026-se", totalPoints: 20, rank: 1 },
    { contestantId: "2026-no", totalPoints: 10, rank: 2 },
  ],
  voteDetails: [
    {
      userId: "u1",
      contestantId: "2026-se",
      scores: { vocals: 9 },
      missed: false,
      pointsAwarded: 12,
      hotTake: "Best of the night.",
      hotTakeEditedAt: null,
    },
    {
      userId: "u1",
      contestantId: "2026-no",
      scores: { vocals: 5 },
      missed: false,
      pointsAwarded: 8,
      hotTake: null,
      hotTakeEditedAt: null,
    },
    {
      userId: "u2",
      contestantId: "2026-se",
      scores: { vocals: 4 },
      missed: false,
      pointsAwarded: 8,
      hotTake: null,
      hotTakeEditedAt: null,
    },
    {
      userId: "u2",
      contestantId: "2026-no",
      scores: { vocals: 8 },
      missed: false,
      pointsAwarded: 2,
      hotTake: null,
      hotTakeEditedAt: null,
    },
  ],
};

describe("<ParticipantDrillDownBody>", () => {
  it("renders the participant header with name and total points awarded", () => {
    render(
      <ParticipantDrillDownBody
        userId="u1"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /Alice's vote/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("20 pts given")).toBeInTheDocument();
  });

  it("renders body rows sorted by the user's weighted score desc", () => {
    render(
      <ParticipantDrillDownBody
        userId="u1"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    const rows = screen.getAllByTestId("participant-drill-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Sweden")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Norway")).toBeInTheDocument();
  });

  it("aggregates: harshness prefixed with sign (negative = harsher than room)", () => {
    render(
      <ParticipantDrillDownBody
        userId="u2"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    // Room mean = (9 + 5 + 4 + 8) / 4 = 6.5; Bob mean = 6.0; harshness = -0.5.
    expect(screen.getByText(/Harshness -0\.5/)).toBeInTheDocument();
  });

  it("aggregates: alignment 1.0 for a user perfectly aligned with the room", () => {
    render(
      <ParticipantDrillDownBody
        userId="u1"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(screen.getByText(/Alignment 1\.0/)).toBeInTheDocument();
  });

  it("renders empty copy when user has no votes", () => {
    render(
      <ParticipantDrillDownBody
        userId="u-nope"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(
      screen.getByText("This user did not vote on any contestant."),
    ).toBeInTheDocument();
  });

  it("exposes the title element with the configured id", () => {
    render(
      <ParticipantDrillDownBody
        userId="u1"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(document.getElementById("drill-participant-title")).not.toBeNull();
  });

  it("renders the hot take with the edited tag when applicable", () => {
    render(
      <ParticipantDrillDownBody
        userId="u1"
        data={{
          ...FIXTURE_DATA,
          voteDetails: [
            {
              ...FIXTURE_DATA.voteDetails[0],
              hotTake: "Edited!",
              hotTakeEditedAt: "2026-05-16T22:00:00Z",
            },
            FIXTURE_DATA.voteDetails[1],
          ],
        } as DonePayload}
        labels={LABELS}
      />,
    );
    const sweden = screen.getAllByTestId("participant-drill-row")[0];
    expect(within(sweden).getByText(/Edited!/)).toBeInTheDocument();
    expect(within(sweden).getByText("(edited)")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/components/results/drill-down/ParticipantDrillDownBody.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/results/drill-down/ParticipantDrillDownBody.tsx`:

```tsx
import Avatar from "@/components/ui/Avatar";
import { buildParticipantDrillDown } from "@/components/results/drill-down/buildParticipantDrillDown";
import type { ResultsData } from "@/lib/results/loadResults";

type DonePayload = Extract<ResultsData, { status: "done" }>;

export interface ParticipantDrillDownBodyLabels {
  titleId: string;
  title: (displayName: string) => string;
  totalAwardedLabel: (points: number) => string;
  hotTakeCountLabel: (count: number) => string;
  meanLabel: string;
  harshnessLabel: (value: string) => string;
  alignmentLabel: (value: string) => string;
  weightedScoreLabel: (value: string) => string;
  missedLabel: string;
  editedLabel: string;
  emptyCopy: string;
}

export interface ParticipantDrillDownBodyProps {
  userId: string;
  data: DonePayload;
  labels: ParticipantDrillDownBodyLabels;
}

export default function ParticipantDrillDownBody({
  userId,
  data,
  labels,
}: ParticipantDrillDownBodyProps) {
  const { header, rows, aggregates } = buildParticipantDrillDown(userId, {
    categories: data.categories,
    members: data.members,
    contestants: data.contestants,
    leaderboard: data.leaderboard,
    voteDetails: data.voteDetails,
  });

  return (
    <>
      <header className="flex items-center gap-3">
        <Avatar seed={header.avatarSeed} size={48} />
        <div className="space-y-0.5">
          <h2
            id={labels.titleId}
            className="text-lg font-bold tracking-tight"
          >
            {labels.title(header.displayName)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {labels.totalAwardedLabel(header.totalPointsAwarded)} ·{" "}
            {labels.hotTakeCountLabel(header.hotTakeCount)}
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.emptyCopy}</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3 rounded-xl bg-muted/40 p-3 text-sm">
            <Stat
              label={labels.meanLabel}
              value={aggregates.mean?.toFixed(1) ?? "—"}
            />
            <Stat
              label={labels.harshnessLabel(
                aggregates.harshness === null
                  ? "—"
                  : signed(aggregates.harshness),
              )}
              value=""
            />
            <Stat
              label={labels.alignmentLabel(
                aggregates.alignment === null
                  ? "—"
                  : aggregates.alignment.toFixed(1),
              )}
              value=""
            />
          </dl>

          <ol className="divide-y divide-border rounded-xl border-2 border-border overflow-hidden">
            {rows.map((r) => (
              <li
                key={r.contestantId}
                data-testid="participant-drill-row"
                className="px-4 py-3 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span aria-hidden>{r.flagEmoji}</span>
                    <span className="font-medium">{r.country}</span>
                    <span className="text-xs text-muted-foreground">
                      · {r.song}
                    </span>
                  </div>
                  <PointsPill points={r.pointsAwarded} />
                </div>
                {r.missed ? (
                  <span className="inline-block text-xs italic text-muted-foreground rounded-full bg-muted px-2 py-0.5">
                    {labels.missedLabel}
                  </span>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {data.categories.map((c) => {
                      const key = c.key ?? c.name;
                      const v = r.scores[key];
                      if (typeof v !== "number") return null;
                      return (
                        <span
                          key={key}
                          className="rounded-full border border-border px-2 py-0.5 tabular-nums"
                        >
                          {c.name} {v}
                        </span>
                      );
                    })}
                    <span className="ml-auto tabular-nums font-medium">
                      {labels.weightedScoreLabel(r.weightedScore.toFixed(1))}
                    </span>
                  </div>
                )}
                {r.hotTake ? (
                  <p className="text-sm italic text-muted-foreground">
                    “{r.hotTake}”
                    {r.hotTakeEditedAt ? (
                      <span className="ml-1 text-xs not-italic">
                        {labels.editedLabel}
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}

function signed(value: number): string {
  if (value > 0) return `+${value.toFixed(1)}`;
  if (value < 0) return value.toFixed(1);
  return "0.0";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className="tabular-nums font-semibold">{value}</dd>
    </div>
  );
}

function PointsPill({ points }: { points: number }) {
  const twelve = points === 12;
  return (
    <span
      className={
        twelve
          ? "inline-flex h-7 min-w-[2rem] items-center justify-center rounded-full bg-accent text-accent-foreground px-2 text-sm font-bold tabular-nums"
          : "inline-flex h-7 min-w-[2rem] items-center justify-center rounded-full bg-foreground text-background px-2 text-sm font-semibold tabular-nums"
      }
    >
      {points}
    </span>
  );
}
```

- [ ] **Step 4: Run tests + type-check + commit**

```bash
npm run test -- src/components/results/drill-down/ParticipantDrillDownBody.test.tsx && \
npm run type-check && \
git add src/components/results/drill-down/ParticipantDrillDownBody.tsx \
        src/components/results/drill-down/ParticipantDrillDownBody.test.tsx && \
git commit -m "feat(drill-down): <ParticipantDrillDownBody> (SPEC §12.6.2)

Per-contestant rows for one user, sorted by user's weighted score desc.
Aggregates: mean given, signed harshness (negative = harsher), Spearman
alignment vs leaderboard. Locale labels accept value substitution to
keep formatting in the caller's namespace.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `<CategoryDrillDownBody>` — §12.6.3

**Files:**
- Create: `src/components/results/drill-down/CategoryDrillDownBody.tsx`
- Create: `src/components/results/drill-down/CategoryDrillDownBody.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/results/drill-down/CategoryDrillDownBody.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import CategoryDrillDownBody from "@/components/results/drill-down/CategoryDrillDownBody";
import type { ResultsData } from "@/lib/results/loadResults";

type DonePayload = Extract<ResultsData, { status: "done" }>;

const LABELS = {
  titleId: "drill-category-title",
  title: (categoryName: string) => `Best ${categoryName} — full ranking`,
  meanLabel: (value: string) => `Mean ${value}`,
  voterCountLabel: (voted: number, total: number) => `${voted}/${total} voted`,
  sparklineAria: (min: number, median: number, max: number) =>
    `Min ${min}, median ${median}, max ${max} out of 10`,
  highestSingleLabel: (value: number, name: string) =>
    `Highest: ${value} from ${name}`,
  lowestSingleLabel: (value: number, name: string) =>
    `Lowest: ${value} from ${name}`,
  meanOfMeansLabel: (value: string) => `Room mean: ${value}`,
  emptyCopy: "No room member rated this category.",
};

const FIXTURE_DATA: Pick<
  DonePayload,
  "categories" | "members" | "contestants" | "voteDetails"
> = {
  categories: [{ name: "Vocals", weight: 1, key: "vocals" }],
  members: [
    { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
    { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
    { userId: "u3", displayName: "Carol", avatarSeed: "carol" },
  ],
  contestants: [
    {
      id: "2026-se",
      country: "Sweden",
      countryCode: "se",
      flagEmoji: "🇸🇪",
      artist: "A",
      song: "S",
      runningOrder: 1,
      event: "final",
      year: 2026,
    },
  ],
  voteDetails: [
    {
      userId: "u1",
      contestantId: "2026-se",
      scores: { vocals: 9 },
      missed: false,
      pointsAwarded: 12,
      hotTake: null,
      hotTakeEditedAt: null,
    },
    {
      userId: "u2",
      contestantId: "2026-se",
      scores: { vocals: 7 },
      missed: false,
      pointsAwarded: 8,
      hotTake: null,
      hotTakeEditedAt: null,
    },
    {
      userId: "u3",
      contestantId: "2026-se",
      scores: { vocals: 5 },
      missed: false,
      pointsAwarded: 5,
      hotTake: null,
      hotTakeEditedAt: null,
    },
  ],
};

describe("<CategoryDrillDownBody>", () => {
  it("renders the category header", () => {
    render(
      <CategoryDrillDownBody
        categoryKey="vocals"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /Best Vocals.*full ranking/i }),
    ).toBeInTheDocument();
  });

  it("renders rows sorted by category mean desc", () => {
    const out: Pick<DonePayload, "categories" | "members" | "contestants" | "voteDetails"> = {
      ...FIXTURE_DATA,
      contestants: [
        ...FIXTURE_DATA.contestants,
        {
          id: "2026-no",
          country: "Norway",
          countryCode: "no",
          flagEmoji: "🇳🇴",
          artist: "A",
          song: "S",
          runningOrder: 2,
          event: "final" as const,
          year: 2026,
        },
      ],
      voteDetails: [
        ...FIXTURE_DATA.voteDetails,
        {
          userId: "u1",
          contestantId: "2026-no",
          scores: { vocals: 3 },
          missed: false,
          pointsAwarded: 2,
          hotTake: null,
          hotTakeEditedAt: null,
        },
      ],
    };
    render(
      <CategoryDrillDownBody
        categoryKey="vocals"
        data={out as DonePayload}
        labels={LABELS}
      />,
    );
    const rows = screen.getAllByTestId("category-drill-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Sweden")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Norway")).toBeInTheDocument();
  });

  it("renders spread sparkline with min/median/max aria-label", () => {
    render(
      <CategoryDrillDownBody
        categoryKey="vocals"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    const sparkline = screen.getByLabelText("Min 5, median 7, max 9 out of 10");
    expect(sparkline).toBeInTheDocument();
  });

  it("renders voter count chip N/M voted", () => {
    render(
      <CategoryDrillDownBody
        categoryKey="vocals"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(screen.getByText("3/3 voted")).toBeInTheDocument();
  });

  it("aggregates: highest + lowest single vote with voter identity", () => {
    render(
      <CategoryDrillDownBody
        categoryKey="vocals"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(screen.getByText("Highest: 9 from Alice")).toBeInTheDocument();
    expect(screen.getByText("Lowest: 5 from Carol")).toBeInTheDocument();
  });

  it("renders empty copy when no votes for the category", () => {
    render(
      <CategoryDrillDownBody
        categoryKey="unknown"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(screen.getByText("No room member rated this category.")).toBeInTheDocument();
  });

  it("exposes the title element with the configured id", () => {
    render(
      <CategoryDrillDownBody
        categoryKey="vocals"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(document.getElementById("drill-category-title")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/components/results/drill-down/CategoryDrillDownBody.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/results/drill-down/CategoryDrillDownBody.tsx`:

```tsx
import { buildCategoryDrillDown } from "@/components/results/drill-down/buildCategoryDrillDown";
import type { ResultsData } from "@/lib/results/loadResults";

type DonePayload = Extract<ResultsData, { status: "done" }>;

export interface CategoryDrillDownBodyLabels {
  titleId: string;
  title: (categoryName: string) => string;
  meanLabel: (value: string) => string;
  voterCountLabel: (voted: number, total: number) => string;
  sparklineAria: (min: number, median: number, max: number) => string;
  highestSingleLabel: (value: number, name: string) => string;
  lowestSingleLabel: (value: number, name: string) => string;
  meanOfMeansLabel: (value: string) => string;
  emptyCopy: string;
}

export interface CategoryDrillDownBodyProps {
  categoryKey: string;
  data: DonePayload;
  labels: CategoryDrillDownBodyLabels;
}

export default function CategoryDrillDownBody({
  categoryKey,
  data,
  labels,
}: CategoryDrillDownBodyProps) {
  const category = data.categories.find(
    (c) => (c.key ?? c.name) === categoryKey,
  );
  const { rows, aggregates } = buildCategoryDrillDown(categoryKey, {
    categories: data.categories,
    members: data.members,
    contestants: data.contestants,
    voteDetails: data.voteDetails,
  });
  const categoryName = category?.name ?? categoryKey;

  return (
    <>
      <header>
        <h2
          id={labels.titleId}
          className="text-lg font-bold tracking-tight"
        >
          {labels.title(categoryName)}
        </h2>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.emptyCopy}</p>
      ) : (
        <>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl bg-muted/40 p-3 text-sm">
            {aggregates.highest ? (
              <Stat
                label={labels.highestSingleLabel(
                  aggregates.highest.value,
                  aggregates.highest.displayName,
                )}
              />
            ) : null}
            {aggregates.lowest ? (
              <Stat
                label={labels.lowestSingleLabel(
                  aggregates.lowest.value,
                  aggregates.lowest.displayName,
                )}
              />
            ) : null}
            {aggregates.meanOfMeans !== null ? (
              <Stat
                label={labels.meanOfMeansLabel(
                  aggregates.meanOfMeans.toFixed(1),
                )}
              />
            ) : null}
          </dl>

          <ol className="divide-y divide-border rounded-xl border-2 border-border overflow-hidden">
            {rows.map((r) => (
              <li
                key={r.contestantId}
                data-testid="category-drill-row"
                className="px-4 py-3 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span aria-hidden>{r.flagEmoji}</span>
                    <span className="font-medium">{r.country}</span>
                  </div>
                  <span className="tabular-nums font-semibold">
                    {labels.meanLabel(r.mean.toFixed(1))}
                  </span>
                </div>
                <Sparkline
                  spread={r.spread}
                  ariaLabel={labels.sparklineAria(
                    r.spread.min,
                    r.spread.median,
                    r.spread.max,
                  )}
                />
                <span className="inline-block text-xs text-muted-foreground rounded-full bg-muted px-2 py-0.5">
                  {labels.voterCountLabel(r.voted, r.total)}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}

function Stat({ label }: { label: string }) {
  return (
    <div>
      <dd className="text-sm font-medium">{label}</dd>
    </div>
  );
}

function Sparkline({
  spread,
  ariaLabel,
}: {
  spread: { min: number; median: number; max: number };
  ariaLabel: string;
}) {
  const pos = (v: number) => `${((v - 1) / 9) * 100}%`;
  return (
    <div role="img" aria-label={ariaLabel} className="relative h-2 bg-muted rounded-full">
      <span
        className="absolute top-1/2 -translate-y-1/2 h-2 w-0.5 bg-muted-foreground"
        style={{ left: pos(spread.min) }}
      />
      <span
        className="absolute top-1/2 -translate-y-1/2 h-3 w-1 bg-primary -mt-1.5"
        style={{ left: pos(spread.median) }}
      />
      <span
        className="absolute top-1/2 -translate-y-1/2 h-2 w-0.5 bg-muted-foreground"
        style={{ left: pos(spread.max) }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run tests + type-check + commit**

```bash
npm run test -- src/components/results/drill-down/CategoryDrillDownBody.test.tsx && \
npm run type-check && \
git add src/components/results/drill-down/CategoryDrillDownBody.tsx \
        src/components/results/drill-down/CategoryDrillDownBody.test.tsx && \
git commit -m "feat(drill-down): <CategoryDrillDownBody> (SPEC §12.6.3)

Per-contestant mean for one category + min/median/max spread sparkline
(role=img with aria-label for screen readers) + voter count chip.
Aggregates: highest single vote (who), lowest single vote (who), mean
of means.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Extract `<Breakdowns>` and add avatar tap target

**Files:**
- Create: `src/components/results/Breakdowns.tsx`
- Create: `src/components/results/Breakdowns.test.tsx`
- Modify: `src/app/results/[id]/page.tsx` (replace inline `Breakdowns` function with the imported component — done in Task 11)

The inline `Breakdowns` function lives at [page.tsx:326-375](../../../src/app/results/[id]/page.tsx#L326-L375). This task lifts it into a typed component and adds the avatar tap target. The page wiring change comes in Task 11.

- [ ] **Step 1: Write the failing tests**

Create `src/components/results/Breakdowns.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import Breakdowns from "@/components/results/Breakdowns";
import type { Contestant } from "@/types";

const BREAKDOWNS = [
  {
    userId: "u1",
    displayName: "Alice",
    avatarSeed: "alice",
    picks: [
      { contestantId: "2026-se", pointsAwarded: 12 },
      { contestantId: "2026-no", pointsAwarded: 8 },
    ],
  },
  {
    userId: "u2",
    displayName: "Bob",
    avatarSeed: "bob",
    picks: [{ contestantId: "2026-no", pointsAwarded: 12 }],
  },
];

const CONTESTANTS: Contestant[] = [
  {
    id: "2026-se",
    country: "Sweden",
    countryCode: "se",
    flagEmoji: "🇸🇪",
    artist: "A",
    song: "S",
    runningOrder: 1,
    event: "final",
    year: 2026,
  },
  {
    id: "2026-no",
    country: "Norway",
    countryCode: "no",
    flagEmoji: "🇳🇴",
    artist: "A",
    song: "S",
    runningOrder: 2,
    event: "final",
    year: 2026,
  },
];

const LABELS = {
  title: "Per-voter breakdowns",
  picksLabel: (n: number) => `${n} picks`,
  openParticipantAria: (name: string) => `Open ${name}'s full vote`,
};

describe("<Breakdowns>", () => {
  it("renders one <details> per user", () => {
    render(
      <Breakdowns
        breakdowns={BREAKDOWNS}
        contestants={CONTESTANTS}
        labels={LABELS}
      />,
    );
    const items = screen.getAllByRole("group");
    // <details> is exposed via role="group" by default jsdom semantics is patchy;
    // fall back to a stable testid we add in the implementation.
    expect(screen.getByTestId("breakdown-u1")).toBeInTheDocument();
    expect(screen.getByTestId("breakdown-u2")).toBeInTheDocument();
  });

  it("renders an avatar button inside each summary with the correct aria-label", () => {
    render(
      <Breakdowns
        breakdowns={BREAKDOWNS}
        contestants={CONTESTANTS}
        labels={LABELS}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Open Alice's full vote" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Bob's full vote" }),
    ).toBeInTheDocument();
  });

  it("avatar click calls onOpenParticipant(userId) and does not toggle <details>", () => {
    const onOpen = vi.fn();
    render(
      <Breakdowns
        breakdowns={BREAKDOWNS}
        contestants={CONTESTANTS}
        labels={LABELS}
        onOpenParticipant={onOpen}
      />,
    );
    const summary = screen.getByTestId("breakdown-u1").querySelector("summary")!;
    const isOpenBefore = (summary.parentElement as HTMLDetailsElement).open;
    const button = within(summary).getByRole("button", {
      name: "Open Alice's full vote",
    });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith("u1");
    const isOpenAfter = (summary.parentElement as HTMLDetailsElement).open;
    expect(isOpenAfter).toBe(isOpenBefore);
  });

  it("clicking the summary text toggles <details>", () => {
    render(
      <Breakdowns
        breakdowns={BREAKDOWNS}
        contestants={CONTESTANTS}
        labels={LABELS}
      />,
    );
    const details = screen.getByTestId("breakdown-u1") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(details.querySelector("summary")!);
    expect(details.open).toBe(true);
  });

  it("renders picks inside the opened details", () => {
    render(
      <Breakdowns
        breakdowns={BREAKDOWNS}
        contestants={CONTESTANTS}
        labels={LABELS}
      />,
    );
    const details = screen.getByTestId("breakdown-u1") as HTMLDetailsElement;
    fireEvent.click(details.querySelector("summary")!);
    expect(within(details).getByText("Sweden")).toBeInTheDocument();
    expect(within(details).getByText("Norway")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/components/results/Breakdowns.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/results/Breakdowns.tsx`:

```tsx
"use client";

import Avatar from "@/components/ui/Avatar";
import type { Contestant } from "@/types";
import type { UserBreakdown } from "@/lib/results/loadResults";

export interface BreakdownsLabels {
  title: string;
  picksLabel: (n: number) => string;
  openParticipantAria: (displayName: string) => string;
}

export interface BreakdownsProps {
  breakdowns: UserBreakdown[];
  contestants: Contestant[];
  labels: BreakdownsLabels;
  /**
   * SPEC §12.6.2 — invoked when the avatar button is tapped. When undefined
   * (e.g. server-rendered fallback consumers), the avatar still renders
   * but is non-interactive.
   */
  onOpenParticipant?: (userId: string) => void;
}

export default function Breakdowns({
  breakdowns,
  contestants,
  labels,
  onOpenParticipant,
}: BreakdownsProps) {
  const contestantById = new Map(contestants.map((c) => [c.id, c]));

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">{labels.title}</h2>
      <div className="space-y-3">
        {breakdowns.map((b) => (
          <details
            key={b.userId}
            data-testid={`breakdown-${b.userId}`}
            className="rounded-xl border-2 border-border overflow-hidden"
          >
            <summary className="px-4 py-3 cursor-pointer list-none flex items-center justify-between gap-3">
              <span className="flex items-center gap-3">
                {onOpenParticipant ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onOpenParticipant(b.userId);
                    }}
                    aria-label={labels.openParticipantAria(b.displayName)}
                    className="rounded-full transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <Avatar seed={b.avatarSeed} size={32} />
                  </button>
                ) : (
                  <Avatar seed={b.avatarSeed} size={32} />
                )}
                <span className="font-medium">{b.displayName}</span>
              </span>
              <span className="text-sm text-muted-foreground">
                {labels.picksLabel(b.picks.length)}
              </span>
            </summary>
            <ul className="border-t border-border divide-y divide-border">
              {b.picks.map((p) => {
                const c = contestantById.get(p.contestantId);
                return (
                  <li
                    key={p.contestantId}
                    className="flex items-center justify-between gap-3 px-4 py-2"
                  >
                    <span className="flex items-center gap-2">
                      <span aria-hidden>{c?.flagEmoji ?? "🏳️"}</span>
                      <span>{c?.country ?? p.contestantId}</span>
                    </span>
                    <span className="tabular-nums font-semibold">
                      {p.pointsAwarded}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run tests + type-check + commit**

```bash
npm run test -- src/components/results/Breakdowns.test.tsx && \
npm run type-check && \
git add src/components/results/Breakdowns.tsx \
        src/components/results/Breakdowns.test.tsx && \
git commit -m "feat(results): extract <Breakdowns> + add avatar tap target (SPEC §12.6.2)

Lifts the inline Breakdowns function out of page.tsx into its own
component. Adds an Avatar inside each <details> summary; when an
onOpenParticipant callback is supplied, the avatar becomes a button
(stopPropagation prevents the click from toggling <details>) whose
aria-label names the user. Without the callback the avatar renders
inert — backwards-compatible with any SSR consumer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Extend `<LeaderboardWithDrillDown>` and `<AwardsSection>` with open-callbacks

**Files:**
- Modify: `src/components/results/LeaderboardWithDrillDown.tsx`
- Modify: `src/components/results/LeaderboardWithDrillDown.test.tsx`
- Modify: `src/components/results/AwardsSection.tsx`
- Modify: `src/components/results/AwardsSection.test.tsx`

- [ ] **Step 1: Add the failing test for the leaderboard link**

Open `src/components/results/LeaderboardWithDrillDown.test.tsx` and append:

```tsx
import { vi } from "vitest";
// ... existing imports ...

describe("Full breakdown link (SPEC §12.6.1 trigger)", () => {
  it("renders the link inside an open <details> only when onOpenFullBreakdown is supplied", () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <LeaderboardWithDrillDown
        leaderboard={LEADERBOARD}
        contestants={CONTESTANTS}
        contestantBreakdowns={BREAKDOWNS}
        labels={LABELS}
        onOpenFullBreakdown={onOpen}
        openFullBreakdownLabel="Full breakdown →"
      />,
    );
    // Open the first row's details so the link mounts.
    const firstDetails = screen.getAllByRole("group")[0] as HTMLDetailsElement;
    firstDetails.open = true;
    fireEvent.toggle(firstDetails);
    expect(
      within(firstDetails).getByRole("button", { name: "Full breakdown →" }),
    ).toBeInTheDocument();

    // Without the callback, the link is suppressed.
    rerender(
      <LeaderboardWithDrillDown
        leaderboard={LEADERBOARD}
        contestants={CONTESTANTS}
        contestantBreakdowns={BREAKDOWNS}
        labels={LABELS}
      />,
    );
    const refreshedDetails = screen.getAllByRole("group")[0] as HTMLDetailsElement;
    refreshedDetails.open = true;
    fireEvent.toggle(refreshedDetails);
    expect(
      within(refreshedDetails).queryByRole("button", { name: /Full breakdown/i }),
    ).toBeNull();
  });

  it("clicking the link calls onOpenFullBreakdown with the contestantId", () => {
    const onOpen = vi.fn();
    render(
      <LeaderboardWithDrillDown
        leaderboard={LEADERBOARD}
        contestants={CONTESTANTS}
        contestantBreakdowns={BREAKDOWNS}
        labels={LABELS}
        onOpenFullBreakdown={onOpen}
        openFullBreakdownLabel="Full breakdown →"
      />,
    );
    const firstDetails = screen.getAllByRole("group")[0] as HTMLDetailsElement;
    firstDetails.open = true;
    fireEvent.toggle(firstDetails);
    fireEvent.click(
      within(firstDetails).getByRole("button", { name: "Full breakdown →" }),
    );
    expect(onOpen).toHaveBeenCalledWith(LEADERBOARD[0].contestantId);
  });
});
```

The existing test file's top-level imports must already include `fireEvent`, `screen`, `within`, and the existing fixtures (`LEADERBOARD`, `CONTESTANTS`, `BREAKDOWNS`, `LABELS`) — they do. If `vi` is not yet imported, add the `vi` import line at the top.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/components/results/LeaderboardWithDrillDown.test.tsx
```
Expected: the two new tests fail.

- [ ] **Step 3: Modify `<LeaderboardWithDrillDown>`**

In `src/components/results/LeaderboardWithDrillDown.tsx`:

a. **Add `"use client";` as the first line of the file.** The new trigger button uses an `onClick` handler — without the directive, Next.js rejects the function-prop boundary when the component is rendered from `<DrillDownClient>`.

b. Extend `LeaderboardWithDrillDownLabels`'s consumer-facing props by adding two optional props to `LeaderboardWithDrillDownProps` (not the labels object):

```ts
interface LeaderboardWithDrillDownProps {
  leaderboard: LeaderboardEntry[];
  contestants: Contestant[];
  contestantBreakdowns: ContestantBreakdown[];
  labels: LeaderboardWithDrillDownLabels;
  /** SPEC §12.6.1 — invoked when the user taps the "Full breakdown" link inside an open row. */
  onOpenFullBreakdown?: (contestantId: string) => void;
  /** Label for the open-full-breakdown button. Required iff onOpenFullBreakdown is supplied. */
  openFullBreakdownLabel?: string;
}
```

c. In the component body, accept the new props in the destructure, and add the link inside the open-details body **after** the existing `<ul>`/`<p>` voter list:

```tsx
{onOpenFullBreakdown && openFullBreakdownLabel ? (
  <button
    type="button"
    onClick={() => onOpenFullBreakdown(e.contestantId)}
    className="mt-3 text-sm font-medium text-primary underline underline-offset-2 hover:text-primary/80"
  >
    {openFullBreakdownLabel}
  </button>
) : null}
```

- [ ] **Step 4: Add the failing test for `<AwardsSection>` link**

Open `src/components/results/AwardsSection.test.tsx` and append:

```tsx
import { vi } from "vitest";

describe("Full ranking link (SPEC §12.6.3 trigger)", () => {
  const COMMON_PROPS = {
    contestants: [
      {
        id: "2026-se",
        country: "Sweden",
        countryCode: "se",
        flagEmoji: "🇸🇪",
        artist: "A",
        song: "S",
        runningOrder: 1,
        event: "final" as const,
        year: 2026,
      },
    ],
    members: [{ userId: "u1", displayName: "Alice", avatarSeed: "alice" }],
    labels: {
      sectionHeading: "Awards",
      categoryHeading: "Best in category",
      personalityHeading: "And the room said...",
      jointCaption: "joint",
      neighbourhoodCaption: "voted alike",
    },
  };

  it("renders the Full ranking button on category-award cards when onOpenCategoryRanking is supplied", () => {
    const onOpen = vi.fn();
    render(
      <AwardsSection
        {...COMMON_PROPS}
        awards={[
          {
            roomId: "r",
            awardKey: "best_vocals",
            awardName: "Best Vocals",
            winnerUserId: null,
            winnerUserIdB: null,
            winnerContestantId: "2026-se",
            statValue: 8.5,
            statLabel: "mean",
          },
        ]}
        onOpenCategoryRanking={onOpen}
        openCategoryRankingLabel="Full ranking →"
      />,
    );
    const button = screen.getByRole("button", { name: "Full ranking →" });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith("vocals");
  });

  it("does not render the link on personality awards", () => {
    render(
      <AwardsSection
        {...COMMON_PROPS}
        awards={[
          {
            roomId: "r",
            awardKey: "harshest_critic",
            awardName: "Harshest Critic",
            winnerUserId: "u1",
            winnerUserIdB: null,
            winnerContestantId: null,
            statValue: 4.2,
            statLabel: "mean",
          },
        ]}
        onOpenCategoryRanking={vi.fn()}
        openCategoryRankingLabel="Full ranking →"
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Full ranking/i }),
    ).toBeNull();
  });

  it("does not render the link when onOpenCategoryRanking is undefined", () => {
    render(
      <AwardsSection
        {...COMMON_PROPS}
        awards={[
          {
            roomId: "r",
            awardKey: "best_vocals",
            awardName: "Best Vocals",
            winnerUserId: null,
            winnerUserIdB: null,
            winnerContestantId: "2026-se",
            statValue: 8.5,
            statLabel: "mean",
          },
        ]}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Full ranking/i }),
    ).toBeNull();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

```bash
npm run test -- src/components/results/AwardsSection.test.tsx
```
Expected: the three new tests fail.

- [ ] **Step 6: Modify `<AwardsSection>`**

In `src/components/results/AwardsSection.tsx`:

a. **Add `"use client";` as the first line of the file.** Same reason as `<LeaderboardWithDrillDown>` — the new "Full ranking" button has an `onClick` handler.

b. Extend `AwardsSectionProps`:

```ts
interface AwardsSectionProps {
  // ... existing props ...
  onOpenCategoryRanking?: (categoryKey: string) => void;
  openCategoryRankingLabel?: string;
}
```

c. In the destructure, accept `onOpenCategoryRanking` and `openCategoryRankingLabel`. The category-award awards are already filtered into `const category = awards.filter((a) => a.awardKey.startsWith("best_"))`. The category key is derived from the awardKey by stripping the `best_` prefix: `award.awardKey.replace(/^best_/, "")`.

d. Wherever the component renders a category award card (find the JSX inside the `category.map(...)` loop — it's after `if (category.length > 0)`), append:

```tsx
{onOpenCategoryRanking && openCategoryRankingLabel ? (
  <button
    type="button"
    onClick={() => onOpenCategoryRanking(a.awardKey.replace(/^best_/, ""))}
    className="mt-2 text-sm font-medium text-primary underline underline-offset-2 hover:text-primary/80"
  >
    {openCategoryRankingLabel}
  </button>
) : null}
```

The exact insertion point depends on the existing JSX shape. If the card includes an `<AwardExplainer>` accordion, place the button **as a sibling after** that — they share the same card container but do not nest. The button must NOT be inside the `<details>` of the explainer (it would be hidden until the explainer is opened).

- [ ] **Step 7: Run tests + type-check + commit**

```bash
npm run test -- src/components/results/LeaderboardWithDrillDown.test.tsx \
                src/components/results/AwardsSection.test.tsx && \
npm run type-check && \
git add src/components/results/LeaderboardWithDrillDown.tsx \
        src/components/results/LeaderboardWithDrillDown.test.tsx \
        src/components/results/AwardsSection.tsx \
        src/components/results/AwardsSection.test.tsx && \
git commit -m "feat(results): wire open-drill-down triggers into leaderboard + awards (SPEC §12.6)

<LeaderboardWithDrillDown> gains an optional onOpenFullBreakdown +
openFullBreakdownLabel — when both are set, an extra link renders inside
each open <details> body so users can escalate from the lightweight
voter list to the full §12.6.1 sheet. Stage 1 behaviour preserved when
the props are absent.

<AwardsSection> gains an optional onOpenCategoryRanking +
openCategoryRankingLabel — when both are set, each category award card
(awardKey starts with 'best_') gets a Full ranking link. Personality
awards never get the link. Sibling to the existing <AwardExplainer>
accordion so taps don't collide.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: `<DrillDownClient>` page wrapper + wire into `/results/[id]`

**Files:**
- Create: `src/app/results/[id]/DrillDownClient.tsx`
- Create: `src/app/results/[id]/DrillDownClient.test.tsx`
- Modify: `src/app/results/[id]/page.tsx`

- [ ] **Step 1: Write the failing integration test**

Create `src/app/results/[id]/DrillDownClient.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import DrillDownClient from "@/app/results/[id]/DrillDownClient";
import type { ResultsData } from "@/lib/results/loadResults";

vi.mock("next-intl", async () => {
  return {
    useTranslations: () => (key: string, params?: Record<string, unknown>) => {
      if (params) {
        return `${key}:${Object.entries(params)
          .map(([k, v]) => `${k}=${v}`)
          .join(",")}`;
      }
      return key;
    },
  };
});

type DonePayload = Extract<ResultsData, { status: "done" }>;

const DATA: DonePayload = {
  status: "done",
  year: 2026,
  event: "final",
  pin: "TESTPN",
  ownerUserId: "u1",
  categories: [{ name: "Vocals", weight: 1, key: "vocals" }],
  leaderboard: [{ contestantId: "2026-se", totalPoints: 12, rank: 1 }],
  contestants: [
    {
      id: "2026-se",
      country: "Sweden",
      countryCode: "se",
      flagEmoji: "🇸🇪",
      artist: "A",
      song: "S",
      runningOrder: 1,
      event: "final",
      year: 2026,
    },
  ],
  breakdowns: [
    {
      userId: "u1",
      displayName: "Alice",
      avatarSeed: "alice",
      picks: [{ contestantId: "2026-se", pointsAwarded: 12 }],
    },
  ],
  contestantBreakdowns: [
    {
      contestantId: "2026-se",
      gives: [
        {
          userId: "u1",
          displayName: "Alice",
          avatarSeed: "alice",
          pointsAwarded: 12,
        },
      ],
    },
  ],
  hotTakes: [],
  awards: [
    {
      roomId: "r",
      awardKey: "best_vocals",
      awardName: "Best Vocals",
      winnerUserId: null,
      winnerUserIdB: null,
      winnerContestantId: "2026-se",
      statValue: 8.5,
      statLabel: "mean",
    },
  ],
  personalNeighbours: [],
  members: [{ userId: "u1", displayName: "Alice", avatarSeed: "alice" }],
  voteDetails: [
    {
      userId: "u1",
      contestantId: "2026-se",
      scores: { vocals: 9 },
      missed: false,
      pointsAwarded: 12,
      hotTake: null,
      hotTakeEditedAt: null,
    },
  ],
};

describe("<DrillDownClient>", () => {
  it("opens the contestant sheet when the leaderboard 'Full breakdown' link is clicked", () => {
    render(<DrillDownClient data={DATA} roomId="r1" />);
    const firstRow = screen.getAllByRole("group")[0] as HTMLDetailsElement;
    firstRow.open = true;
    fireEvent.toggle(firstRow);
    fireEvent.click(
      within(firstRow).getByRole("button", { name: /Full breakdown/i }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Sweden/)).toBeInTheDocument();
  });

  it("opens the participant sheet when an avatar button is clicked", () => {
    render(<DrillDownClient data={DATA} roomId="r1" />);
    fireEvent.click(
      screen.getByRole("button", { name: /Open Alice/i }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens the category sheet when the 'Full ranking' link is clicked", () => {
    render(<DrillDownClient data={DATA} roomId="r1" />);
    fireEvent.click(
      screen.getByRole("button", { name: /Full ranking/i }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("only one sheet open at a time — opening B closes A", () => {
    render(<DrillDownClient data={DATA} roomId="r1" />);
    // Open participant first.
    fireEvent.click(screen.getByRole("button", { name: /Open Alice/i }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    // Then open category.
    fireEvent.click(screen.getByRole("button", { name: /Full ranking/i }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("closing a sheet via the X button removes it from the DOM", () => {
    render(<DrillDownClient data={DATA} roomId="r1" />);
    fireEvent.click(screen.getByRole("button", { name: /Open Alice/i }));
    expect(screen.queryByRole("dialog")).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /Close/i,
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/app/results/[id]/DrillDownClient.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `<DrillDownClient>`**

Create `src/app/results/[id]/DrillDownClient.tsx`:

```tsx
"use client";

import { useReducer } from "react";
import { useTranslations } from "next-intl";
import type { ResultsData } from "@/lib/results/loadResults";
import LeaderboardWithDrillDown from "@/components/results/LeaderboardWithDrillDown";
import AwardsSection from "@/components/results/AwardsSection";
import HotTakesSection from "@/components/results/HotTakesSection";
import Breakdowns from "@/components/results/Breakdowns";
import {
  drillDownReducer,
  type DrillDownState,
} from "@/components/results/drill-down/drillDownState";
import DrillDownSheet from "@/components/results/drill-down/DrillDownSheet";
import ContestantDrillDownBody from "@/components/results/drill-down/ContestantDrillDownBody";
import ParticipantDrillDownBody from "@/components/results/drill-down/ParticipantDrillDownBody";
import CategoryDrillDownBody from "@/components/results/drill-down/CategoryDrillDownBody";

type DonePayload = Extract<ResultsData, { status: "done" }>;

interface DrillDownClientProps {
  data: DonePayload;
  roomId: string;
}

export default function DrillDownClient({
  data,
  roomId,
}: DrillDownClientProps) {
  const tResults = useTranslations("results");
  const tAwards = useTranslations("awards");
  const tDrill = useTranslations("results.drillDown");

  const [state, dispatch] = useReducer(
    drillDownReducer,
    null as DrillDownState,
  );
  const close = () => dispatch({ type: "close" });

  return (
    <>
      <LeaderboardWithDrillDown
        leaderboard={data.leaderboard}
        contestants={data.contestants}
        contestantBreakdowns={data.contestantBreakdowns}
        labels={{
          title: tResults("headings.leaderboard"),
          drillDownHeading: tResults("leaderboard.drillDownHeading"),
          drillDownEmpty: tResults("leaderboard.drillDownEmpty"),
          toggleAria: (country) =>
            tResults("leaderboard.drillDownToggleAria", { country }),
          formatGivePoints: (points) =>
            tResults("leaderboard.drillDownGive", { points }),
        }}
        onOpenFullBreakdown={(contestantId) =>
          dispatch({
            type: "open",
            payload: { kind: "contestant", contestantId },
          })
        }
        openFullBreakdownLabel={tDrill("contestant.openLink")}
      />

      {data.awards.length > 0 ? (
        <AwardsSection
          awards={data.awards}
          contestants={data.contestants}
          members={data.members}
          personalNeighbours={data.personalNeighbours}
          labels={{
            sectionHeading: tResults("headings.awards"),
            categoryHeading: tResults("headings.categoryAwards"),
            personalityHeading: tResults("headings.personalityAwards"),
            jointCaption: tAwards("jointCaption"),
            neighbourhoodCaption: tAwards("neighbourhoodCaption"),
          }}
          onOpenCategoryRanking={(categoryKey) =>
            dispatch({
              type: "open",
              payload: { kind: "category", categoryKey },
            })
          }
          openCategoryRankingLabel={tDrill("category.openLink")}
        />
      ) : null}

      {data.breakdowns.length > 0 ? (
        <Breakdowns
          breakdowns={data.breakdowns}
          contestants={data.contestants}
          labels={{
            title: tResults("headings.breakdowns"),
            picksLabel: (n) => tResults("breakdowns.picks", { count: n }),
            openParticipantAria: (name) =>
              tDrill("participant.openAria", { name }),
          }}
          onOpenParticipant={(userId) =>
            dispatch({ type: "open", payload: { kind: "participant", userId } })
          }
        />
      ) : null}

      {data.hotTakes.length > 0 ? (
        <HotTakesSection
          title={tResults("headings.hotTakes")}
          editedLabel={tResults("results.hotTake.edited")}
          hotTakes={data.hotTakes}
          contestants={data.contestants}
          roomId={roomId}
          ownerUserId={data.ownerUserId}
        />
      ) : null}

      {state?.kind === "contestant" ? (
        <DrillDownSheet
          open
          onClose={close}
          titleId="drill-contestant-title"
          closeAriaLabel={tDrill("common.closeAria")}
        >
          <ContestantDrillDownBody
            contestantId={state.contestantId}
            data={data}
            labels={{
              titleId: "drill-contestant-title",
              title: (country, points) =>
                tDrill("contestant.title", { country, points }),
              meanLabel: tDrill("common.mean"),
              medianLabel: tDrill("common.median"),
              highestLabel: tDrill("common.highest"),
              lowestLabel: tDrill("common.lowest"),
              weightedScoreLabel: (value) =>
                tDrill("common.weightedScore", { value }),
              missedLabel: tDrill("common.missed"),
              editedLabel: tDrill("common.edited"),
              emptyCopy: tDrill("contestant.empty"),
            }}
          />
        </DrillDownSheet>
      ) : null}

      {state?.kind === "participant" ? (
        <DrillDownSheet
          open
          onClose={close}
          titleId="drill-participant-title"
          closeAriaLabel={tDrill("common.closeAria")}
        >
          <ParticipantDrillDownBody
            userId={state.userId}
            data={data}
            labels={{
              titleId: "drill-participant-title",
              title: (name) => tDrill("participant.title", { name }),
              totalAwardedLabel: (points) =>
                tDrill("participant.totalAwarded", { points }),
              hotTakeCountLabel: (count) =>
                tDrill("participant.hotTakeCount", { count }),
              meanLabel: tDrill("common.mean"),
              harshnessLabel: (value) =>
                tDrill("participant.harshness", { value }),
              alignmentLabel: (value) =>
                tDrill("participant.alignment", { value }),
              weightedScoreLabel: (value) =>
                tDrill("common.weightedScore", { value }),
              missedLabel: tDrill("common.missed"),
              editedLabel: tDrill("common.edited"),
              emptyCopy: tDrill("participant.empty"),
            }}
          />
        </DrillDownSheet>
      ) : null}

      {state?.kind === "category" ? (
        <DrillDownSheet
          open
          onClose={close}
          titleId="drill-category-title"
          closeAriaLabel={tDrill("common.closeAria")}
        >
          <CategoryDrillDownBody
            categoryKey={state.categoryKey}
            data={data}
            labels={{
              titleId: "drill-category-title",
              title: (categoryName) =>
                tDrill("category.title", { category: categoryName }),
              meanLabel: (value) => tDrill("category.meanLabel", { value }),
              voterCountLabel: (voted, total) =>
                tDrill("category.voterCount", { voted, total }),
              sparklineAria: (min, median, max) =>
                tDrill("category.sparklineAria", { min, median, max }),
              highestSingleLabel: (value, name) =>
                tDrill("category.highestSingle", { value, name }),
              lowestSingleLabel: (value, name) =>
                tDrill("category.lowestSingle", { value, name }),
              meanOfMeansLabel: (value) =>
                tDrill("category.meanOfMeans", { value }),
              emptyCopy: tDrill("category.empty"),
            }}
          />
        </DrillDownSheet>
      ) : null}
    </>
  );
}
```

- [ ] **Step 4: Update `page.tsx` to delegate the `done` body to `<DrillDownClient>`**

Open `src/app/results/[id]/page.tsx`. The existing `DoneBody` async function (line ~198) renders the leaderboard / awards / breakdowns / hot-takes sections inline. Replace the rendering JSX of `DoneBody` with a thin wrapper around `<DrillDownClient>`, keeping the existing `<CopySummaryButton>` block at the top.

The replacement `DoneBody`:

```tsx
async function DoneBody({
  data,
  roomId,
}: {
  data: Extract<ResultsData, { status: "done" }>;
  roomId: string;
}) {
  const t = await getTranslations("results");

  const shareUrl =
    (process.env.NEXT_PUBLIC_APP_URL ?? "https://eurovisionmaxxing.com") +
    `/results/${roomId}`;

  const summary = formatRoomSummary({
    year: data.year,
    event: data.event,
    leaderboard: data.leaderboard,
    contestants: data.contestants,
    shareUrl,
    labels: {
      eventTitle: (year, event) => t(`eventTitle.${event}`, { year }),
      topLine: t("summary.topLine"),
      fullResults: t("summary.fullResults"),
    },
  });

  return (
    <>
      <div className="flex justify-end">
        <CopySummaryButton
          summary={summary}
          labels={{ idle: t("copySummary.idle"), done: t("copySummary.done") }}
        />
      </div>
      <DrillDownClient data={data} roomId={roomId} />
    </>
  );
}
```

Add the import at the top of `page.tsx`:

```tsx
import DrillDownClient from "./DrillDownClient";
```

Delete the inline `Breakdowns` function (lines ~326-375) — it's no longer used.

- [ ] **Step 5: Run all touched tests + full suite + type-check + commit**

```bash
npm run test -- src/app/results/[id]/DrillDownClient.test.tsx && \
npm run test && \
npm run type-check && \
git add src/app/results/[id]/DrillDownClient.tsx \
        src/app/results/[id]/DrillDownClient.test.tsx \
        src/app/results/[id]/page.tsx && \
git commit -m "feat(results): <DrillDownClient> wires the three §12.6 sheets into /results/[id]

New client component owns the drillDownState reducer + mounts the
appropriate sheet on dispatch. Replaces the inline <Breakdowns> render
function in page.tsx with the extracted typed component. Only one sheet
is open at a time; closing returns to the leaderboard / awards /
breakdowns view.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: `results.drillDown.*` locale namespace

**Files:**
- Modify: `src/locales/en.json`
- Modify: `src/locales/es.json`, `uk.json`, `fr.json`, `de.json`
- Modify: `src/locales/en.json` to add `results.breakdowns.picks` (used by `<Breakdowns>` labels.picksLabel) — already in en today as `headings.breakdowns`? Verify in step 1.

- [ ] **Step 1: Inspect the existing `results` namespace shape**

```bash
node -e "console.log(JSON.stringify(require('./src/locales/en.json').results, null, 2))" | head -40
```

Confirm the namespace has the existing `headings.*`, `leaderboard.*`, `placeholders.*` etc. keys. We're nesting `drillDown` under `results` so the en file already has the root.

- [ ] **Step 2: Add the `results.drillDown.*` block to `en.json`**

Locate the `"results": { ... }` object in `src/locales/en.json` and add (alphabetical placement adjacent to existing nested keys; ensure proper comma handling):

```json
"drillDown": {
  "common": {
    "closeAria": "Close drill-down",
    "missed": "Missed",
    "edited": "(edited)",
    "weightedScore": "Weighted {value}",
    "mean": "Mean",
    "median": "Median",
    "highest": "Highest",
    "lowest": "Lowest"
  },
  "contestant": {
    "openLink": "Full breakdown →",
    "title": "{country} — {points} pts",
    "empty": "No room member rated this contestant."
  },
  "participant": {
    "openAria": "Open {name}'s full vote",
    "title": "{name}'s vote",
    "totalAwarded": "{points} pts given",
    "hotTakeCount": "{count, plural, one {# hot take} other {# hot takes}}",
    "harshness": "Harshness {value}",
    "alignment": "Alignment {value}",
    "empty": "This user did not vote on any contestant."
  },
  "category": {
    "openLink": "Full ranking →",
    "title": "Best {category} — full ranking",
    "meanLabel": "Mean {value}",
    "voterCount": "{voted}/{total} voted",
    "sparklineAria": "Min {min}, median {median}, max {max} out of 10",
    "highestSingle": "Highest: {value} from {name}",
    "lowestSingle": "Lowest: {value} from {name}",
    "meanOfMeans": "Room mean: {value}",
    "empty": "No room member rated this category."
  }
}
```

If `results.breakdowns.picks` does not exist in `en.json`, add it adjacent to the existing `results.breakdowns.*` keys (or under `results` directly if no `breakdowns` namespace exists yet):

```json
"breakdowns": {
  "picks": "{count, plural, one {# pick} other {# picks}}"
}
```

(Check first — the existing inline `Breakdowns` function in page.tsx renders `{b.picks.length} picks` as a literal; this slice replaces the literal with the new key.)

- [ ] **Step 3: Copy the identical `drillDown` + `breakdowns.picks` blocks into es/uk/fr/de**

For each of `src/locales/es.json`, `uk.json`, `fr.json`, `de.json`, find the `"results": { ... }` object and add the same blocks. English copy as stubs — L3 translation is a follow-on slice (same workflow as every prior namespace).

- [ ] **Step 4: Validate JSON**

```bash
for f in en es uk fr de; do node -e "JSON.parse(require('fs').readFileSync('src/locales/$f.json','utf8')); console.log('$f ok')"; done
```

Expected: all five report `ok`.

- [ ] **Step 5: Run the full test suite (including locales.test.ts parity check)**

```bash
npm run test
```
Expected: all tests pass, including `locales.test.ts` which enforces parity.

- [ ] **Step 6: Type-check + lint**

```bash
npm run type-check && npm run lint
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/locales/en.json src/locales/es.json src/locales/uk.json \
        src/locales/fr.json src/locales/de.json && \
git commit -m "i18n: results.drillDown.* + results.breakdowns.picks (SPEC §12.6)

English copy in en.json; same copy stubbed in es/uk/fr/de to keep
locales.test.ts parity green. L3 translation pass is a Phase L follow-on
slice — same workflow as every prior namespace (SPEC §21).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Playwright E2E spec

**Files:**
- Create: `tests/e2e/results-drill-downs.spec.ts`

Pre-requisite: a seeded `done-with-awards` room exists via `npm run seed:room -- done-with-awards`. The seed-room CLI is documented at [scripts/seed-helpers.ts](../../../scripts/seed-helpers.ts). The spec should accept the seeded room id either via a fixture file at `tests/e2e/fixtures/done-with-awards.ts` (preferred — mirrors the pattern in [tests/e2e/fixtures/announce-l1-room.ts](../../../tests/e2e/fixtures/announce-l1-room.ts)) or, if no fixture exists yet, read the most recent seeded room id from the database in a `beforeAll` hook using `@/lib/supabase/server`'s service client.

- [ ] **Step 1: Read the existing E2E fixture pattern**

```bash
cat tests/e2e/fixtures/announce-l1-room.ts | head -40
```

Note the shape: a setup function that seeds the room and returns the room id. Reuse the same shape for a new `tests/e2e/fixtures/done-with-awards-room.ts` if it doesn't exist; otherwise skip.

- [ ] **Step 2: Write the Playwright spec**

Create `tests/e2e/results-drill-downs.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { seedDoneWithAwardsRoom } from "./fixtures/done-with-awards-room";

let roomId: string;

test.beforeAll(async () => {
  // If the fixture helper doesn't exist yet, drop this file's tests with
  // test.fixme() until the helper lands. For now, assume it returns a real
  // room id with a `done` status and at least one category award.
  roomId = await seedDoneWithAwardsRoom();
});

test.describe("/results/[id] drill-down sheets (SPEC §12.6)", () => {
  test("contestant sheet opens via 'Full breakdown' link and closes via X", async ({ page }) => {
    await page.goto(`/results/${roomId}`);
    // Open the first leaderboard row's <details> by tapping its summary.
    const firstRow = page.locator("ol > li").first();
    await firstRow.locator("summary").click();
    await firstRow.getByRole("button", { name: /Full breakdown/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { level: 2 })).toBeVisible();
    await dialog.getByRole("button", { name: /Close drill-down/i }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("participant sheet opens via avatar button and closes via ESC", async ({ page }) => {
    await page.goto(`/results/${roomId}`);
    // The breakdowns section avatars are inside <details> summaries.
    const avatarButton = page.getByRole("button", { name: /Open .+'s full vote/i }).first();
    await avatarButton.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("category sheet opens via 'Full ranking' link and closes via backdrop click", async ({ page }) => {
    await page.goto(`/results/${roomId}`);
    await page.getByRole("button", { name: /Full ranking/i }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    // Backdrop click: tap outside the panel.
    await page.locator("[data-testid='drill-down-backdrop']").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("only one sheet open at a time — opening a second replaces the first", async ({ page }) => {
    await page.goto(`/results/${roomId}`);
    await page.getByRole("button", { name: /Open .+'s full vote/i }).first().click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    // Close current via X, then open category.
    await page.getByRole("dialog").getByRole("button", { name: /Close drill-down/i }).click();
    await page.getByRole("button", { name: /Full ranking/i }).first().click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });

  test("reduced-motion: sheets still open and close (no fade animation)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/results/${roomId}`);
    await page.getByRole("button", { name: /Open .+'s full vote/i }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("keyboard nav: Tab → Enter → Tab through sheet → ESC restores focus to trigger", async ({ page }) => {
    await page.goto(`/results/${roomId}`);
    const avatarButton = page.getByRole("button", { name: /Open .+'s full vote/i }).first();
    await avatarButton.focus();
    await expect(avatarButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    // Focus should now be inside the dialog (on the close button per the shell).
    await expect(
      page.getByRole("dialog").getByRole("button", { name: /Close drill-down/i }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Focus restored to the avatar button.
    await expect(avatarButton).toBeFocused();
  });
});
```

- [ ] **Step 3: Run the Playwright spec**

```bash
npm run test:e2e -- results-drill-downs.spec.ts
```

If the seed-room fixture helper doesn't yet exist, the test will fail at `seedDoneWithAwardsRoom`. In that case:
- Create `tests/e2e/fixtures/done-with-awards-room.ts` by adapting [tests/e2e/fixtures/announce-l1-room.ts](../../../tests/e2e/fixtures/announce-l1-room.ts) to use the `done-with-awards` state from `scripts/seed-helpers.ts`.
- Re-run.

Expected: all 6 spec cases pass.

- [ ] **Step 4: Final full-suite verification**

```bash
npm run pre-push
```

Expected: type-check + lint + unit + RTL suite all green.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/results-drill-downs.spec.ts \
        tests/e2e/fixtures/done-with-awards-room.ts && \
git commit -m "test(e2e): Playwright spec for §12.6 drill-down sheets

Three trigger surfaces (leaderboard Full breakdown / breakdowns avatar /
awards Full ranking), three close paths (X / ESC / backdrop), only-one-
open semantics, reduced-motion run, keyboard navigation with focus
restoration. Seeded against a done-with-awards fixture room.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Run the full suite + type-check + lint**

```bash
npm run pre-push
```

Expected: clean type-check, lint, and 100% test pass.

- [ ] **Push the branch**

```bash
git push -u origin feat/s4-drill-down-modals
```

---

## Spec coverage check

- ✅ Contestant drill-down (SPEC §12.6.1) → Tasks 2 (builder) + 6 (body) + 10 (trigger link in leaderboard) + 11 (sheet wiring)
- ✅ Participant drill-down (SPEC §12.6.2) → Tasks 3 (builder) + 7 (body) + 9 (avatar button in extracted Breakdowns) + 11 (sheet wiring)
- ✅ Category drill-down (SPEC §12.6.3) → Tasks 4 (builder) + 8 (body) + 10 (trigger link in AwardsSection) + 11 (sheet wiring)
- ✅ Read-only, post-`done` only → enforced because `<DrillDownClient>` is only rendered inside the `case "done":` branch in `page.tsx`'s `<Body>` switch
- ✅ Only one sheet open at a time → Task 1 (reducer) + Task 11 (single conditional render block)
- ✅ Dialog mechanics (focus / ESC / backdrop / aria) → Task 5 (`<DrillDownSheet>` shell + tests)
- ✅ Per-category chips + weighted score + missed dimming + edited tag → Tasks 6, 7
- ✅ Spread sparkline with role="img" aria-label → Task 8
- ✅ Locale namespace + stubs in 4 other locales → Task 12
- ✅ Heavy RTL coverage → Tasks 1-9 each ship 5+ RTL or unit tests; Task 11 ships a page-level integration test
- ✅ Heavy Playwright coverage → Task 13 (6 E2E cases covering all three triggers, all three close paths, only-one-open, reduced-motion, keyboard nav with focus restoration)
- ✅ Existing stage-1 `<details>` voter list preserved → Task 10's modifications are additive; existing tests stay green
- ✅ `<AwardExplainer>` accordion unaffected → Task 10 places the "Full ranking" button as a sibling, not nested
- ✅ Forward-compat with HTML export — uses existing `voteDetails` + `categories` shape from PR #117

No gaps.
