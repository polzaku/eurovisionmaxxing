# PR A — Short live reveal foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the server-only foundation of the short live reveal mode (R4 §10.2.2). Schema, types, helper, and orchestrator changes — no UI surfaces. Settable only via direct DB write at end of PR.

**Architecture:** New `rooms.announcement_style` column (`'full' | 'short'`, default `'full'`). New pure helper `autoBatchShortStyle.ts` decides which result rows auto-reveal at turn-start. Existing `runScoring` (first turn) and `advanceAnnouncement` (rotation + batch-reveal-mode) gain a `style === 'short'` branch that fires the auto-batch and broadcasts a new `score_batch_revealed` realtime event.

**Tech Stack:** TypeScript, Vitest, Supabase Postgres + Broadcast Realtime. No new dependencies.

**Spec of record:** SPEC §10.2.2 (product behaviour) + this PR's design doc `docs/superpowers/specs/2026-05-11-r4-short-live-reveal-foundation-design.md` (implementation tactics).

---

### Task 1: Fix SPEC §10.2.2 typos

**Files:**
- Modify: `SPEC.md` (lines 989, 996, surface table line 1008)

- [ ] **Step 1: Read SPEC.md lines 985–1010 to confirm exact strings**

Run: `Grep "ranks 1.8 + 10\|eight contestants\|8 rows shifting" /Users/valeriiakulynych/Projects/eurovisionmaxxing/SPEC.md -n`

- [ ] **Step 2: Edit line 989**

Replace `**ranks 1–8 and 10 are added to the scoreboard automatically**` with `**points 1–8 and 10 are added to the scoreboard automatically**`.

Also fix the surrounding sentence on line 989: `ranks 1–8 and 10` → `points 1–8 and 10`. (Two occurrences if the prose phrases it twice.)

- [ ] **Step 3: Edit line 996**

Replace `(a single batch UPDATE, broadcast as one score_update event with all eight contestants in the payload)` with `(a single batch UPDATE, broadcast as one score_batch_revealed event with all nine contestants in the payload)`. The event-type rename anticipates PR A's new event variant.

