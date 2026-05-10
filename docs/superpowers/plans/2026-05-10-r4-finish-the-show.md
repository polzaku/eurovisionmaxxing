# R4 "Finish the show" batch-reveal mode — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Finish the show" admin CTA + batch-reveal mode that drives the cascade-exhausted state introduced by R4 #1 to a clean show termination, revealing the points of every absent user one tap at a time.

**Architecture:** Two coordinated changes: (a) cascade refactor in `advanceAnnouncement` and `runScoring` to defer `applySingleSkip` calls until rotation outcome is known — silent-mark only when a present user is found, leave pending when cascade exhausts; (b) new `rooms.batch_reveal_mode BOOLEAN` column + `POST /finish-show` endpoint + `advanceAnnouncement` batch-reveal branch that walks `announcement_order` mechanically (no presence check), revealing each absent user's pending points until status flips to `done`.

**Tech Stack:** Next.js 14 App Router, Supabase (Postgres + Realtime), TypeScript strict, Vitest (jsdom for RTL), Playwright (chromium), `next-intl` for locale strings.

**Spec:** [docs/superpowers/specs/2026-05-10-r4-finish-the-show-design.md](../specs/2026-05-10-r4-finish-the-show-design.md)

**Branch:** `feat/r4-finish-the-show` — currently 1 commit ahead of main (spec doc, `a2fc731`). Based on main (which has R4 #1 merged via PR #95).

**Reuses helpers from R4 #1:** `isAbsent`, `applySingleSkip`, the cascade test mock helper extension pattern in `advanceAnnouncement.test.ts` (`membershipSelects`, `usersByIdSelect`, `broadcastCalls`).

---

## Task 1: Schema migration + RoomEvent variant + types refresh

**Files:**
- Modify: `supabase/schema.sql` (add column + per-migration ALTER)
- Modify: `SUPABASE_SETUP.md` (changelog)
- Modify: `src/types/database.ts` (Row/Insert/Update for `rooms`)
- Modify: `src/types/index.ts` (`RoomEvent` union)
- Modify: `src/lib/rooms/shared.ts` (`RoomEventPayload`)

- [ ] **Step 1: Add column to schema.sql `CREATE TABLE rooms` block**

Find the `CREATE TABLE IF NOT EXISTS rooms` block. Append `batch_reveal_mode` next to other room-state booleans (e.g., `allow_now_performing`):

```sql
batch_reveal_mode BOOLEAN NOT NULL DEFAULT FALSE,
```

Don't duplicate the closing `)` — patch in place.

- [ ] **Step 2: Add per-migration ALTER**

Find the existing `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS announce_skipped_user_ids` line (the R4 #1 migration). Add the new ALTER directly below it:

```sql
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS batch_reveal_mode BOOLEAN NOT NULL DEFAULT FALSE;
```

- [ ] **Step 3: Add SUPABASE_SETUP.md changelog entry**

In the changelog section (chronological, newest at top), add:

```markdown
- **2026-05-10** — Phase R4 "Finish the show": `rooms.batch_reveal_mode BOOLEAN NOT NULL DEFAULT FALSE`. Set true when an admin enters batch-reveal mode after cascade exhausts. Re-apply via SQL Editor: `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS batch_reveal_mode BOOLEAN NOT NULL DEFAULT FALSE;`
```

- [ ] **Step 4: Update `src/types/database.ts`**

Find the `rooms` Row/Insert/Update triplet. Add `batch_reveal_mode: boolean` to Row, `batch_reveal_mode?: boolean` to Insert and Update. Mirror the shape of existing booleans like `allow_now_performing`.

- [ ] **Step 5: Add `batch_reveal_started` to `RoomEvent` and `RoomEventPayload`**

In `src/types/index.ts`, find the `RoomEvent` union (around line 140-160) and add a new variant alongside `announce_skip`:

```ts
| { type: "batch_reveal_started"; announcingUserId: string; displayName: string }
```

In `src/lib/rooms/shared.ts`, find the `RoomEventPayload` union and add the same variant. Place it next to `announce_skip` for grouping.

- [ ] **Step 5b: Add `batchRevealMode` to the domain `Room` interface + `mapRoom`**

In `src/types/index.ts`, find the `Room` interface (look for the existing camelCase fields like `announcingUserId`, `currentAnnounceIdx`). Add:

```ts
batchRevealMode: boolean;
```

In `src/lib/rooms/shared.ts`, find the `mapRoom(row: RoomRow): Room` function that maps DB row to domain Room. Add the mapping:

```ts
batchRevealMode: row.batch_reveal_mode,
```

(Place it next to existing boolean field mappings like `allowNowPerforming`.)

- [ ] **Step 6: Type-check passes**

Run: `npm run type-check`
Expected: no errors. The schema additions are additive.

- [ ] **Step 7: Commit**

```bash
git add supabase/schema.sql SUPABASE_SETUP.md src/types/database.ts src/types/index.ts src/lib/rooms/shared.ts
git commit -m "feat(schema): R4 — rooms.batch_reveal_mode + batch_reveal_started event (R4 #2)

batch_reveal_mode flags the post-Finish-the-show state. The cascade
in advanceAnnouncement short-circuits when true; rotation walks
announcement_order mechanically. New batch_reveal_started RoomEvent
fires when the admin transitions cascade-exhausted → batch-reveal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: advanceAnnouncement cascade refactor — probe-then-mark (TDD)

**Why:** Today's cascade calls `applySingleSkip` inside the probe loop, silent-marking results immediately. The refactor moves the call to **after** the loop, in the "found present user" branch only. The "exhausted" branch leaves results pending for batch reveal.

**Files:**
- Modify: `src/lib/rooms/advanceAnnouncement.ts` (the cascade loop, lines ~232–289)
- Modify: `src/lib/rooms/advanceAnnouncement.test.ts` (existing cascade-exhaust tests need their assertions updated; one new test verifying `applySingleSkip` is **not** called on exhaust)

- [ ] **Step 1: Read the existing test cases for the cascade**

Open `src/lib/rooms/advanceAnnouncement.test.ts`. Find the `describe("cascade-skip on rotation (SPEC §10.2.1)", ...)` block. Note:
- The 4 cascade test cases that assert behavior on rotation (single skip, cascade-3, exhausted, golden path).
- The 5th test (added in the bug fix) that asserts `applySingleSkip` errors short-circuit.
- The mock's `resultsUpdateCalls` spy is what catches `applySingleSkip` invocations (each call does an UPDATE on `results`).

Existing assertions like `expect(mock.resultsUpdateCalls).toHaveLength(N)` need adjustment for the cascade-exhaust case (where N becomes 0).

- [ ] **Step 2: Write the failing test for the new behavior**

Add a new test inside the `describe("cascade-skip on rotation (SPEC §10.2.1)", ...)` block:

```ts
    it("does NOT call applySingleSkip when cascade exhausts (preserves pending for batch reveal)", async () => {
      const mock = makeSupabaseMock({
        roomSelect: {
          data: {
            id: VALID_ROOM_ID,
            status: "announcing",
            owner_user_id: OWNER_ID,
            announcement_order: [U1, U2, U3],
            announcing_user_id: U1,
            current_announce_idx: 0,
            delegate_user_id: null,
            announce_skipped_user_ids: [],
          },
          error: null,
        },
        announcerResults: {
          data: [
            { contestant_id: "c1", points_awarded: 12, rank: 1, announced: false },
          ],
          error: null,
        },
        membershipSelects: [
          { data: { last_seen_at: STALE }, error: null }, // U2 absent
          { data: { last_seen_at: STALE }, error: null }, // U3 absent — cascade exhausts
        ],
        usersByIdSelect: {
          data: [
            { id: U2, display_name: "Bob" },
            { id: U3, display_name: "Carol" },
          ],
          error: null,
        },
      });

      const result = await advanceAnnouncement(
        { roomId: VALID_ROOM_ID, userId: OWNER_ID },
        makeDeps(mock, { now: () => NOW }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.cascadeExhausted).toBe(true);
      expect(result.cascadedSkippedUserIds).toEqual([U2, U3]);

      // CRITICAL: applySingleSkip is NOT called for cascade-exhausted users.
      // Each applySingleSkip call would do an UPDATE on results — none should fire.
      expect(mock.resultsUpdateCalls).toHaveLength(0);

      const lastRoomUpdate = mock.roomUpdateCalls.at(-1);
      expect(lastRoomUpdate?.patch.announcing_user_id).toBeNull();
      expect(lastRoomUpdate?.patch.announce_skipped_user_ids).toEqual([U2, U3]);
    });
```

Also update the existing tests that assert `resultsUpdateCalls.toHaveLength(N)`:
- "cascades through 3 absent users and lands on the 4th present" — `resultsUpdateCalls` should remain 3 (unchanged — silent-mark still fires when present user found).
- "cascade exhausts → announcing_user_id = null, status stays announcing" — change `resultsUpdateCalls` expectation from whatever it is now to **0**. Add the explicit assertion.
- "skips the next announcer if absent and rotates to the user after them" — `resultsUpdateCalls` stays 1 (unchanged — present user found).
- "does not skip when next announcer is present" — `resultsUpdateCalls` stays 0 (unchanged — no skips).
- "returns 500 + does not commit room UPDATE when applySingleSkip fails mid-cascade" — this test scripts `resultsUpdateError`. After the refactor, `applySingleSkip` is called *after* the loop, when the "found present" branch is taken. The test should still trigger the error path: U2 absent, U3 present (loop exits with U3 as nextAnnouncer), then `applySingleSkip(U2)` fails post-loop. Update `membershipSelects` to `[{ stale }, { fresh }]` and keep `resultsUpdateError`. Assert: `result.ok === false`, `error.code === 'INTERNAL_ERROR'`, room UPDATE never fires (`mock.roomUpdateCalls.length === 0`).

- [ ] **Step 3: Run tests to verify the new test fails**

Run: `npm test -- src/lib/rooms/advanceAnnouncement.test.ts 2>&1 | tail -20`
Expected: the new "does NOT call applySingleSkip when cascade exhausts" test FAILS — current code calls `applySingleSkip` per-iteration, so `resultsUpdateCalls.length === 2`. Existing tests may also fail if their length assertions don't yet match the new shape.

- [ ] **Step 4: Refactor the cascade loop**

Open `src/lib/rooms/advanceAnnouncement.ts`. Find the loop at lines 244-281 (the `while (probePos < announcers.length) { ... }` block). Replace its body so the loop only probes (push to in-memory list); move the `applySingleSkip` call to after the loop:

```ts
      while (probePos < announcers.length) {
        const candidateId = announcers[probePos];

        // Query this candidate's membership last_seen_at.
        const membershipQuery = await deps.supabase
          .from("room_memberships")
          .select("last_seen_at")
          .eq("room_id", roomId)
          .eq("user_id", candidateId)
          .maybeSingle();

        const lastSeenAt =
          membershipQuery.data?.last_seen_at ?? null;
        const absent = isAbsent(lastSeenAt as string | null, now);

        if (absent) {
          cascadedSkippedUserIds.push(candidateId);
          probePos += 1;
        } else {
          nextAnnouncingUserId = candidateId;
          nextIdx = 0;
          foundPresent = true;
          break;
        }
      }

      if (foundPresent) {
        // Silent-mark every cascaded skipped user. SPEC §10.2.1 line 967:
        // "Their points still contribute to the final leaderboard ... the
        // dramatic individual reveal is suppressed." Only fires when the
        // show is continuing — exhaust path leaves them pending for the
        // batch reveal in 'Finish the show' mode.
        for (const skippedUserId of cascadedSkippedUserIds) {
          const skipResult = await applySingleSkip(
            { roomId, skippedUserId },
            { supabase: deps.supabase },
          );
          if (!skipResult.ok) {
            return fail(skipResult.error.code, skipResult.error.message, 500);
          }
        }
      } else {
        cascadeExhausted = true;
        nextAnnouncingUserId = null;
        nextIdx = 0;
        // Do NOT silent-mark — points stay announced=false for batch reveal.
      }
```

Note: the inner-loop `if (absent) { applySingleSkip(...); cascadedSkippedUserIds.push(...) }` becomes just `cascadedSkippedUserIds.push(...)`. The `if (foundPresent) { applySingleSkip(...) }` block is new, after the loop. The `else` (exhaust) branch keeps the existing state-setting (no-op for `applySingleSkip`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/lib/rooms/advanceAnnouncement.test.ts 2>&1 | tail -20`
Expected: ALL PASS — including the new "does NOT call applySingleSkip when cascade exhausts" test.

- [ ] **Step 6: Run all rooms tests for regression**

Run: `npm test -- src/lib/rooms 2>&1 | tail -15`
Expected: ALL PASS.

- [ ] **Step 7: Type-check**

Run: `npm run type-check 2>&1 | tail -3`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/rooms/advanceAnnouncement.ts src/lib/rooms/advanceAnnouncement.test.ts
git commit -m "refactor(announce): probe-then-mark cascade — defer applySingleSkip (R4 #2)

Cascade in advanceAnnouncement now defers applySingleSkip calls until
rotation outcome is known. Found-present → silent-mark trailing
cascaded users (current line 967 behavior preserved). Exhausted →
do NOT silent-mark — results stay announced=false for the upcoming
'Finish the show' batch reveal to walk through.

Tests updated: cascade-exhaust no longer asserts applySingleSkip
calls; new test verifies resultsUpdateCalls is empty on exhaust.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: runScoring pre-cascade refactor — probe-then-mark (TDD)

**Why:** Same logic as Task 2 applied to `runScoring`'s pre-cascade at the `scoring → announcing` transition. Pre-cascade with all-absent (room enters announcing with no live user) needs to leave pending for batch reveal.

**Files:**
- Modify: `src/lib/rooms/runScoring.ts` (pre-cascade loop, lines ~371-409)
- Modify: `src/lib/rooms/runScoring.test.ts` (existing pre-cascade tests need their assertions updated; one new test verifying `applySingleSkip` is not called on exhaust)

- [ ] **Step 1: Read the existing pre-cascade tests**

Open `src/lib/rooms/runScoring.test.ts`. Find the pre-cascade `describe` block (added in R4 #1). Note:
- "skips the first 2 absent → lands on order[2]" — present user found.
- "all absent → announcing_user_id null" — exhausted.
- "first user present (no skips)" — golden path.
- The mock's `resultsUpdateCalls` (or whatever spy catches `applySingleSkip` UPDATEs) — see `runScoring.test.ts` for the existing helper shape.

- [ ] **Step 2: Add the failing test**

Inside the existing `describe("scoring → announcing pre-cascade (SPEC §10.2.1)", ...)` block, add:

```ts
    it("does NOT call applySingleSkip when pre-cascade exhausts (preserves pending for batch reveal)", async () => {
      const mock = makeRunScoringMock({
        announcementOrder: [U1, U2],
        membershipSelects: [
          { user_id: U1, last_seen_at: STALE },
          { user_id: U2, last_seen_at: STALE },
        ],
      });

      const result = await runScoring(
        { roomId: VALID_ROOM_ID, userId: OWNER_ID },
        makeRunScoringDeps(mock, { now: () => NOW }),
      );

      expect(result.ok).toBe(true);

      // Pre-cascade exhausts — neither U1 nor U2 should have results
      // marked announced=true. applySingleSkip is NOT called.
      expect(mock.resultsUpdateCalls).toHaveLength(0);

      const finalRoomUpdate = mock.roomUpdateCalls.at(-1);
      expect(finalRoomUpdate?.patch.announcing_user_id).toBeNull();
      expect(finalRoomUpdate?.patch.status).toBe("announcing");
      expect(finalRoomUpdate?.patch.announce_skipped_user_ids).toEqual([U1, U2]);
    });
```

Also update existing tests if their `resultsUpdateCalls` length assertions are exact. For:
- "skips first 2 absent → lands on order[2]" — should remain `resultsUpdateCalls.length === 2` (unchanged — silent-mark fires on found-present).
- "all absent → announcing_user_id null" — change to `resultsUpdateCalls.length === 0` (cascade exhausts, no silent-mark).
- "first user present (no skips)" — unchanged at 0.

If the existing tests don't directly assert on `resultsUpdateCalls`, no update is needed there.

- [ ] **Step 3: Run tests to verify the new test fails**

Run: `npm test -- src/lib/rooms/runScoring.test.ts 2>&1 | tail -20`
Expected: the new exhaust test FAILS — current code marks U1+U2 inside the loop (`resultsUpdateCalls.length === 2`).

- [ ] **Step 4: Refactor the pre-cascade loop**

In `src/lib/rooms/runScoring.ts`, find the pre-cascade `for` loop (lines ~374-409) inside the `if (room.announcement_mode === "live")` block. Replace its body so the loop only probes:

```ts
    for (let i = 0; i < order.length; i++) {
      const candidateId = order[i];

      const membershipQuery = await deps.supabase
        .from("room_memberships")
        .select("last_seen_at")
        .eq("room_id", roomId)
        .eq("user_id", candidateId)
        .maybeSingle();

      if (membershipQuery.error) {
        return fail(
          "INTERNAL_ERROR",
          "Could not read membership for pre-cascade presence check.",
          500,
        );
      }

      const lastSeenAt = membershipQuery.data?.last_seen_at ?? null;

      if (!isAbsent(lastSeenAt as string | null, cascadeNow)) {
        firstPresentIdx = i;
        break;
      }

      preSkipped.push(candidateId);
    }

    // Silent-mark only when a present user was found. SPEC §10.2.1 line 967:
    // "Their points still contribute to the final leaderboard ... the
    // dramatic individual reveal is suppressed." Pre-cascade exhaust →
    // do NOT silent-mark; their points stay pending for the 'Finish the
    // show' batch reveal.
    if (firstPresentIdx < order.length) {
      for (const skippedUserId of preSkipped) {
        const skipResult = await applySingleSkip(
          { roomId, skippedUserId },
          { supabase: deps.supabase },
        );
        if (!skipResult.ok) {
          return fail(skipResult.error.code, skipResult.error.message, 500);
        }
      }
    }
```

The existing inner-loop `applySingleSkip` call is removed. The post-loop block silent-marks only when a present user was found. `firstPresentIdx === order.length` (all absent) skips the silent-mark entirely.

The `announcingPatch.announcing_user_id`, `announcement_order`, `current_announce_idx`, and `announce_skipped_user_ids` assignments below the loop stay as-is.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/lib/rooms/runScoring.test.ts 2>&1 | tail -15`
Expected: ALL PASS.

- [ ] **Step 6: All rooms tests still pass**

Run: `npm test -- src/lib/rooms 2>&1 | tail -10`
Expected: ALL PASS.

- [ ] **Step 7: Type-check**

Run: `npm run type-check 2>&1 | tail -3`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/rooms/runScoring.ts src/lib/rooms/runScoring.test.ts
git commit -m "refactor(scoring): probe-then-mark pre-cascade — defer applySingleSkip (R4 #2)

Pre-cascade in runScoring now defers applySingleSkip calls until
rotation outcome is known. Found-present → silent-mark trailing
pre-skipped users. All-absent → do NOT silent-mark; their points
stay announced=false for the upcoming 'Finish the show' batch reveal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: finishTheShow orchestrator + route adapter (TDD)

**Files:**
- Create: `src/lib/rooms/finishTheShow.ts`
- Create: `src/lib/rooms/finishTheShow.test.ts`
- Create: `src/app/api/rooms/[id]/finish-show/route.ts`
- Modify: `src/lib/room/api.ts` (add `postFinishShow` client helper)

- [ ] **Step 1: Write the failing orchestrator test**

`src/lib/rooms/finishTheShow.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  finishTheShow,
  type FinishTheShowDeps,
} from "@/lib/rooms/finishTheShow";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const OWNER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const U1 = "10000000-0000-4000-8000-000000000001";
const U2 = "20000000-0000-4000-8000-000000000002";

const cascadeExhaustRoom = {
  id: VALID_ROOM_ID,
  status: "announcing",
  owner_user_id: OWNER_ID,
  announcement_order: [U1, U2],
  announcing_user_id: null,
  announce_skipped_user_ids: [U1, U2],
  batch_reveal_mode: false,
};

type Mock = { data: unknown; error: { message: string } | null };

interface Scripted {
  roomSelect?: Mock;
  resultsByUserSelect?: Map<string, Mock>; // user_id → results query result
  userSelect?: Mock;
  roomUpdate?: Mock;
}

function makeSupabaseMock(s: Scripted = {}) {
  const roomSelect = s.roomSelect ?? { data: cascadeExhaustRoom, error: null };
  const resultsByUserSelect = s.resultsByUserSelect ?? new Map();
  const userSelect =
    s.userSelect ?? { data: { display_name: "Alice" }, error: null };
  const roomUpdate =
    s.roomUpdate ?? { data: { id: VALID_ROOM_ID }, error: null };

  const roomUpdateCalls: Array<{
    patch: Record<string, unknown>;
    eqs: Array<{ col: string; val: unknown }>;
  }> = [];

  const from = vi.fn((table: string) => {
    if (table === "rooms") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(roomSelect),
          })),
        })),
        update: vi.fn((patch: Record<string, unknown>) => {
          const eqs: Array<{ col: string; val: unknown }> = [];
          roomUpdateCalls.push({ patch, eqs });
          const chain = {
            eq: vi.fn((col: string, val: unknown) => {
              eqs.push({ col, val });
              return chain;
            }),
            select: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue(roomUpdate),
            })),
          };
          return chain;
        }),
      };
    }
    if (table === "results") {
      return {
        select: vi.fn(() => {
          const chain: any = {
            eq: vi.fn((col: string, val: unknown) => {
              if (col === "user_id") {
                chain.__forUserId = val as string;
              }
              return chain;
            }),
            limit: vi.fn(() => ({
              maybeSingle: vi
                .fn()
                .mockImplementation(() =>
                  Promise.resolve(
                    resultsByUserSelect.get(chain.__forUserId) ?? {
                      data: null,
                      error: null,
                    },
                  ),
                ),
            })),
          };
          return chain;
        }),
      };
    }
    if (table === "users") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(userSelect),
          })),
        })),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as FinishTheShowDeps["supabase"],
    roomUpdateCalls,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<FinishTheShowDeps> = {},
) {
  const broadcastCalls: Array<{ roomId: string; event: any }> = [];
  (mock as any).broadcastCalls = broadcastCalls;
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn(async (roomId: string, event: any) => {
      broadcastCalls.push({ roomId, event });
    }),
    ...overrides,
  } as FinishTheShowDeps;
}

describe("finishTheShow", () => {
  it("400s on non-UUID roomId", async () => {
    const mock = makeSupabaseMock();
    const result = await finishTheShow(
      { roomId: "not-a-uuid", userId: OWNER_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_ROOM_ID");
  });

  it("403s when caller is not owner", async () => {
    const mock = makeSupabaseMock();
    const result = await finishTheShow(
      { roomId: VALID_ROOM_ID, userId: "00000000-0000-4000-8000-000000000099" },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
      expect(result.status).toBe(403);
    }
  });

  it("409s when room is not in cascade-exhaust state (announcing_user_id is set)", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...cascadeExhaustRoom, announcing_user_id: U1 },
        error: null,
      },
    });
    const result = await finishTheShow(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_IN_CASCADE_EXHAUST_STATE");
      expect(result.status).toBe(409);
    }
  });

  it("409s when batch_reveal_mode is already true", async () => {
    const mock = makeSupabaseMock({
      roomSelect: {
        data: { ...cascadeExhaustRoom, batch_reveal_mode: true },
        error: null,
      },
    });
    const result = await finishTheShow(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_IN_CASCADE_EXHAUST_STATE");
  });

  it("409s when no skipped user has unrevealed results", async () => {
    const mock = makeSupabaseMock({
      // Both U1 and U2 have all their results already announced.
      resultsByUserSelect: new Map([
        [U1, { data: null, error: null }],
        [U2, { data: null, error: null }],
      ]),
    });
    const result = await finishTheShow(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NO_PENDING_REVEALS");
      expect(result.status).toBe(409);
    }
  });

  it("409s when conditional UPDATE returns no row (race)", async () => {
    const mock = makeSupabaseMock({
      resultsByUserSelect: new Map([
        [U1, { data: { contestant_id: "c1" }, error: null }],
      ]),
      roomUpdate: { data: null, error: null },
    });
    const result = await finishTheShow(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FINISH_SHOW_RACED");
      expect(result.status).toBe(409);
    }
  });

  it("happy path: picks first skipped user with unrevealed results, sets batch_reveal_mode + announcing_user_id, broadcasts batch_reveal_started", async () => {
    const mock = makeSupabaseMock({
      resultsByUserSelect: new Map([
        [U1, { data: { contestant_id: "c1" }, error: null }],
      ]),
    });
    const result = await finishTheShow(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.announcingUserId).toBe(U1);
    expect(result.displayName).toBe("Alice");

    const lastUpdate = mock.roomUpdateCalls.at(-1);
    expect(lastUpdate?.patch.batch_reveal_mode).toBe(true);
    expect(lastUpdate?.patch.announcing_user_id).toBe(U1);
    expect(lastUpdate?.patch.current_announce_idx).toBe(0);

    const broadcasts = (mock as any).broadcastCalls;
    const batchEvents = broadcasts.filter(
      (b: any) => b.event.type === "batch_reveal_started",
    );
    expect(batchEvents).toHaveLength(1);
    expect(batchEvents[0].event.announcingUserId).toBe(U1);
    expect(batchEvents[0].event.displayName).toBe("Alice");
  });

  it("skips users whose results are all announced; picks the next pending one", async () => {
    const mock = makeSupabaseMock({
      resultsByUserSelect: new Map([
        [U1, { data: null, error: null }], // all announced
        [U2, { data: { contestant_id: "c2" }, error: null }], // pending
      ]),
      userSelect: { data: { display_name: "Bob" }, error: null },
    });
    const result = await finishTheShow(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      makeDeps(mock),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.announcingUserId).toBe(U2);
    expect(result.displayName).toBe("Bob");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/rooms/finishTheShow.test.ts 2>&1 | tail -10`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the orchestrator**

`src/lib/rooms/finishTheShow.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface FinishTheShowInput {
  roomId: unknown;
  userId: unknown;
}

export interface FinishTheShowDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (
    roomId: string,
    event: RoomEventPayload,
  ) => Promise<void>;
}

export interface FinishTheShowSuccess {
  ok: true;
  announcingUserId: string;
  displayName: string;
}

export interface FinishTheShowFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type FinishTheShowResult = FinishTheShowSuccess | FinishTheShowFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): FinishTheShowFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

type RoomRow = {
  id: string;
  status: string;
  owner_user_id: string;
  announcement_order: string[] | null;
  announcing_user_id: string | null;
  announce_skipped_user_ids: string[] | null;
  batch_reveal_mode: boolean;
};

/**
 * SPEC §10.2.1 — owner enters batch-reveal mode after the cascade has
 * exhausted the announcement order. Picks the first user in
 * announce_skipped_user_ids (in array order) with any unrevealed
 * (announced=false) results in this room and sets them as the active
 * announcer. From there, the existing reveal flow drives — but
 * advanceAnnouncement short-circuits the presence-cascade because
 * batch_reveal_mode is true.
 */
export async function finishTheShow(
  input: FinishTheShowInput,
  deps: FinishTheShowDeps,
): Promise<FinishTheShowResult> {
  if (typeof input.roomId !== "string" || !UUID_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID.", 400, "roomId");
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return fail(
      "INVALID_USER_ID",
      "userId must be a non-empty string.",
      400,
      "userId",
    );
  }
  const roomId = input.roomId;
  const callerId = input.userId;

  // 1. Load room.
  const roomQuery = await deps.supabase
    .from("rooms")
    .select(
      "id, status, owner_user_id, announcement_order, announcing_user_id, announce_skipped_user_ids, batch_reveal_mode",
    )
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const room = roomQuery.data as RoomRow;

  // 2. Owner-only authorization.
  if (callerId !== room.owner_user_id) {
    return fail(
      "FORBIDDEN",
      "Only the room owner can finish the show.",
      403,
    );
  }

  // 3. State guard: cascade-exhaust state.
  if (
    room.status !== "announcing" ||
    room.announcing_user_id !== null ||
    room.batch_reveal_mode === true
  ) {
    return fail(
      "NOT_IN_CASCADE_EXHAUST_STATE",
      "Finish the show is only available after the cascade exhausts.",
      409,
    );
  }

  // 4. Find first skipped user with unrevealed results.
  const skippedIds = room.announce_skipped_user_ids ?? [];
  let firstAnnouncerId: string | null = null;
  for (const skippedId of skippedIds) {
    const pendingResult = await deps.supabase
      .from("results")
      .select("contestant_id")
      .eq("room_id", roomId)
      .eq("user_id", skippedId)
      .eq("announced", false)
      .limit(1)
      .maybeSingle();

    if (pendingResult.error) {
      return fail(
        "INTERNAL_ERROR",
        "Could not query pending results.",
        500,
      );
    }
    if (pendingResult.data) {
      firstAnnouncerId = skippedId;
      break;
    }
  }

  if (firstAnnouncerId === null) {
    return fail(
      "NO_PENDING_REVEALS",
      "No skipped user has unrevealed points.",
      409,
    );
  }

  // 5. Conditional UPDATE: enter batch-reveal mode.
  const updateRoom = await deps.supabase
    .from("rooms")
    .update({
      batch_reveal_mode: true,
      announcing_user_id: firstAnnouncerId,
      current_announce_idx: 0,
    })
    .eq("id", roomId)
    .eq("status", "announcing")
    .is("announcing_user_id", null)
    .eq("batch_reveal_mode", false)
    .select("id")
    .maybeSingle();

  if (updateRoom.error) {
    return fail(
      "INTERNAL_ERROR",
      "Could not enter batch-reveal mode.",
      500,
    );
  }
  if (!updateRoom.data) {
    return fail(
      "FINISH_SHOW_RACED",
      "Another change happened first. Refresh and try again.",
      409,
    );
  }

  // 6. Look up first announcer's display name.
  const userQuery = await deps.supabase
    .from("users")
    .select("display_name")
    .eq("id", firstAnnouncerId)
    .maybeSingle();

  const displayName =
    (userQuery.data as { display_name: string } | null)?.display_name ?? "";

  // 7. Broadcast (non-fatal).
  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "batch_reveal_started",
      announcingUserId: firstAnnouncerId,
      displayName,
    });
  } catch (err) {
    console.warn(
      `broadcast 'batch_reveal_started' failed for room ${roomId}; state committed regardless:`,
      err,
    );
  }

  return { ok: true, announcingUserId: firstAnnouncerId, displayName };
}
```

If `INVALID_USER_ID`, `NOT_IN_CASCADE_EXHAUST_STATE`, `NO_PENDING_REVEALS`, or `FINISH_SHOW_RACED` are not in the `ApiErrorCode` union, add them to `src/lib/api-errors.ts` first. The existing union already has many codes; these slot in alongside.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/rooms/finishTheShow.test.ts 2>&1 | tail -15`
Expected: 8 PASS.