- [ ] **Step 4: Edit line 1008 (Other guests' phones surface)**

Replace `Compact live leaderboard updates inline (8 rows shifting)` with `Compact live leaderboard updates inline (9 rows shifting)`.

- [ ] **Step 5: Edit any other "ranks 1–8 + 10" occurrences in §10.2.2**

Run: `Grep "rank.*1.8.*10\|1.8.*10.*rank" SPEC.md -n` to catch siblings.

Also check the edge-cases bullet on line 1018 (`their 1–8+10 still go to the scoreboard`) — that's correct as point values; leave it but verify wording reads as point values not personal ranks. If ambiguous, replace `1–8+10` with `their points-1-through-8 and 10` or similar.

- [ ] **Step 6: Run type-check (no code changes, sanity only)**

Run: `npm run type-check`
Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add SPEC.md
git commit -m "docs(spec): fix §10.2.2 ranks↔points and 8↔9 typos

Pre-PR-A cleanup. \`results.rank\` in this codebase is the user's
personal ranking (rank 1 = #1 pick = 12pt), so the spec phrase
\"ranks 1–8 + 10\" mis-named the point values 1, 2, 3, 4, 5, 6, 7, 8,
10 (nine distinct values). The auto-batch under short style covers
nine contestants, not eight. PR A implements the corrected reading."
```

---

### Task 2: Schema column + migration SQL

**Files:**
- Modify: `supabase/schema.sql`
- Create: `supabase/migrations/2026-05-11-add-announcement-style.sql`

- [ ] **Step 1: Read existing schema.sql to locate the `rooms` table CREATE block**

Run: `Grep "CREATE TABLE rooms\|announcement_mode\|batch_reveal_mode" supabase/schema.sql -n`

- [ ] **Step 2: Add column to schema.sql `rooms` block**

After the `announcement_mode` column declaration in `CREATE TABLE rooms (...)`, insert:

```sql
  announcement_style    VARCHAR(5) NOT NULL DEFAULT 'full'
                          CHECK (announcement_style IN ('full','short')),
```

The comment from SPEC §13 belongs in the dedicated `COMMENT ON COLUMN` block (Step 3) — not inline in the CREATE TABLE.

- [ ] **Step 3: Add `COMMENT ON COLUMN`**

Below the `rooms` CREATE TABLE, alongside other `COMMENT ON COLUMN rooms.*` statements:

```sql
COMMENT ON COLUMN rooms.announcement_style IS
  'SPEC §10.2.2 — short compresses live reveal to a single 12-point tap per user; ignored when announcement_mode = instant';
```

- [ ] **Step 4: Create the migration file**

Write `supabase/migrations/2026-05-11-add-announcement-style.sql`:

```sql
-- SPEC §10.2.2 — short live reveal mode foundation (R4 PR A)
-- Operator: run this in the Supabase SQL Editor after the PR merges.

ALTER TABLE rooms
  ADD COLUMN announcement_style VARCHAR(5) NOT NULL DEFAULT 'full'
    CHECK (announcement_style IN ('full', 'short'));

COMMENT ON COLUMN rooms.announcement_style IS
  'SPEC §10.2.2 — short compresses live reveal to a single 12-point tap per user; ignored when announcement_mode = instant';
```

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql supabase/migrations/2026-05-11-add-announcement-style.sql
git commit -m "feat(schema): add rooms.announcement_style column (R4 §10.2.2)

Foundation for short live reveal mode (PR A of 3). 'full' default
preserves today's 10-step live reveal; 'short' compresses to the
single 12-point tap per user described in SPEC §10.2.2.

Column ignored when announcement_mode = 'instant'.

Operator runs the migration in supabase/migrations/ after merge."
```

---

### Task 3: Type extensions

**Files:**
- Modify: `src/types/database.ts` — add `announcement_style` to Row/Insert/Update
- Modify: `src/types/index.ts` — extend `Room` + add `score_batch_revealed` to `RoomEvent` union

- [ ] **Step 1: Locate the rooms Row/Insert/Update blocks in database.ts**

Run: `Grep -n "announcement_mode\|batch_reveal_mode" src/types/database.ts`

- [ ] **Step 2: Add `announcement_style` to the rooms `Row` interface**

In each of the three blocks (Row, Insert, Update), add (adjacent to `announcement_mode`):

```ts
// Row block:
announcement_style: string;

// Insert block:
announcement_style?: string;

// Update block:
announcement_style?: string;
```

Use the same shape (`string` not literal union) that `announcement_mode` already uses — the DB driver returns string, runtime narrows.

- [ ] **Step 3: Locate the Room interface in src/types/index.ts**

Run: `Grep -n "announcementMode\|batchRevealMode\|^export interface Room" src/types/index.ts`

- [ ] **Step 4: Extend Room interface**

Add field next to `announcementMode`:

```ts
announcementStyle: 'full' | 'short';
```

- [ ] **Step 5: Add score_batch_revealed variant to RoomEvent union**

Locate the `RoomEvent` union (around line 141) and add as a new member:

```ts
| {
    type: "score_batch_revealed";
    announcingUserId: string;
    contestants: Array<{
      contestantId: string;
      points: number;
      newTotal: number;
      newRank: number;
    }>;
  }
```

- [ ] **Step 6: Run type-check**

Run: `npm run type-check`
Expected: errors only in code that doesn't yet handle the new variant or read the new field — those are addressed in subsequent tasks. If errors appear in unrelated places, stop and investigate before proceeding.

- [ ] **Step 7: Commit**

```bash
git add src/types/database.ts src/types/index.ts
git commit -m "feat(types): announcement_style + score_batch_revealed RoomEvent (R4 §10.2.2)

Type-only changes for the short live reveal foundation. The new
realtime variant is a discriminated multi-row payload so subscribers
that don't care about the batch (e.g. instant-mode pages) ignore it
via switch-exhaustiveness.

Read/write plumbing in subsequent commits."
```

---

### Task 4: Read/write plumbing for announcement_style

**Files:**
- Modify: `src/lib/rooms/get.ts` — SELECT and map `announcement_style` into `Room`
- Modify: `src/lib/rooms/create.ts` — accept optional `announcementStyle`, INSERT it
- Modify: `src/lib/rooms/updateAnnouncementMode.ts` — accept optional `announcementStyle` in the patch (validation only; no UI yet)
- Modify: `src/lib/rooms/get.test.ts` — assert announcementStyle round-trips
- Modify: `src/lib/rooms/create.test.ts` — assert default 'full' on create; assert 'short' passes through

- [ ] **Step 1: Read get.ts to find the SELECT projection and parseRoomFromDb (or equivalent)**

Run: `Read /Users/valeriiakulynych/Projects/eurovisionmaxxing/src/lib/rooms/get.ts`

- [ ] **Step 2: Add `announcement_style` to the SELECT string in get.ts**

In the `.select("...")` call inside `getRoom`, append `announcement_style` to the projection (alongside `announcement_mode`).

- [ ] **Step 3: Map announcement_style into the Room return value**

Wherever the SELECT result is mapped to the `Room` shape, add:

```ts
announcementStyle: (raw.announcement_style === 'short' ? 'short' : 'full') as 'full' | 'short',
```

Defensive narrow: anything that's not literally `'short'` is treated as `'full'`. Future DB-side CHECK keeps this honest.

- [ ] **Step 4: Read create.ts to find the input shape and INSERT call**

Run: `Read /Users/valeriiakulynych/Projects/eurovisionmaxxing/src/lib/rooms/create.ts`

- [ ] **Step 5: Extend the create input + INSERT payload**

In `create.ts`'s input type, add optional field:

```ts
announcementStyle?: 'full' | 'short';
```

In the INSERT object (around the existing `announcement_mode` mapping), add:

```ts
announcement_style: input.announcementStyle ?? 'full',
```

When `announcement_mode === 'instant'` the column is ignored at runtime, but we still write the user's choice (so an admin who configured short + instant, then later flipped to live, gets short).

- [ ] **Step 6: Read updateAnnouncementMode.ts and extend it**

Run: `Read /Users/valeriiakulynych/Projects/eurovisionmaxxing/src/lib/rooms/updateAnnouncementMode.ts`

Extend the input type with optional `announcementStyle?: 'full' | 'short'`. Validate (it's one of those two, or undefined). In the UPDATE patch, include `announcement_style` when present.

This function is the lobby-edit path; PR C wires the UI through it. PR A only adds the validation + UPDATE plumbing.

- [ ] **Step 7: Write get.test.ts case**

Add a test that asserts `getRoom` returns `announcementStyle: 'short'` when the DB row has `announcement_style: 'short'`, and `'full'` otherwise (including for malformed values like null or unknown strings — defensive narrow).

- [ ] **Step 8: Write create.test.ts cases**

Add: (a) `createRoom` with no `announcementStyle` defaults to `'full'`. (b) Passing `'short'` round-trips into the INSERT call's payload.

- [ ] **Step 9: Run tests + type-check**

Run: `npm run test -- src/lib/rooms/get.test.ts src/lib/rooms/create.test.ts src/lib/rooms/updateAnnouncementMode.test.ts && npm run type-check`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add src/lib/rooms/get.ts src/lib/rooms/create.ts src/lib/rooms/updateAnnouncementMode.ts src/lib/rooms/get.test.ts src/lib/rooms/create.test.ts
git commit -m "feat(rooms): plumb announcement_style through read/write (R4 §10.2.2)

getRoom returns announcementStyle ('full' fallback), createRoom
accepts an optional announcementStyle (defaults 'full'), and
updateAnnouncementMode accepts a patch field for lobby-edit
(consumed by PR C). Defensive narrow on read so legacy rows with
NULL or unknown values fall back to 'full' at the type boundary.

Server orchestrator wiring lands in subsequent commits."
```

---

### Task 5: Auto-batch helper + unit tests

**Files:**
- Create: `src/lib/rooms/autoBatchShortStyle.ts`
- Create: `src/lib/rooms/autoBatchShortStyle.test.ts`

- [ ] **Step 1: Read advanceAnnouncement.ts lines 73–84 to import the AnnouncerResultRow shape**

The helper imports the existing internal type; if the type isn't exported, export it from `advanceAnnouncement.ts` first (rename to `export type AnnouncerResultRow`).

- [ ] **Step 2: Write failing tests in autoBatchShortStyle.test.ts**

```ts
import { describe, it, expect } from "vitest";
import {
  selectShortBatchRows,
  twelvePointIdx,
} from "./autoBatchShortStyle";

const fullQueue = [
  { contestant_id: "c10", points_awarded: 1, rank: 10, announced: false },
  { contestant_id: "c9",  points_awarded: 2, rank: 9,  announced: false },
  { contestant_id: "c8",  points_awarded: 3, rank: 8,  announced: false },
  { contestant_id: "c7",  points_awarded: 4, rank: 7,  announced: false },
  { contestant_id: "c6",  points_awarded: 5, rank: 6,  announced: false },
  { contestant_id: "c5",  points_awarded: 6, rank: 5,  announced: false },
  { contestant_id: "c4",  points_awarded: 7, rank: 4,  announced: false },
  { contestant_id: "c3",  points_awarded: 8, rank: 3,  announced: false },
  { contestant_id: "c2",  points_awarded: 10, rank: 2, announced: false },
  { contestant_id: "c1",  points_awarded: 12, rank: 1, announced: false },
];

describe("selectShortBatchRows", () => {
  it("returns the 9 non-rank-1 rows from a full 10-row queue", () => {
    const batch = selectShortBatchRows(fullQueue);
    expect(batch).toHaveLength(9);
    expect(batch.every((r) => r.rank !== 1)).toBe(true);
    // The 12-point row (rank 1) is excluded.
    expect(batch.find((r) => r.points_awarded === 12)).toBeUndefined();
  });

  it("returns all rows when no rank-1 exists (degenerate)", () => {
    const noTwelve = fullQueue.filter((r) => r.rank !== 1);
    expect(selectShortBatchRows(noTwelve)).toEqual(noTwelve);
  });

  it("returns empty array for empty input", () => {
    expect(selectShortBatchRows([])).toEqual([]);
  });

  it("handles short queues (< 10 rows) — batches everything except rank 1", () => {
    const short = fullQueue.slice(-5); // top 5 = ranks 1–5
    const batch = selectShortBatchRows(short);
    expect(batch).toHaveLength(4);
    expect(batch.every((r) => r.rank !== 1)).toBe(true);
  });
});

describe("twelvePointIdx", () => {
  it("returns the index of the rank-1 row", () => {
    expect(twelvePointIdx(fullQueue)).toBe(9);
  });

  it("returns null when no rank-1 row exists", () => {
    const noTwelve = fullQueue.filter((r) => r.rank !== 1);
    expect(twelvePointIdx(noTwelve)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(twelvePointIdx([])).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests, confirm they fail (file does not exist)**

Run: `npx vitest run src/lib/rooms/autoBatchShortStyle.test.ts`
Expected: FAIL (file not found).

- [ ] **Step 4: Implement autoBatchShortStyle.ts**

```ts
import type { AnnouncerResultRow } from "./advanceAnnouncement";

/**
 * SPEC §10.2.2: under announcement_style = 'short', when a turn begins
 * the server auto-reveals every points row except the 12-point pick
 * (rank = 1). This helper computes "which rows to auto-batch" — the
 * orchestrator does the UPDATE + broadcast.
 */
export function selectShortBatchRows(
  announcerRows: AnnouncerResultRow[],
): AnnouncerResultRow[] {
  return announcerRows.filter((r) => r.rank !== 1);
}

/**
 * Position of the rank-1 (12-point) row inside the announcer's queue,
 * sorted rank DESC so idx 0 = 1pt and idx 9 = 12pt. The orchestrator
 * sets current_announce_idx to this value after the auto-batch so the
 * next advance call reveals only the 12-point row.
 *
 * Returns null when no rank-1 row exists (degenerate; the orchestrator
 * handles it by skipping the auto-batch entirely).
 */
export function twelvePointIdx(
  announcerRows: AnnouncerResultRow[],
): number | null {
  const idx = announcerRows.findIndex((r) => r.rank === 1);
  return idx === -1 ? null : idx;
}
```

- [ ] **Step 5: Run tests, confirm they pass**

Run: `npx vitest run src/lib/rooms/autoBatchShortStyle.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/rooms/autoBatchShortStyle.ts src/lib/rooms/autoBatchShortStyle.test.ts
git commit -m "feat(rooms): autoBatchShortStyle pure helper (R4 §10.2.2)

Two pure functions used by runScoring (first turn) and
advanceAnnouncement (rotation) to compute the 9 auto-batched rows
and the 12-point row's index for short-style turns. No I/O — the
orchestrator does the UPDATE + broadcast.

8 unit tests cover full queue, degenerate no-rank-1, empty input,
and short queues with < 10 rows."
```

---

### Task 6: runScoring first-turn auto-batch

**Files:**
- Modify: `src/lib/rooms/runScoring.ts`
- Modify: `src/lib/rooms/runScoring.test.ts`

- [ ] **Step 1: Read runScoring.ts lines 340–495 to confirm the post-transition flow**

(Already mapped in this plan's preamble. Re-read to confirm exact line numbers and the broadcast block at 481–491.)

- [ ] **Step 2: Load the `announcement_style` column in the initial room SELECT**

Find the existing room SELECT in `runScoring.ts` (it reads `announcement_mode`, `batch_reveal_mode`, etc.). Add `announcement_style` to the projection.

- [ ] **Step 3: Add short-style auto-batch logic after the `toAnnouncing` UPDATE commits**

After `toAnnouncing` commits successfully (line ~439) and the existing `preSkipped` broadcasts (lines 452–479) fire, BUT before the `status_changed` broadcast (line 481):

```ts
// SPEC §10.2.2 — under live + short, the first present announcer's
// rank-2-through-10 rows auto-reveal at turn start, leaving only the
// rank-1 (12-point) row pending. Skipped when no announcer chosen
// (cascade-exhausted) or style is 'full'.
if (
  room.announcement_mode === "live" &&
  room.announcement_style === "short" &&
  announcingPatch.announcing_user_id
) {
  const firstAnnouncerId = announcingPatch.announcing_user_id;

  // Load the announcer's reveal queue, sorted rank DESC (idx 0 = 1pt).
  const queueQuery = await deps.supabase
    .from("results")
    .select("contestant_id, points_awarded, rank, announced")
    .eq("room_id", roomId)
    .eq("user_id", firstAnnouncerId)
    .gt("points_awarded", 0)
    .order("rank", { ascending: false });

  if (queueQuery.error) {
    return fail(
      "INTERNAL_ERROR",
      "Could not load reveal queue for short-style auto-batch.",
      500,
    );
  }
  const queueRows = (queueQuery.data ?? []) as AnnouncerResultRow[];
  const batchRows = selectShortBatchRows(queueRows);
  const twelveIdx = twelvePointIdx(queueRows);

  if (batchRows.length > 0 && twelveIdx !== null) {
    // Mark all 9 rows as announced in a single UPDATE.
    const batchIds = batchRows.map((r) => r.contestant_id);
    const markBatch = await deps.supabase
      .from("results")
      .update({ announced: true })
      .eq("room_id", roomId)
      .eq("user_id", firstAnnouncerId)
      .in("contestant_id", batchIds);

    if (markBatch.error) {
      return fail(
        "INTERNAL_ERROR",
        "Could not mark short-style auto-batch rows.",
        500,
      );
    }

    // Move current_announce_idx to the 12-point row's position.
    const updateIdx = await deps.supabase
      .from("rooms")
      .update({ current_announce_idx: twelveIdx })
      .eq("id", roomId)
      .eq("status", "announcing")
      .eq("announcing_user_id", firstAnnouncerId)
      .eq("current_announce_idx", 0);

    if (updateIdx.error) {
      return fail(
        "INTERNAL_ERROR",
        "Could not advance index past auto-batch.",
        500,
      );
    }

    // Build the broadcast payload from the post-batch leaderboard.
    const leaderboardQuery = await deps.supabase
      .from("results")
      .select("contestant_id, points_awarded, announced")
      .eq("room_id", roomId);

    const broadcastContestants = buildBatchBroadcastPayload(
      batchRows,
      leaderboardQuery.data ?? [],
    );

    try {
      await deps.broadcastRoomEvent(roomId, {
        type: "score_batch_revealed",
        announcingUserId: firstAnnouncerId,
        contestants: broadcastContestants,
      });
    } catch (err) {
      console.warn(
        `broadcast 'score_batch_revealed' failed for room ${roomId}; state committed regardless:`,
        err,
      );
    }
  }
}
```

`buildBatchBroadcastPayload` is a small inline helper (define above `runScoring`):

```ts
function buildBatchBroadcastPayload(
  batchRows: AnnouncerResultRow[],
  allResults: Array<{ contestant_id: string; points_awarded: number; announced: boolean }>,
): Array<{ contestantId: string; points: number; newTotal: number; newRank: number }> {
  const totals = new Map<string, number>();
  for (const r of allResults) {
    if (!r.announced) continue;
    totals.set(r.contestant_id, (totals.get(r.contestant_id) ?? 0) + r.points_awarded);
  }
  // Competition ranking — sort distinct totals descending, then look up each row's rank.
  const distinctSorted = [...new Set(totals.values())].sort((a, b) => b - a);
  return batchRows.map((r) => {
    const total = totals.get(r.contestant_id) ?? r.points_awarded;
    let rank = 1;
    for (const v of distinctSorted) {
      if (v > total) rank += 1;
      else break;
    }
    return {
      contestantId: r.contestant_id,
      points: r.points_awarded,
      newTotal: total,
      newRank: rank,
    };
  });
}
```

- [ ] **Step 4: Import the new helpers**

At the top of `runScoring.ts`:

```ts
import {
  selectShortBatchRows,
  twelvePointIdx,
} from "./autoBatchShortStyle";
import type { AnnouncerResultRow } from "./advanceAnnouncement";
```

(If `AnnouncerResultRow` isn't exported yet, export it from `advanceAnnouncement.ts` in this commit.)

- [ ] **Step 5: Write the test cases**

In `runScoring.test.ts`, add a new `describe("short-style auto-batch (SPEC §10.2.2)", ...)` block with:

- **Case A:** `announcement_mode: 'live'`, `announcement_style: 'short'`, all users present. Assert: (1) the first announcer's 9 non-rank-1 result rows have `announced=true` after the call; (2) `current_announce_idx` is set to the 12-point row's index (== 9 for a full 10-row queue); (3) the `score_batch_revealed` broadcast fired with exactly 9 contestants.
- **Case B:** `announcement_mode: 'live'`, `announcement_style: 'short'`, all users absent (cascade exhausts). Assert: no auto-batch fires (no rows are marked), no `score_batch_revealed` broadcast.
- **Case C:** `announcement_mode: 'live'`, `announcement_style: 'full'` (control). Assert: no auto-batch fires; existing behaviour unchanged.
- **Case D:** `announcement_mode: 'instant'`, `announcement_style: 'short'`. Per spec, short is ignored under instant. Assert: no auto-batch.

Use existing test fixtures and mock `broadcastRoomEvent` to capture calls.

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/lib/rooms/runScoring.test.ts`
Expected: all green (existing + 4 new cases).

- [ ] **Step 7: Run type-check + lint**

Run: `npm run type-check && npm run lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/rooms/runScoring.ts src/lib/rooms/runScoring.test.ts src/lib/rooms/advanceAnnouncement.ts
git commit -m "feat(scoring): first-turn auto-batch under live + short style (R4 §10.2.2)

When runScoring transitions a live + short room to 'announcing' and
picks a present first announcer, fire the auto-batch immediately:
mark the 9 non-rank-1 result rows announced=true, advance
current_announce_idx to the 12-point row, broadcast a single
score_batch_revealed event. Guards: instant mode ignores
announcement_style; cascade-exhausted (no announcer) skips the batch.

Exports AnnouncerResultRow from advanceAnnouncement so the helper +
runScoring share the type."
```

---

### Task 7: advanceAnnouncement rotation + batch-reveal short branches

**Files:**
- Modify: `src/lib/rooms/advanceAnnouncement.ts`
- Modify: `src/lib/rooms/advanceAnnouncement.test.ts`

- [ ] **Step 1: Re-read advanceAnnouncement.ts to confirm structure**

Run: `Read /Users/valeriiakulynych/Projects/eurovisionmaxxing/src/lib/rooms/advanceAnnouncement.ts`

The key points:
- Lines 61–71 — `RoomRow` type. Add `announcement_style: string` here.
- Lines 126–132 — initial room SELECT. Add `announcement_style` to the projection.
- Lines 233–339 — `isLastForAnnouncer` branch. The rotation logic. Both branches (`batch_reveal_mode` and non-batch) end with `nextAnnouncingUserId` set.
- Lines 341–392 — room UPDATE.
- Lines 426–494 — broadcasts.

- [ ] **Step 2: Add `announcement_style` to RoomRow and SELECT**

In the RoomRow type, append:
```ts
announcement_style: string;
```

In the room SELECT projection (line 128), append `, announcement_style` to the string.

- [ ] **Step 3: Helper — load next user's queue and compute auto-batch**

After the existing rotation branches end and `nextAnnouncingUserId` is known, BEFORE the conditional room UPDATE (line 341), add:

```ts
let pendingShortRotationBatch: {
  nextUserId: string;
  batchRows: AnnouncerResultRow[];
  twelveIdx: number;
} | null = null;

if (
  room.announcement_style === "short" &&
  !room.batch_reveal_mode &&
  isLastForAnnouncer &&
  nextAnnouncingUserId !== null
) {
  // Fetch the next user's queue.
  const nextQueueQuery = await deps.supabase
    .from("results")
    .select("contestant_id, points_awarded, rank, announced")
    .eq("room_id", roomId)
    .eq("user_id", nextAnnouncingUserId)
    .gt("points_awarded", 0)
    .order("rank", { ascending: false });

  if (nextQueueQuery.error) {
    return fail(
      "INTERNAL_ERROR",
      "Could not load next announcer's queue for short auto-batch.",
      500,
    );
  }
  const nextRows = (nextQueueQuery.data ?? []) as AnnouncerResultRow[];
  const nextBatch = selectShortBatchRows(nextRows);
  const nextTwelveIdx = twelvePointIdx(nextRows);

  if (nextBatch.length > 0 && nextTwelveIdx !== null) {
    pendingShortRotationBatch = {
      nextUserId: nextAnnouncingUserId,
      batchRows: nextBatch,
      twelveIdx: nextTwelveIdx,
    };
    // Adjust the room patch to land on the 12-point idx instead of 0.
    nextIdx = nextTwelveIdx;
  }
}
```

- [ ] **Step 4: Mark auto-batch rows announced (after room UPDATE commits)**

After the conditional room UPDATE on line 386 succeeds (`updateRoom.data` exists), AND after the cascade `announce_skip` broadcasts but BEFORE the leaderboard query (line 427), insert:

```ts
if (pendingShortRotationBatch) {
  const batchIds = pendingShortRotationBatch.batchRows.map((r) => r.contestant_id);
  const markBatch = await deps.supabase
    .from("results")
    .update({ announced: true })
    .eq("room_id", roomId)
    .eq("user_id", pendingShortRotationBatch.nextUserId)
    .in("contestant_id", batchIds);

  if (markBatch.error) {
    return fail(
      "INTERNAL_ERROR",
      "Could not mark short-style rotation auto-batch.",
      500,
    );
  }
}
```

(The room's `current_announce_idx` was already set to `twelveIdx` via the existing room UPDATE because we adjusted `nextIdx` in Step 3.)

- [ ] **Step 5: Broadcast score_batch_revealed (after the existing 12-point broadcasts)**

After the existing `announce_next` + `score_update` broadcasts for the just-revealed 12-point row (current user's), AND after the `status_changed` broadcast if finishing — but before the function returns — fire:

```ts
if (pendingShortRotationBatch) {
  const leaderboard = (allResultsQuery.data ?? []) as LeaderboardRow[];
  const broadcastContestants = buildBatchBroadcastPayload(
    pendingShortRotationBatch.batchRows,
    leaderboard,
  );

  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "score_batch_revealed",
      announcingUserId: pendingShortRotationBatch.nextUserId,
      contestants: broadcastContestants,
    });
  } catch (err) {
    console.warn(
      `broadcast 'score_batch_revealed' failed for room ${roomId}; state committed regardless:`,
      err,
    );
  }
}
```

Reuse `buildBatchBroadcastPayload` — extract it to `src/lib/rooms/buildBatchBroadcastPayload.ts` (also imported by runScoring) if it's clearer than co-locating in both files. Decide based on file size after Task 6.

- [ ] **Step 6: Batch-reveal-mode + short interaction**

In the `batch_reveal_mode` branch (lines 234–276), add: when `announcement_style === 'short'`, the CURRENT user's auto-batch may not have fired yet (e.g., they were the first cascade-exhausted user). Detect by counting their `announced=false` rows on the queue we already loaded:

```ts
// Inside the batch_reveal_mode branch, BEFORE the rotation logic:
let firedBatchForCurrent = false;
if (room.announcement_style === "short") {
  // Has the current user's auto-batch fired? Check via the queue we have.
  const pendingCount = announcerRows.filter((r) => !r.announced).length;
  if (pendingCount > 1) {
    // 10 rows pending — auto-batch hasn't fired. Fire it now (before the 12pt reveal).
    const batchRows = selectShortBatchRows(announcerRows);
    if (batchRows.length > 0) {
      const batchIds = batchRows.map((r) => r.contestant_id);
      const markBatch = await deps.supabase
        .from("results")
        .update({ announced: true })
        .eq("room_id", roomId)
        .eq("user_id", currentAnnouncer)
        .in("contestant_id", batchIds);
      if (markBatch.error) {
        return fail(
          "INTERNAL_ERROR",
          "Could not mark current user's batch-reveal short auto-batch.",
          500,
        );
      }
      firedBatchForCurrent = true;
      // After firing, we want to reveal the rank-1 (12-pt) row as the
      // current advance's reveal. Override revealRow accordingly.
      const rankOneRow = announcerRows.find((r) => r.rank === 1);
      if (rankOneRow) {
        revealRow = rankOneRow;
      }
    }
  }
}
```

Then on broadcasts: after the existing 12-point broadcasts, if `firedBatchForCurrent === true`, fire a `score_batch_revealed` for the current user's batch. (Use the same payload shape.)

Note: `revealRow` must be declared `let` if it isn't already (it currently appears as `const revealRow = announcerRows[expectedIdx]` on line 207). Restructure to `let revealRow = ...` and re-assign in the batch-reveal-short path.

- [ ] **Step 7: Write the test cases**

In `advanceAnnouncement.test.ts`, add a new `describe("short-style (SPEC §10.2.2)", ...)` block with:

- **Case A:** `short` + rotation to present user. After the 12-point tap, assert: (1) next user's 9 rows marked announced; (2) `current_announce_idx` = next user's 12-point idx; (3) `announce_next` + `score_update` (for current 12pt) + `score_batch_revealed` (for next user's batch) all fire in that order.
- **Case B:** `short` + rotation with cascade — first candidate absent, second present. Assert: cascade fires `announce_skip` for absent user; auto-batch fires for second user.
- **Case C:** `short` + cascade exhausts. Assert: no auto-batch broadcast; `cascadeExhausted: true`; next user is null.
- **Case D:** `short` + batch-reveal-mode + current user has 10 pending rows (auto-batch hasn't fired). Single advance call marks 10 rows announced, fires both `announce_next` (12pt) and `score_batch_revealed` (9 rows), rotates.
- **Case E:** `short` + batch-reveal-mode + current user has 1 pending row (auto-batch already fired earlier). Single advance fires only `announce_next` (12pt), rotates.
- **Case F:** `full` (control) → existing behaviour unchanged. (Add one explicit assertion that `score_batch_revealed` is NOT broadcast.)

- [ ] **Step 8: Run tests**

Run: `npx vitest run src/lib/rooms/advanceAnnouncement.test.ts`
Expected: all green (existing + 6 new cases).

- [ ] **Step 9: Run full test suite + type-check + lint**

Run: `npm run test && npm run type-check && npm run lint`
Expected: ≥ 1559 + new tests, all green; type-check clean; lint clean.

- [ ] **Step 10: Commit**

```bash
git add src/lib/rooms/advanceAnnouncement.ts src/lib/rooms/advanceAnnouncement.test.ts
git commit -m "feat(announce): rotation + batch-reveal short-style branches (R4 §10.2.2)

advanceAnnouncement now fires the next user's auto-batch when
short-style rotation lands on a present user — 9 rows marked
announced, current_announce_idx pre-set to the 12-point row, one
score_batch_revealed broadcast.

Batch-reveal-mode + short: a single admin tap reveals both the
current user's auto-batch (if not already fired) and the 12-point
row, per SPEC §10.2.2 line 1019.

Cascade and full-style paths unchanged. 6 new test cases cover
rotation, cascade-with-rotation, cascade-exhaust, batch-mode-fresh,
batch-mode-already-fired, and the full-mode control."
```

---

## After all tasks

- [ ] Run the full pre-push check: `npm run pre-push` (type-check + lint + test)
- [ ] Push the branch — **await user approval before pushing.**
- [ ] Open the PR with the body templated against PR #99 / #100 / #101.
- [ ] PR body explicitly notes: "Operator must run `supabase/migrations/2026-05-11-add-announcement-style.sql` after merge, before PR B starts."