- [ ] **Step 5: Write the route adapter**

`src/app/api/rooms/[id]/finish-show/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { finishTheShow } from "@/lib/rooms/finishTheShow";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/rooms/{id}/finish-show
 * Body: { userId }
 *
 * SPEC §10.2.1 — owner-only. Transitions a cascade-exhausted room
 * (status='announcing' AND announcing_user_id=null AND
 * batch_reveal_mode=false) into batch-reveal mode. Sets the first
 * skipped user with unrevealed results as the active announcer.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_BODY", "Request body must be valid JSON.", 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return apiError("INVALID_BODY", "Request body must be a JSON object.", 400);
  }

  const input = body as { userId?: unknown };
  const result = await finishTheShow(
    { roomId: params.id, userId: input.userId },
    {
      supabase: createServiceClient(),
      broadcastRoomEvent: defaultBroadcastRoomEvent,
    },
  );

  if (result.ok) {
    const { ok: _ok, ...payload } = result;
    return NextResponse.json(payload, { status: 200 });
  }
  return apiError(
    result.error.code,
    result.error.message,
    result.status,
    result.error.field,
  );
}
```

Create the directory `src/app/api/rooms/[id]/finish-show/` first if needed.

- [ ] **Step 6: Add the client helper**

In `src/lib/room/api.ts`, add alongside the existing `postAnnounceSkip` / `postAnnounceRestore` helpers:

```ts
export async function postFinishShow(
  roomId: string,
  userId: string,
): Promise<{ announcingUserId: string; displayName: string }> {
  const res = await fetch(`/api/rooms/${roomId}/finish-show`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? "Failed to finish the show");
  }
  return res.json();
}
```

If the existing helpers in `src/lib/room/api.ts` use a different pattern (e.g., return `{ ok, data, error }` rather than throwing), match that style. Read the file first.

- [ ] **Step 7: Type-check**

Run: `npm run type-check 2>&1 | tail -3`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/rooms/finishTheShow.ts src/lib/rooms/finishTheShow.test.ts src/app/api/rooms/[id]/finish-show/route.ts src/lib/room/api.ts src/lib/api-errors.ts
git commit -m "feat(announce): finishTheShow orchestrator + POST /finish-show route (R4 #2)

Owner-only. Validates room is in cascade-exhaust state
(status='announcing' AND announcing_user_id=null AND
batch_reveal_mode=false). Picks the first user in
announce_skipped_user_ids with any announced=false results, sets
them as the new active announcer with batch_reveal_mode=true,
broadcasts batch_reveal_started.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(Stage `src/lib/api-errors.ts` only if you added new error codes there.)

---

## Task 5: advanceAnnouncement batch-reveal branch (TDD)

**Why:** When `batch_reveal_mode=true`, rotation must NOT run the presence-cascade. Instead it walks `announcement_order`, finding the next user with unrevealed results, silently skipping users with all-announced results (historical silent-marks). When the walk exhausts, status flips to `done`.

**Files:**
- Modify: `src/lib/rooms/advanceAnnouncement.ts` (add batch-reveal branch in step 6)
- Modify: `src/lib/rooms/advanceAnnouncement.test.ts` (add 3 new tests)

- [ ] **Step 1: Add failing tests**

Inside the `describe` for `advanceAnnouncement`, add a new nested `describe` block:

```ts
  describe("batch-reveal mode (SPEC §10.2.1 'Finish the show')", () => {
    const NOW = new Date("2026-05-10T12:00:00.000Z");

    it("rotates to next user with unrevealed results when current finishes queue", async () => {
      // Order [U1, U2, U3]. batch_reveal_mode=true. U1 just revealed
      // their last point. U2 has unrevealed results. Expect: rotation
      // lands on U2 with NO presence check (no membershipSelects probed).
      const mock = makeSupabaseMock({
        roomSelect: {
          data: {
            id: VALID_ROOM_ID,
            status: "announcing",
            owner_user_id: OWNER_ID,
            announcement_order: [U1, U2, U3],
            announcing_user_id: U1,
            current_announce_idx: 0,
            delegate_user_id: null,
            announce_skipped_user_ids: [U1, U2, U3],
            batch_reveal_mode: true,
          },
          error: null,
        },
        announcerResults: {
          data: [
            { contestant_id: "c1", points_awarded: 12, rank: 1, announced: false },
          ],
          error: null,
        },
        // U2 has 1 unrevealed result; U3 query is not made (we stop on first match).
        pendingByUser: new Map([[U2, { contestant_id: "cX" }]]),
      });

      const result = await advanceAnnouncement(
        { roomId: VALID_ROOM_ID, userId: OWNER_ID },
        makeDeps(mock, { now: () => NOW }),
      );

      expect(result.ok).toBe(true);
      const lastRoomUpdate = mock.roomUpdateCalls.at(-1);
      expect(lastRoomUpdate?.patch.announcing_user_id).toBe(U2);

      // No membership probes were made (presence-cascade skipped).
      expect(mock.membershipSelectsConsumed ?? 0).toBe(0);
    });

    it("silently skips users with all-announced results (no announce_skip broadcast)", async () => {
      const mock = makeSupabaseMock({
        roomSelect: {
          data: {
            id: VALID_ROOM_ID,
            status: "announcing",
            owner_user_id: OWNER_ID,
            announcement_order: [U1, U2, U3],
            announcing_user_id: U1,
            current_announce_idx: 0,
            delegate_user_id: null,
            announce_skipped_user_ids: [U1, U2, U3],
            batch_reveal_mode: true,
          },
          error: null,
        },
        announcerResults: {
          data: [
            { contestant_id: "c1", points_awarded: 12, rank: 1, announced: false },
          ],
          error: null,
        },
        // U2 has no pending results (all announced); U3 has pending.
        pendingByUser: new Map([
          [U2, null], // null = no row → all announced
          [U3, { contestant_id: "cZ" }],
        ]),
      });

      const result = await advanceAnnouncement(
        { roomId: VALID_ROOM_ID, userId: OWNER_ID },
        makeDeps(mock, { now: () => NOW }),
      );

      expect(result.ok).toBe(true);
      const lastRoomUpdate = mock.roomUpdateCalls.at(-1);
      expect(lastRoomUpdate?.patch.announcing_user_id).toBe(U3);

      // No announce_skip broadcasts emitted (silent skip in batch-reveal).
      const skipBroadcasts = (mock as any).broadcastCalls.filter(
        (b: any) => b.event.type === "announce_skip",
      );
      expect(skipBroadcasts).toHaveLength(0);
    });

    it("flips status to 'done' and clears batch_reveal_mode when no more pending users", async () => {
      const mock = makeSupabaseMock({
        roomSelect: {
          data: {
            id: VALID_ROOM_ID,
            status: "announcing",
            owner_user_id: OWNER_ID,
            announcement_order: [U1, U2],
            announcing_user_id: U1,
            current_announce_idx: 0,
            delegate_user_id: null,
            announce_skipped_user_ids: [U1, U2],
            batch_reveal_mode: true,
          },
          error: null,
        },
        announcerResults: {
          data: [
            { contestant_id: "c1", points_awarded: 12, rank: 1, announced: false },
          ],
          error: null,
        },
        // U2 has no pending results (already announced from earlier silent-mark, or absent altogether).
        pendingByUser: new Map([[U2, null]]),
      });

      const result = await advanceAnnouncement(
        { roomId: VALID_ROOM_ID, userId: OWNER_ID },
        makeDeps(mock, { now: () => NOW }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.finished).toBe(true);

      const lastRoomUpdate = mock.roomUpdateCalls.at(-1);
      expect(lastRoomUpdate?.patch.announcing_user_id).toBeNull();
      expect(lastRoomUpdate?.patch.status).toBe("done");
      expect(lastRoomUpdate?.patch.batch_reveal_mode).toBe(false);
    });
  });
```

The mock helper needs extending to support `pendingByUser` (a Map mapping `user_id` → either a row object or null) and to track `membershipSelectsConsumed`. Modify `makeSupabaseMock` to handle:

- `from("results").select("contestant_id").eq("room_id", X).eq("user_id", Y).eq("announced", false).limit(1).maybeSingle()` — return `pendingByUser.get(Y) ?? null` wrapped in `{ data, error }`.
- `from("rooms").select(...)` should now also return the `batch_reveal_mode` field.
- Track when `room_memberships` is queried — increment a counter.

Read the existing `makeSupabaseMock` helper before editing; the modifications stay backward-compatible with the existing tests.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/rooms/advanceAnnouncement.test.ts 2>&1 | tail -20`
Expected: the new batch-reveal tests FAIL — current code doesn't have a batch-reveal branch.

- [ ] **Step 3: Update `RoomRow` type and `roomQuery` to include `batch_reveal_mode`**

In `advanceAnnouncement.ts`, find the `RoomRow` type at the top. Add `batch_reveal_mode: boolean`. Update the `roomQuery` SELECT string to include the column:

```ts
.select(
  "id, status, owner_user_id, announcement_order, announcing_user_id, current_announce_idx, delegate_user_id, announce_skipped_user_ids, batch_reveal_mode",
)
```

- [ ] **Step 4: Add the batch-reveal branch in step 6**

The existing step 6 starts with `const isLastForAnnouncer = ...`. Replace the existing `if (isLastForAnnouncer) { ... }` block with a branched version:

```ts
  if (isLastForAnnouncer) {
    if (room.batch_reveal_mode) {
      // Batch-reveal rotation: walk announcement_order forward,
      // skipping users with all-announced results. No presence check.
      const announcers = room.announcement_order;
      const pos = announcers.indexOf(currentAnnouncer);
      let probePos = pos + 1;
      let foundPending = false;

      while (probePos < announcers.length) {
        const candidateId = announcers[probePos];
        const pendingQuery = await deps.supabase
          .from("results")
          .select("contestant_id")
          .eq("room_id", roomId)
          .eq("user_id", candidateId)
          .eq("announced", false)
          .limit(1)
          .maybeSingle();

        if (pendingQuery.error) {
          return fail(
            "INTERNAL_ERROR",
            "Could not query pending results in batch-reveal.",
            500,
          );
        }
        if (pendingQuery.data) {
          nextAnnouncingUserId = candidateId;
          nextIdx = 0;
          foundPending = true;
          break;
        }
        // No pending → silently skip (no broadcast). Advance.
        probePos += 1;
      }

      if (!foundPending) {
        // All remaining users have all-announced results → show is done.
        nextAnnouncingUserId = null;
        nextIdx = 0;
        finishedShow = true;
      }
    } else {
      // Original presence-cascade logic for non-batch-reveal mode.
      // (Existing code from current step 6 goes here.)
      const announcers = room.announcement_order;
      const pos = announcers.indexOf(currentAnnouncer);
      const nextPos = pos + 1;
      if (pos >= 0 && nextPos < announcers.length) {
        const now = (deps.now ? deps.now() : new Date());
        let probePos = nextPos;
        let foundPresent = false;

        while (probePos < announcers.length) {
          const candidateId = announcers[probePos];
          const membershipQuery = await deps.supabase
            .from("room_memberships")
            .select("last_seen_at")
            .eq("room_id", roomId)
            .eq("user_id", candidateId)
            .maybeSingle();

          const lastSeenAt = membershipQuery.data?.last_seen_at ?? null;
          const absent = isAbsent(lastSeenAt as string | null, now);

          if (absent) {
            cascadedSkippedUserIds.push(candidateId);
            probePos += 1;
          } else {
            nextAnnouncingUserId = candidateId;
            nextIdx = 0;
            foundPresent = true;
            break;
          }
        }

        if (foundPresent) {
          for (const skippedUserId of cascadedSkippedUserIds) {
            const skipResult = await applySingleSkip(
              { roomId, skippedUserId },
              { supabase: deps.supabase },
            );
            if (!skipResult.ok) {
              return fail(skipResult.error.code, skipResult.error.message, 500);
            }
          }
        } else {
          cascadeExhausted = true;
          nextAnnouncingUserId = null;
          nextIdx = 0;
        }
      } else {
        nextAnnouncingUserId = null;
        nextIdx = 0;
        finishedShow = true;
      }
    }
  }
```

- [ ] **Step 5: Update `roomPatch` so batch-reveal terminal flips `batch_reveal_mode` back to false**

In step 7 (the room patch construction), extend the patch type and conditionally set `batch_reveal_mode: false` when `finishedShow && room.batch_reveal_mode`:

```ts
  const roomPatch: {
    announcing_user_id: string | null;
    current_announce_idx: number;
    announce_skipped_user_ids?: string[];
    status?: string;
    batch_reveal_mode?: boolean;
  } = {
    announcing_user_id: nextAnnouncingUserId,
    current_announce_idx: nextIdx,
  };
  if (finishedShow) {
    roomPatch.status = "done";
    if (room.batch_reveal_mode) {
      roomPatch.batch_reveal_mode = false;
    }
  }
```

- [ ] **Step 6: Run advance tests**

Run: `npm test -- src/lib/rooms/advanceAnnouncement.test.ts 2>&1 | tail -20`
Expected: ALL PASS — new + existing.

- [ ] **Step 7: All rooms tests**

Run: `npm test -- src/lib/rooms 2>&1 | tail -10`
Expected: ALL PASS.

- [ ] **Step 8: Type-check**

Run: `npm run type-check 2>&1 | tail -3`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/rooms/advanceAnnouncement.ts src/lib/rooms/advanceAnnouncement.test.ts
git commit -m "feat(announce): batch-reveal branch in advanceAnnouncement (R4 #2)

When room.batch_reveal_mode is true, rotation walks announcement_order
mechanically, finding the next user with announced=false results.
Users with all-announced results are silently skipped (no banner,
no announce_skip broadcast — they were already silent-marked from an
earlier rotation). When the walk exhausts, status flips to 'done' and
batch_reveal_mode resets to false in the same UPDATE.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: AnnouncingView UI + locale keys + RTL

**Files:**
- Modify: `src/components/room/AnnouncingView.tsx`
- Modify: `src/components/room/AnnouncingView.test.tsx`
- Modify: `src/locales/en.json` (new keys under `announce.finishTheShow.*`)

- [ ] **Step 1: Add locale keys**

In `src/locales/en.json`, add under the existing `announce` namespace:

```json
"finishTheShow": {
  "ownerCta": "Finish the show",
  "ownerSubtitle": "All remaining announcers are absent — finish revealing on their behalf",
  "guestWaiting": "Waiting for the host to continue…",
  "batchRevealChip": "Host is finishing the show"
}
```

If `locales.test.ts` enforces the empty-keys-in-non-en-stubs rule, add empty stubs to `es.json`, `uk.json`, `fr.json`, `de.json`:

```json
"finishTheShow": {
  "ownerCta": "",
  "ownerSubtitle": "",
  "guestWaiting": "",
  "batchRevealChip": ""
}
```

Read `src/locales/locales.test.ts` first to confirm the convention.

- [ ] **Step 2: Add failing RTL tests for cascade-exhaust UI**

In `src/components/room/AnnouncingView.test.tsx`, add a new `describe` block:

```tsx
  describe("cascade-exhaust state (R4 #2 'Finish the show')", () => {
    function makeRoom(overrides: any = {}) {
      return {
        id: "00000000-0000-4000-8000-000000000001",
        status: "announcing",
        ownerUserId: OWNER_ID,
        batchRevealMode: false,
        ...overrides,
      };
    }

    it("renders 'Finish the show' CTA for owner when announcingUserId is null and batchRevealMode is false", () => {
      render(
        <AnnouncingView
          room={makeRoom()}
          contestants={[]}
          currentUserId={OWNER_ID}
          announcement={null}
        />,
      );
      expect(
        screen.getByRole("button", { name: /finish the show/i }),
      ).toBeVisible();
    });

    it("renders waiting copy for non-owner in cascade-exhaust", () => {
      render(
        <AnnouncingView
          room={makeRoom()}
          contestants={[]}
          currentUserId="00000000-0000-4000-8000-000000000099"
          announcement={null}
        />,
      );
      expect(screen.getByText(/waiting for the host/i)).toBeVisible();
      expect(
        screen.queryByRole("button", { name: /finish the show/i }),
      ).toBeNull();
    });

    it("does NOT render the Finish CTA when batchRevealMode is true (already in batch-reveal)", () => {
      render(
        <AnnouncingView
          room={makeRoom({ batchRevealMode: true })}
          contestants={[]}
          currentUserId={OWNER_ID}
          announcement={{
            announcingUserId: U1,
            announcingDisplayName: "Alice",
            announcingAvatarSeed: "alice",
            currentAnnounceIdx: 0,
            pendingReveal: { contestantId: "c1", points: 12 },
            queueLength: 1,
            delegateUserId: null,
            announcerPosition: 1,
            announcerCount: 1,
            skippedUserIds: [U1],
          }}
        />,
      );
      expect(
        screen.queryByRole("button", { name: /finish the show/i }),
      ).toBeNull();
    });

    it("renders the 'Host is finishing the show' chip when batchRevealMode is true", () => {
      render(
        <AnnouncingView
          room={makeRoom({ batchRevealMode: true })}
          contestants={[]}
          currentUserId={OWNER_ID}
          announcement={{
            announcingUserId: U1,
            announcingDisplayName: "Alice",
            announcingAvatarSeed: "alice",
            currentAnnounceIdx: 0,
            pendingReveal: { contestantId: "c1", points: 12 },
            queueLength: 1,
            delegateUserId: null,
            announcerPosition: 1,
            announcerCount: 1,
            skippedUserIds: [U1],
          }}
        />,
      );
      expect(screen.getByText(/host is finishing the show/i)).toBeVisible();
    });

    it("clicking 'Finish the show' calls postFinishShow", async () => {
      const postFinishShowMock = vi
        .spyOn(roomApi, "postFinishShow")
        .mockResolvedValue({ announcingUserId: U1, displayName: "Alice" });
      const user = userEvent.setup();

      render(
        <AnnouncingView
          room={makeRoom()}
          contestants={[]}
          currentUserId={OWNER_ID}
          announcement={null}
        />,
      );
      await user.click(screen.getByRole("button", { name: /finish the show/i }));
      expect(postFinishShowMock).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000001",
        OWNER_ID,
      );
    });
  });
```

Adapt to whatever the existing `AnnouncingView` props shape is (the names above mirror the test pattern from R4 #1; if the actual props have different names like `roomId` separate from `room`, adjust). The `roomApi` import points to `src/lib/room/api.ts`.

You may need to extend the existing `AnnouncingViewProps` to include the room's `batchRevealMode` field — verify by reading the component.

- [ ] **Step 3: Run RTL tests to verify failure**

Run: `npm test -- src/components/room/AnnouncingView.test.tsx 2>&1 | tail -15`
Expected: new tests FAIL — UI doesn't render the new CTA / chip / waiting copy yet.

- [ ] **Step 4: Update `<AnnouncingView>`**

Open `src/components/room/AnnouncingView.tsx`. Add:

1. Update `RoomShape` to include `batchRevealMode: boolean`. Update the `room` prop callsites accordingly.

2. Import `postFinishShow`:

```ts
import { postFinishShow } from "@/lib/room/api";
```

3. Add a derived state:

```ts
const isCascadeExhausted =
  room.status === "announcing" &&
  !announcement?.announcingUserId &&
  !room.batchRevealMode;
const isOwner = currentUserId === room.ownerUserId;
const isBatchReveal = room.batchRevealMode === true;
```

4. Add a handler for the Finish CTA:

```ts
const [finishingShow, setFinishingShow] = useState(false);
const onFinishShow = useCallback(async () => {
  if (finishingShow) return;
  setFinishingShow(true);
  try {
    await postFinishShow(room.id, currentUserId);
    // Realtime broadcast or page-level refetch will re-render.
  } catch (err) {
    console.warn("Finish the show failed:", err);
    // Surface error via existing mapRoomError pattern if appropriate.
  } finally {
    setFinishingShow(false);
  }
}, [room.id, currentUserId, finishingShow]);
```

5. In the render, add a top-level branch when `isCascadeExhausted`:

```tsx
if (isCascadeExhausted) {
  if (isOwner) {
    return (
      <div className="emx-cascade-exhaust">
        <h2>{t("announce.finishTheShow.ownerSubtitle")}</h2>
        <button
          type="button"
          onClick={onFinishShow}
          disabled={finishingShow}
          className="emx-cta-primary"
        >
          {t("announce.finishTheShow.ownerCta")}
        </button>
      </div>
    );
  }
  return (
    <div className="emx-cascade-exhaust">
      <p>{t("announce.finishTheShow.guestWaiting")}</p>
    </div>
  );
}
```

6. Where the announcer header is rendered (search for the announcer's displayName in the JSX), add a chip when `isBatchReveal`:

```tsx
{isBatchReveal && (
  <span className="emx-batch-reveal-chip" aria-live="polite">
    {t("announce.finishTheShow.batchRevealChip")}
  </span>
)}
```

Place it next to the announcer's displayName.

7. The component already subscribes to `useRoomRealtime`. Add a handler for the new `batch_reveal_started` event in the existing `onMessage` switch — use it to trigger the same refetch path that `status_changed` uses, so the UI swings out of the cascade-exhaust branch into batch-reveal active rendering.

```ts
if (msg.type === "batch_reveal_started") {
  // Trigger room state refetch — same pattern as status_changed.
  onAnnouncementEnded?.();
  // Or whatever the existing refetch trigger is in this file.
}
```

Read the existing `onMessage` callback to match its style.

- [ ] **Step 5: Run RTL tests to verify they pass**

Run: `npm test -- src/components/room/AnnouncingView.test.tsx 2>&1 | tail -15`
Expected: ALL PASS — including the 5 new cases.

- [ ] **Step 6: Run all room component tests for regression**

Run: `npm test -- src/components/room 2>&1 | tail -15`
Expected: ALL PASS.

- [ ] **Step 7: Type-check + lint**

Run: `npm run type-check 2>&1 | tail -3 && npm run lint 2>&1 | tail -5`
Expected: both green.

- [ ] **Step 8: Commit**

```bash
git add src/components/room/AnnouncingView.tsx src/components/room/AnnouncingView.test.tsx src/locales/en.json src/locales/es.json src/locales/uk.json src/locales/fr.json src/locales/de.json
git commit -m "feat(room): cascade-exhaust 'Finish the show' CTA + batch-reveal chip (R4 #2)

Owner sees prominent 'Finish the show' CTA in cascade-exhausted state;
non-owners see 'Waiting for the host to continue…'. Tap routes through
postFinishShow → POST /finish-show → batch_reveal_started broadcast.
While batch-reveal is active, a chip beneath the announcer name reads
'Host is finishing the show'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(Stage non-en locale stubs only if you added them.)

---

## Task 7: Seed state + Playwright extension

**Files:**
- Modify: `scripts/seed-helpers.ts` (new builder `buildAnnouncingCascadeAllAbsent`)
- Modify: `scripts/seed-helpers.test.ts` (test the builder)
- Modify: `scripts/seed-room.ts` (CLI handler)
- Modify: `scripts/README.md`
- Modify: `tests/e2e/announce-cascade.spec.ts` (add test for Finish flow)

- [ ] **Step 1: Add a failing test for the new builder**

Add to `scripts/seed-helpers.test.ts`:

```ts
describe("buildAnnouncingCascadeAllAbsent", () => {
  it("produces an announcing room with all users absent (cascade-exhaust state)", () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    const result = buildAnnouncingCascadeAllAbsent({ now });

    expect(result.room.status).toBe("announcing");
    expect(result.room.announcing_user_id).toBeNull();
    expect(result.room.batch_reveal_mode).toBe(false);
    expect(result.room.announcement_order).toHaveLength(3);

    // All 3 users should be in the skipped list.
    expect(result.room.announce_skipped_user_ids).toHaveLength(3);

    // All users should be stale (>30s ago).
    for (const m of result.memberships) {
      if (m.last_seen_at !== null) {
        expect(
          now.getTime() - new Date(m.last_seen_at).getTime(),
        ).toBeGreaterThan(30_000);
      }
    }

    // CRITICAL: results for skipped users should have announced=false
    // so 'Finish the show' has something to reveal.
    const skippedIds = new Set(result.room.announce_skipped_user_ids);
    const skippedResults = result.results.filter((r) =>
      skippedIds.has(r.user_id),
    );
    expect(skippedResults.length).toBeGreaterThan(0);
    expect(skippedResults.every((r) => r.announced === false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- scripts/seed-helpers.test.ts 2>&1 | tail -10`
Expected: FAIL — `buildAnnouncingCascadeAllAbsent` not defined.

- [ ] **Step 3: Implement the builder**

In `scripts/seed-helpers.ts`, add:

```ts
export interface BuildAnnouncingCascadeAllAbsentOpts {
  now?: Date;
  pin?: string;
}

/**
 * SPEC §10.2.1 — seed an announcing room in cascade-exhausted state.
 * 3-user announcement order, all users stale (last_seen_at 60s ago),
 * announcing_user_id=null, all in announce_skipped_user_ids, all
 * results.announced=false. Drives the 'Finish the show' batch-reveal
 * flow when the admin taps the CTA.
 */
export function buildAnnouncingCascadeAllAbsent(
  opts: BuildAnnouncingCascadeAllAbsentOpts = {},
) {
  const now = opts.now ?? new Date();
  const stale = new Date(now.getTime() - 60_000).toISOString();

  // Reuse buildAnnouncingMidQueueLive as the base, then override.
  const base = buildAnnouncingMidQueueLive({ ...opts, now });
  const [u1, u2, u3] = base.users.slice(0, 3);
  const order = [u1.id, u2.id, u3.id];

  return {
    ...base,
    room: {
      ...base.room,
      announcement_order: order,
      announcing_user_id: null,
      current_announce_idx: 0,
      announce_skipped_user_ids: order,
      batch_reveal_mode: false,
    },
    memberships: base.memberships.map((m) => ({ ...m, last_seen_at: stale })),
    results: base.results.map((r) => ({ ...r, announced: false })),
  };
}
```

If the existing `buildAnnouncingMidQueueLive` doesn't produce ≥3 users, extend it or inline the construction. If `results` aren't on the base builder's return, add them.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- scripts/seed-helpers.test.ts 2>&1 | tail -10`
Expected: ALL PASS.

- [ ] **Step 5: Wire CLI handler**

In `scripts/seed-room.ts`, find the `STATE_BUILDERS` map (or equivalent) and add:

```ts
"announcing-cascade-all-absent": seedAnnouncingCascadeAllAbsent,
```

Implement `seedAnnouncingCascadeAllAbsent` mirroring the existing `seedAnnouncingCascadeAbsent` impure handler but calling `buildAnnouncingCascadeAllAbsent`.

Update `SEED_STATES` if it's a separate constant.

- [ ] **Step 6: Document in README**

Add a row to `scripts/README.md`:

```markdown
| `announcing-cascade-all-absent` | Live-mode announcing room in cascade-exhaust state: 3-user order, all absent (last_seen_at 60s ago), announcing_user_id=null, all in announce_skipped_user_ids, all results.announced=false. Drives the R4 'Finish the show' batch-reveal flow. |
```

- [ ] **Step 7: Add Playwright test**

In `tests/e2e/announce-cascade.spec.ts`, add a new test inside the existing `describe`:

```ts
  test("Finish the show: cascade-exhausted state → admin taps Finish → drives all batch-reveals to done", async ({
    page,
  }) => {
    const seed = seedRoom("announcing-cascade-all-absent");
    await signInAsOwner(page, seed);

    await page.goto(`/room/${seed.roomId}`);

    // Cascade-exhaust state: Finish the show CTA visible.
    await expect(
      page.getByRole("button", { name: /finish the show/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Tap Finish.
    await page.getByRole("button", { name: /finish the show/i }).click();

    // Reveal button appears (admin is now driving the first absent user's reveals).
    await expect(
      page.getByRole("button", { name: /reveal/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Drive reveals to done. The room should have ~30 result rows total
    // (3 users × 10 points each); cap reveals at a safe ceiling.
    let revealsFired = 0;
    const MAX_REVEALS = 50;
    while (revealsFired < MAX_REVEALS) {
      const revealBtn = page.getByRole("button", { name: /reveal/i });
      const visible = await revealBtn
        .isVisible({ timeout: 2_000 })
        .catch(() => false);
      if (!visible) break;
      await revealBtn.click();
      revealsFired += 1;
      await page.waitForTimeout(150);
    }

    // Expect status='done' eventually (room transitions to results page or
    // shows done state). Adapt the assertion to whatever the done UI shows.
    await expect(
      page.getByRole("button", { name: /finish the show/i }),
    ).toHaveCount(0, { timeout: 10_000 });
  });
```

Adapt selectors to match the actual rendered UI.

- [ ] **Step 8: Type-check**

Run: `npm run type-check 2>&1 | tail -3`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add scripts/seed-helpers.ts scripts/seed-helpers.test.ts scripts/seed-room.ts scripts/README.md tests/e2e/announce-cascade.spec.ts
git commit -m "test(seed,e2e): announcing-cascade-all-absent state + Finish the show E2E (R4 #2)

Seed state: 3-user announcing room in cascade-exhaust (all absent,
announcing_user_id=null, all results.announced=false). Playwright
test drives the full Finish the show → batch-reveal → done flow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Final cleanup — TODO tick, type-check, push, PR

**Files:**
- Modify: `TODO.md` (tick line 268)

- [ ] **Step 1: Run full test suite**

Run: `npm test 2>&1 | tail -5`
Expected: ALL PASS.

- [ ] **Step 2: Type-check + lint**

Run: `npm run type-check 2>&1 | tail -3 && npm run lint 2>&1 | tail -5`
Expected: both green.

- [ ] **Step 3: Tick TODO.md line 268**

Change:

```markdown
  - [ ] "Finish the show" batch-reveal mode when all remaining announcers are absent
```

to:

```markdown
  - [x] "Finish the show" batch-reveal mode when all remaining announcers are absent  _(landed on `feat/r4-finish-the-show` — cascade refactor (probe-then-mark) defers `applySingleSkip` until rotation outcome is known: silent-mark only when present user found, leave pending when cascade exhausts. New `rooms.batch_reveal_mode` column + `POST /finish-show` endpoint + `advanceAnnouncement` batch-reveal branch that walks announcement_order without presence checks. Owner CTA in cascade-exhaust state; "Host is finishing the show" chip during batch-reveal. Spec: `docs/superpowers/specs/2026-05-10-r4-finish-the-show-design.md`. Plan: `docs/superpowers/plans/2026-05-10-r4-finish-the-show.md`.)_
```

(TODO.md is gitignored — local-only.)

- [ ] **Step 4: Pause for user push approval**

Push and PR are shared-state mutations. Stop here, summarise commits, and wait for user approval before:

```bash
git push -u origin feat/r4-finish-the-show
gh pr create --title "feat(announce): R4 'Finish the show' batch-reveal mode (§10.2.1)" --body ...
```

PR body template:

```
## Summary

- New `rooms.batch_reveal_mode` column + `POST /api/rooms/{id}/finish-show` endpoint.
- Cascade refactor in `advanceAnnouncement` and `runScoring`: defers `applySingleSkip` until rotation outcome is known (silent-mark only when present user found, leave pending when cascade exhausts).
- `<AnnouncingView>` cascade-exhaust state surfaces "Finish the show" CTA for owner; non-owners see waiting copy. Batch-reveal active state shows "Host is finishing the show" chip.
- Resolves the SPEC §10.2.1 line 967 (silent-mark) vs line 981 (batch reveal) tension by treating them as two scenarios.

## Test plan

- [ ] Apply the schema migration: `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS batch_reveal_mode BOOLEAN NOT NULL DEFAULT FALSE;`
- [ ] Seed: `npm run seed:room -- --state=announcing-cascade-all-absent`
- [ ] Open the room as owner. Cascade-exhaust state shows "Finish the show". Tap it. The first skipped user becomes the active announcer; admin drives reveals via the existing Reveal Next CTA.
- [ ] Verify `/api/results/{id}` `batch_reveal_mode=true` during the flow; `false` again at done.
- [ ] Run `npm test`, `npm run type-check`, `npm run lint`, `npm run test:e2e`.
```

---

## Parallelization map

Strict order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.

Notional parallelization opportunities:
- Tasks 2 + 3 both refactor cascades but in separate files. The refactor pattern is identical, so a subagent could batch them — but committing them separately (one per task) makes review cleaner. Recommended: serial.
- Tasks 4 (orchestrator + route) and 5 (advanceAnnouncement batch-reveal branch) are independent of each other but both depend on Task 1 (schema + RoomEvent). Could parallelize after Task 1 lands. Recommended: serial; Task 4's tests don't exercise advanceAnnouncement integration so the parallelism gain is small.
- Task 7 (seed + Playwright) needs the full server + UI to be green, so it's strictly last before final cleanup.

## Self-review checklist (run before declaring complete)

- [ ] Schema column lives in `supabase/schema.sql` AND `SUPABASE_SETUP.md` changelog.
- [ ] `database.ts` has `batch_reveal_mode` on `rooms` Row/Insert/Update.
- [ ] `RoomEvent` and `RoomEventPayload` both have the new `batch_reveal_started` variant.
- [ ] Cascade refactor in `advanceAnnouncement.ts`: `applySingleSkip` calls live AFTER the loop; exhaust path doesn't call it at all.
- [ ] Cascade refactor in `runScoring.ts`: same shape.
- [ ] `finishTheShow` returns 403 for non-owner, 409 for wrong state, 409 for no pending reveals, 200 with `batch_reveal_mode=true` set.
- [ ] `advanceAnnouncement` batch-reveal branch silently skips users with all-announced results (no `announce_skip` broadcast in those cases).
- [ ] When batch-reveal terminates (no more pending users), the room patch sets `status='done'` AND `batch_reveal_mode=false`.
- [ ] AnnouncingView cascade-exhaust UI: owner sees CTA, non-owner sees waiting copy.
- [ ] Batch-reveal chip renders next to announcer name when `batch_reveal_mode=true`.
- [ ] `npm test` + `npm run type-check` + `npm run lint` all green.
- [ ] Playwright spec runs the seeded room and asserts the full Finish flow.
- [ ] TODO.md line 268 ticked with branch + spec + plan refs.
