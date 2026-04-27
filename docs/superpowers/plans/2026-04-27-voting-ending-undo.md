# "End voting" undo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the irreversible "End voting" tap with a 5-second undo window, server-authoritative timer, refresh-proof.

**Architecture:** New room status `voting_ending` + `voting_ends_at` deadline column. Admin client owns the countdown timer; at t≤0 fires `POST /score` (existing endpoint, modified guards). Atomic SQL conditional update makes concurrent finalize calls safe. Replaces the floating top-right End-voting pill with a header-chrome button + modal + countdown toast.

**Tech Stack:** TypeScript, React, Next.js 14, vitest, Supabase, PostgreSQL.

Spec: [docs/superpowers/specs/2026-04-27-voting-ending-undo-design.md](docs/superpowers/specs/2026-04-27-voting-ending-undo-design.md)

---

## Task 1: Schema migration + DB types + setup note

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `SUPABASE_SETUP.md`
- Modify: `src/types/database.ts`

- [ ] **Step 1: Edit `supabase/schema.sql` rooms table**

In `supabase/schema.sql`, replace the existing `rooms` block (around lines 23–43) status/CHECK so it reads:

```sql
  status                VARCHAR(14) NOT NULL DEFAULT 'lobby'
                          CHECK (status IN ('lobby','voting','voting_ending','scoring','announcing','done')),
```

Then, after the `delegate_user_id` column line, add two new columns (in alphabetical-ish proximity to existing timestamps):

```sql
  voting_ends_at        TIMESTAMPTZ,            -- §6.3.1: deadline for the 5-s undo window; set on voting → voting_ending; cleared on undo
  voting_ended_at       TIMESTAMPTZ,            -- §6.3.1: audit timestamp written when voting_ending → scoring fires
```

Below the existing migration comment for `delegate_user_id`, append:

```sql
-- Existing-database migration (run via Supabase SQL Editor) for the §6.3.1 undo window:
--   ALTER TABLE rooms ALTER COLUMN status TYPE VARCHAR(14);
--   ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_status_check;
--   ALTER TABLE rooms ADD CONSTRAINT rooms_status_check
--     CHECK (status IN ('lobby','voting','voting_ending','scoring','announcing','done'));
--   ALTER TABLE rooms ADD COLUMN IF NOT EXISTS voting_ends_at TIMESTAMPTZ;
--   ALTER TABLE rooms ADD COLUMN IF NOT EXISTS voting_ended_at TIMESTAMPTZ;
```

- [ ] **Step 2: Update `SUPABASE_SETUP.md`**

In `SUPABASE_SETUP.md`, find the changelog/migrations section. Append a new bullet under the latest date:

```
- 2026-04-27 (R0+R4 §6.3.1) — re-apply schema for voting_ending status:
  - `ALTER TABLE rooms ALTER COLUMN status TYPE VARCHAR(14);`
  - `ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_status_check; ALTER TABLE rooms ADD CONSTRAINT rooms_status_check CHECK (status IN ('lobby','voting','voting_ending','scoring','announcing','done'));`
  - `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS voting_ends_at TIMESTAMPTZ;`
  - `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS voting_ended_at TIMESTAMPTZ;`
```

(Match the formatting convention of the previous changelog entries — read the file first to confirm exact heading style.)

- [ ] **Step 3: Update `src/types/database.ts` rooms shape**

In `src/types/database.ts`, in the `rooms` block (lines 35–84), add the two new columns to `Row`, `Insert`, and `Update`:

```ts
        Row: {
          id: string;
          pin: string;
          year: number;
          event: string;
          categories: Array<{ name: string; weight: number; hint?: string }>;
          owner_user_id: string;
          status: string;
          announcement_mode: string;
          announcement_order: string[] | null;
          announcing_user_id: string | null;
          current_announce_idx: number;
          delegate_user_id: string | null;
          now_performing_id: string | null;
          allow_now_performing: boolean;
          voting_ends_at: string | null;
          voting_ended_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          pin: string;
          year: number;
          event: string;
          categories: Array<{ name: string; weight: number; hint?: string }>;
          owner_user_id: string;
          status?: string;
          announcement_mode?: string;
          announcement_order?: string[] | null;
          announcing_user_id?: string | null;
          current_announce_idx?: number;
          delegate_user_id?: string | null;
          now_performing_id?: string | null;
          allow_now_performing?: boolean;
          voting_ends_at?: string | null;
          voting_ended_at?: string | null;
        };
        Update: {
          pin?: string;
          year?: number;
          event?: string;
          categories?: Array<{ name: string; weight: number; hint?: string }>;
          status?: string;
          announcement_mode?: string;
          announcement_order?: string[] | null;
          announcing_user_id?: string | null;
          current_announce_idx?: number;
          delegate_user_id?: string | null;
          now_performing_id?: string | null;
          allow_now_performing?: boolean;
          voting_ends_at?: string | null;
          voting_ended_at?: string | null;
        };
```

- [ ] **Step 4: Type-check**

Run: `npm run type-check`
Expected: PASS — DB types extended; no callers reference the new columns yet.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql SUPABASE_SETUP.md src/types/database.ts
git commit -m "feat(schema): voting_ending status + voting_ends_at/voting_ended_at columns

R0 + R4 §6.3.1 schema delta. Additive: bumps rooms.status VARCHAR
to 14, adds voting_ending to the CHECK constraint, adds two
nullable timestamp columns. SUPABASE_SETUP.md changelog entry
documents the re-apply ALTERs for existing databases."
```

---

## Task 2: Domain types (RoomStatus + RoomEvent + Room + RoomEventPayload + mapRoom)

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/rooms/shared.ts`

- [ ] **Step 1: Extend RoomStatus + RoomEvent in `src/types/index.ts`**

Find `export type RoomStatus = "lobby" | "voting" | "scoring" | "announcing" | "done";` and replace with:

```ts
export type RoomStatus =
  | "lobby"
  | "voting"
  | "voting_ending"
  | "scoring"
  | "announcing"
  | "done";
```

Find the `RoomEvent` discriminated union and add the new variant after `status_changed`:

```ts
export type RoomEvent =
  | { type: "status_changed"; status: RoomStatus }
  | { type: "voting_ending"; votingEndsAt: string }
  | { type: "user_joined"; user: { id: string; displayName: string; avatarSeed: string } }
  | { type: "user_left"; userId: string }
  | { type: "now_performing"; contestantId: string }
  | { type: "voting_progress"; userId: string; contestantId: string; scoredCount: number }
  | { type: "announce_next"; contestantId: string; points: number; announcingUserId: string }
  | { type: "announce_turn"; userId: string }
  | { type: "score_update"; contestantId: string; newTotal: number; newRank: number };
```

Find the `Room` interface and add two new fields just before `createdAt`:

```ts
export interface Room {
  id: string;
  pin: string;
  year: number;
  event: EventType;
  categories: VotingCategory[];
  ownerUserId: string;
  status: RoomStatus;
  announcementMode: AnnouncementMode;
  announcementOrder: string[] | null;
  announcingUserId: string | null;
  currentAnnounceIdx: number;
  nowPerformingId: string | null;
  allowNowPerforming: boolean;
  votingEndsAt: string | null;
  votingEndedAt: string | null;
  createdAt: string;
}
```

- [ ] **Step 2: Extend RoomEventPayload + mapRoom in `src/lib/rooms/shared.ts`**

In `src/lib/rooms/shared.ts`, add the new variant to `RoomEventPayload` (just after `status_changed`):

```ts
export type RoomEventPayload =
  | { type: "status_changed"; status: string }
  | { type: "voting_ending"; votingEndsAt: string }
  | { type: "now_performing"; contestantId: string }
  | { type: "user_joined"; user: { id: string; displayName: string; avatarSeed: string } }
  | { type: "voting_progress"; userId: string; contestantId: string; scoredCount: number }
  | { type: "announce_next"; contestantId: string; points: number; announcingUserId: string }
  | { type: "score_update"; contestantId: string; newTotal: number; newRank: number };
```

In `mapRoom`, add the two new fields to the returned object before `createdAt`:

```ts
export function mapRoom(row: RoomRow): Room {
  return {
    id: row.id,
    pin: row.pin,
    year: row.year,
    event: row.event as Room["event"],
    categories: row.categories,
    ownerUserId: row.owner_user_id,
    status: row.status as Room["status"],
    announcementMode: row.announcement_mode as Room["announcementMode"],
    announcementOrder: row.announcement_order,
    announcingUserId: row.announcing_user_id,
    currentAnnounceIdx: row.current_announce_idx,
    nowPerformingId: row.now_performing_id,
    allowNowPerforming: row.allow_now_performing,
    votingEndsAt: row.voting_ends_at,
    votingEndedAt: row.voting_ended_at,
    createdAt: row.created_at,
  };
}
```

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS. Existing callers of `Room` already work because the new fields are optional in spirit (always present, but null-tolerant). Existing exhaustive switches over `RoomEvent` in subscribers must add a `voting_ending` arm — find them with grep:

```bash
git grep -n 'case "status_changed"\|case "now_performing"' src
```

For any switch missing a `voting_ending` arm: add it as a no-op (`case "voting_ending": break;`). The next task (UI wiring) will replace those no-ops with real handling, but the type-check has to be green now.

If type-check fails because a test fixture uses `Room` and doesn't include `votingEndsAt`/`votingEndedAt`, search for fixture builders:

```bash
git grep -n 'allowNowPerforming' src/lib src/app/api
```

For each occurrence in `*.test.ts`, add `votingEndsAt: null, votingEndedAt: null,` to the fixture object.

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: PASS — same baseline (818 passed). The type extensions don't change runtime behaviour.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/lib/rooms/shared.ts $(git ls-files --modified src/lib src/app/api '*.test.ts')
git commit -m "feat(types): voting_ending status + voting_ending broadcast event

Extends RoomStatus union, RoomEvent discriminated union (server +
client mirrors), Room domain interface (votingEndsAt/votingEndedAt),
and mapRoom translator. Test fixtures updated to include the new
nullable fields."
```

---

## Task 3: `votingEndingTimer` pure helper (TDD)

**Files:**
- Create: `src/lib/rooms/votingEndingTimer.ts`
- Create: `src/lib/rooms/votingEndingTimer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/rooms/votingEndingTimer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { votingEndingTimer } from "./votingEndingTimer";

const REF = new Date("2026-04-27T10:00:00.000Z");

describe("votingEndingTimer", () => {
  it("returns zero/false for null votingEndsAt (status not voting_ending)", () => {
    expect(votingEndingTimer({ votingEndsAt: null, now: REF })).toEqual({
      remainingMs: 0,
      remainingSeconds: 0,
      expired: false,
    });
  });

  it("returns 5000ms / 5s when deadline is exactly 5 seconds in the future", () => {
    const ends = new Date(REF.getTime() + 5000).toISOString();
    expect(votingEndingTimer({ votingEndsAt: ends, now: REF })).toEqual({
      remainingMs: 5000,
      remainingSeconds: 5,
      expired: false,
    });
  });

  it("ceils sub-second remainders", () => {
    const ends = new Date(REF.getTime() + 4500).toISOString();
    const r = votingEndingTimer({ votingEndsAt: ends, now: REF });
    expect(r.remainingMs).toBe(4500);
    expect(r.remainingSeconds).toBe(5);
    expect(r.expired).toBe(false);
  });

  it("returns expired=true when deadline equals now", () => {
    const r = votingEndingTimer({ votingEndsAt: REF.toISOString(), now: REF });
    expect(r).toEqual({ remainingMs: 0, remainingSeconds: 0, expired: true });
  });

  it("clamps remainingMs >= 0 when deadline is in the past", () => {
    const ends = new Date(REF.getTime() - 1).toISOString();
    expect(votingEndingTimer({ votingEndsAt: ends, now: REF })).toEqual({
      remainingMs: 0,
      remainingSeconds: 0,
      expired: true,
    });
  });

  it("ceils 100ms remainder to 1 second", () => {
    const ends = new Date(REF.getTime() + 100).toISOString();
    const r = votingEndingTimer({ votingEndsAt: ends, now: REF });
    expect(r.remainingMs).toBe(100);
    expect(r.remainingSeconds).toBe(1);
    expect(r.expired).toBe(false);
  });

  it("falls back to zero/false on invalid ISO string", () => {
    expect(
      votingEndingTimer({ votingEndsAt: "not-a-date", now: REF })
    ).toEqual({ remainingMs: 0, remainingSeconds: 0, expired: false });
  });

  it("handles far-future deadlines correctly", () => {
    const ends = new Date(REF.getTime() + 3600 * 1000).toISOString();
    const r = votingEndingTimer({ votingEndsAt: ends, now: REF });
    expect(r.remainingMs).toBe(3600 * 1000);
    expect(r.remainingSeconds).toBe(3600);
    expect(r.expired).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/rooms/votingEndingTimer.test.ts`
Expected: FAIL — `Cannot find module './votingEndingTimer'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/rooms/votingEndingTimer.ts`:

```ts
export interface VotingEndingTimerInput {
  votingEndsAt: string | null;
  now: Date;
}

export interface VotingEndingTimerResult {
  remainingMs: number;
  remainingSeconds: number;
  expired: boolean;
}

const ZERO: VotingEndingTimerResult = {
  remainingMs: 0,
  remainingSeconds: 0,
  expired: false,
};

/**
 * Pure helper for the SPEC §6.3.1 5-second undo countdown.
 * Returns remaining time and an `expired` flag derived from a server-issued
 * deadline ISO string and a caller-supplied "now" reference.
 *
 * Behaviour:
 *   - votingEndsAt is null → caller should not render a countdown (zero/false).
 *   - votingEndsAt parses to NaN → graceful zero/false fallback.
 *   - votingEndsAt is in the past or equals now → expired=true, remainingMs clamped to 0.
 *   - Otherwise → remainingMs is the positive delta and remainingSeconds is its ceil.
 */
export function votingEndingTimer(
  input: VotingEndingTimerInput
): VotingEndingTimerResult {
  if (input.votingEndsAt === null) return ZERO;
  const t = Date.parse(input.votingEndsAt);
  if (Number.isNaN(t)) return ZERO;
  const deltaMs = t - input.now.getTime();
  if (deltaMs <= 0) {
    return { remainingMs: 0, remainingSeconds: 0, expired: true };
  }
  return {
    remainingMs: deltaMs,
    remainingSeconds: Math.ceil(deltaMs / 1000),
    expired: false,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/rooms/votingEndingTimer.test.ts`
Expected: PASS — 8 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rooms/votingEndingTimer.ts src/lib/rooms/votingEndingTimer.test.ts
git commit -m "feat(rooms): votingEndingTimer pure helper (R4 §6.3.1)

Computes remaining ms / ceil-seconds / expired flag from a
server-issued deadline ISO + caller-supplied now reference.
Graceful fallback for null/invalid inputs."
```

---

## Task 4: `updateStatus` — voting → voting_ending + undo

**Files:**
- Modify: `src/lib/rooms/updateStatus.ts`
- Modify: `src/lib/rooms/updateStatus.test.ts`

- [ ] **Step 1: Add the new failing tests**

In `src/lib/rooms/updateStatus.test.ts`, append new test cases inside the existing `describe("updateRoomStatus", ...)` block. They follow the existing test scaffolding pattern (deps mock with supabase + broadcastRoomEvent).

```ts
  it("transitions voting → voting_ending and writes voting_ends_at", async () => {
    const broadcasts: unknown[] = [];
    const updates: Array<Record<string, unknown>> = [];
    const fakeNow = new Date("2026-04-27T10:00:00.000Z");
    const deps: UpdateStatusDeps = {
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { ...defaultRoomRow, status: "voting" },
                error: null,
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            updates.push(patch);
            return {
              eq: () => ({
                select: () => ({
                  single: async () => ({
                    data: { ...defaultUpdatedRow, status: "voting_ending", voting_ends_at: new Date(fakeNow.getTime() + 5000).toISOString() },
                    error: null,
                  }),
                }),
              }),
            };
          },
        }) as never,
      } as never,
      broadcastRoomEvent: vi.fn(async (_id, event) => {
        broadcasts.push(event);
      }),
      now: () => fakeNow,
    };

    const result = await updateRoomStatus(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, status: "voting_ending" },
      deps
    );

    expect(result.ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe("voting_ending");
    expect(updates[0].voting_ends_at).toBe(
      new Date(fakeNow.getTime() + 5000).toISOString()
    );
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toEqual({
      type: "voting_ending",
      votingEndsAt: new Date(fakeNow.getTime() + 5000).toISOString(),
    });
  });

  it("transitions voting_ending → voting (undo) and clears voting_ends_at", async () => {
    const broadcasts: unknown[] = [];
    const updates: Array<Record<string, unknown>> = [];
    const fakeNow = new Date("2026-04-27T10:00:02.000Z");
    const futureDeadline = new Date("2026-04-27T10:00:05.000Z").toISOString();
    const deps: UpdateStatusDeps = {
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { ...defaultRoomRow, status: "voting_ending", voting_ends_at: futureDeadline },
                error: null,
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            updates.push(patch);
            return {
              eq: () => ({
                select: () => ({
                  single: async () => ({
                    data: { ...defaultUpdatedRow, status: "voting", voting_ends_at: null },
                    error: null,
                  }),
                }),
              }),
            };
          },
        }) as never,
      } as never,
      broadcastRoomEvent: vi.fn(async (_id, event) => {
        broadcasts.push(event);
      }),
      now: () => fakeNow,
    };

    const result = await updateRoomStatus(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, status: "voting" },
      deps
    );

    expect(result.ok).toBe(true);
    expect(updates[0]).toEqual({ status: "voting", voting_ends_at: null });
    expect(broadcasts[0]).toEqual({ type: "status_changed", status: "voting" });
  });

  it("rejects voting_ending → voting undo after deadline (409)", async () => {
    const fakeNow = new Date("2026-04-27T10:00:10.000Z");
    const pastDeadline = new Date("2026-04-27T10:00:05.000Z").toISOString();
    const deps: UpdateStatusDeps = {
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { ...defaultRoomRow, status: "voting_ending", voting_ends_at: pastDeadline },
                error: null,
              }),
            }),
          }),
          update: () => {
            throw new Error("update should not be called");
          },
        }) as never,
      } as never,
      broadcastRoomEvent: vi.fn(),
      now: () => fakeNow,
    };

    const result = await updateRoomStatus(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, status: "voting" },
      deps
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error.code).toBe("INVALID_TRANSITION");
    }
  });
```

NOTE: the existing `defaultUpdatedRow` test fixture (lines 17–30 in the existing file) needs `voting_ends_at: null, voting_ended_at: null` appended in Task 2, Step 3. If you skipped that update, do it now or the new tests' return shapes will diverge.

The existing parameterised "rejects invalid statuses" test (look for `it.each([undefined, null, 42, "", "scoring", "announcing", "lobby", "voting_ending"])`) excludes `voting_ending` because at the time of that test, `voting_ending` was rejected. Now it must be removed from the rejected list. Edit that array in the same file: change `"voting_ending"` to **omit** it (just delete that string). Replace with a new `it.each` line for clarity if needed:

```ts
  // Old:
  // it.each([undefined, null, 42, "", "scoring", "announcing", "lobby", "voting_ending"])(
  // New:
  it.each([undefined, null, 42, "", "scoring", "announcing", "lobby"])(
```

- [ ] **Step 2: Run tests to verify the new ones fail (and the old still pass)**

Run: `npx vitest run src/lib/rooms/updateStatus.test.ts`
Expected: 3 new tests FAIL (transition not allowed / no `now` dep / no `voting_ending` event variant). Existing tests should pass.

- [ ] **Step 3: Modify `updateRoomStatus`**

In `src/lib/rooms/updateStatus.ts`, replace the file contents:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Room } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";
import { mapRoom, type RoomEventPayload } from "@/lib/rooms/shared";

export interface UpdateStatusInput {
  roomId: unknown;
  status: unknown;
  userId: unknown;
}

export interface UpdateStatusDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
  /** Injected for tests; defaults to `() => new Date()`. */
  now?: () => Date;
}

export interface UpdateStatusSuccess {
  ok: true;
  room: Room;
}

export interface UpdateStatusFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type UpdateStatusResult = UpdateStatusSuccess | UpdateStatusFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_REQUESTED_STATUSES: ReadonlySet<string> = new Set([
  "voting",
  "voting_ending",
  "done",
]);

const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  lobby: ["voting"],
  voting: ["voting_ending"],
  voting_ending: ["voting"],
  announcing: ["done"],
};

/** SPEC §6.3.1: 5-second undo window. */
const VOTING_ENDING_WINDOW_MS = 5000;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): UpdateStatusFailure {
  return { ok: false, error: field ? { code, message, field } : { code, message }, status };
}

type RoomRow = Database["public"]["Tables"]["rooms"]["Row"];

export async function updateRoomStatus(
  input: UpdateStatusInput,
  deps: UpdateStatusDeps
): Promise<UpdateStatusResult> {
  if (typeof input.roomId !== "string" || !UUID_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID.", 400, "roomId");
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return fail("INVALID_USER_ID", "userId must be a non-empty string.", 400, "userId");
  }
  if (typeof input.status !== "string" || !ALLOWED_REQUESTED_STATUSES.has(input.status)) {
    return fail(
      "INVALID_STATUS",
      "status must be one of 'voting', 'voting_ending', or 'done'.",
      400,
      "status"
    );
  }
  const roomId = input.roomId;
  const userId = input.userId;
  const status = input.status;
  const now = deps.now ? deps.now() : new Date();

  const roomQuery = await deps.supabase
    .from("rooms")
    .select("id, status, owner_user_id, voting_ends_at")
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const row = roomQuery.data as {
    id: string;
    status: string;
    owner_user_id: string;
    voting_ends_at: string | null;
  };

  if (row.owner_user_id !== userId) {
    return fail(
      "FORBIDDEN",
      "Only the room owner can change the room's status.",
      403
    );
  }

  const allowed = ALLOWED_TRANSITIONS[row.status] ?? [];
  if (!allowed.includes(status)) {
    return fail(
      "INVALID_TRANSITION",
      `Cannot transition from '${row.status}' to '${status}'.`,
      409
    );
  }

  // Special-case: undo voting_ending → voting only allowed before deadline.
  if (row.status === "voting_ending" && status === "voting") {
    if (!row.voting_ends_at || Date.parse(row.voting_ends_at) <= now.getTime()) {
      return fail(
        "INVALID_TRANSITION",
        "Undo window has already elapsed.",
        409
      );
    }
  }

  // Build the patch.
  let patch: Record<string, unknown>;
  let broadcast: RoomEventPayload;
  if (row.status === "voting" && status === "voting_ending") {
    const votingEndsAt = new Date(now.getTime() + VOTING_ENDING_WINDOW_MS).toISOString();
    patch = { status, voting_ends_at: votingEndsAt };
    broadcast = { type: "voting_ending", votingEndsAt };
  } else if (row.status === "voting_ending" && status === "voting") {
    patch = { status, voting_ends_at: null };
    broadcast = { type: "status_changed", status };
  } else {
    patch = { status };
    broadcast = { type: "status_changed", status };
  }

  const updateResult = await deps.supabase
    .from("rooms")
    .update(patch)
    .eq("id", roomId)
    .select()
    .single();

  if (updateResult.error || !updateResult.data) {
    return fail("INTERNAL_ERROR", "Could not update room. Please try again.", 500);
  }

  try {
    await deps.broadcastRoomEvent(roomId, broadcast);
  } catch (err) {
    console.warn(
      `broadcast failed for room ${roomId}; state committed regardless:`,
      err
    );
  }

  return { ok: true, room: mapRoom(updateResult.data as RoomRow) };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/rooms/updateStatus.test.ts`
Expected: PASS — all 3 new tests + every existing one.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rooms/updateStatus.ts src/lib/rooms/updateStatus.test.ts
git commit -m "feat(rooms): voting → voting_ending + voting_ending → voting undo

Server-authoritative 5s undo window per SPEC §6.3.1. Adds the new
transitions to updateRoomStatus, computes voting_ends_at from a
DI'd 'now', emits a 'voting_ending' broadcast event, validates
the deadline on undo (409 if elapsed)."
```

---

## Task 5: `runScoring` — accept voting_ending + timer guard

**Files:**
- Modify: `src/lib/rooms/runScoring.ts`
- Modify: `src/lib/rooms/runScoring.test.ts`

- [ ] **Step 1: Read the existing runScoring + test scaffolding**

Run: `head -80 src/lib/rooms/runScoring.ts && head -80 src/lib/rooms/runScoring.test.ts`

Identify (a) the status guard line (currently `if (room.status !== "voting" && room.status !== "scoring")`); (b) the conditional UPDATE around `voting → scoring`; (c) the existing test that asserts the guard rejects e.g. `lobby`. The new tests must follow the same scaffolding (mock supabase chain).

- [ ] **Step 2: Write failing tests**

Append to `src/lib/rooms/runScoring.test.ts` inside the existing `describe`:

```ts
  it("accepts voting_ending status when voting_ends_at has elapsed", async () => {
    const fakeNow = new Date("2026-04-27T10:00:10.000Z");
    const elapsedDeadline = "2026-04-27T10:00:05.000Z";
    // Build deps mock with voting_ending status; reuse the standard
    // "happy path" mock and override the room row's status + voting_ends_at.
    // (Match the existing test's mock-builder pattern; copy from the
    // first happy-path test in this file and tweak the room row.)
    const deps = makeRunScoringDeps({
      roomRow: { status: "voting_ending", voting_ends_at: elapsedDeadline },
      now: () => fakeNow,
    });

    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      deps
    );

    expect(result.ok).toBe(true);
    expect(deps.recordedUpdates.some(u => u.voting_ended_at)).toBe(true);
  });

  it("rejects voting_ending when voting_ends_at is still in the future", async () => {
    const fakeNow = new Date("2026-04-27T10:00:02.000Z");
    const futureDeadline = "2026-04-27T10:00:05.000Z";
    const deps = makeRunScoringDeps({
      roomRow: { status: "voting_ending", voting_ends_at: futureDeadline },
      now: () => fakeNow,
    });

    const result = await runScoring(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      deps
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error.code).toBe("VOTING_ENDING_NOT_ELAPSED");
    }
  });
```

NOTE on `makeRunScoringDeps`: this is a hypothetical helper. If the existing test file does not already have a builder, **inline the mock** by duplicating the structure of the first existing test in the file. Do NOT introduce a new helper as part of this slice; instead copy + tweak. The pattern is: a `from()` chain returning a function that resolves the room row, etc. The two new tests will be ~40 LOC each — that's the codebase convention.

Also: the new error code `VOTING_ENDING_NOT_ELAPSED` does not exist yet in `src/lib/api-errors.ts`. Add it now:

```bash
git grep -n 'export type ApiErrorCode' src/lib/api-errors.ts
```

Edit `src/lib/api-errors.ts` and add `"VOTING_ENDING_NOT_ELAPSED"` to the `ApiErrorCode` union literal.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/rooms/runScoring.test.ts`
Expected: FAIL — both new tests fail because the runScoring guard rejects `voting_ending`.

- [ ] **Step 4: Modify `runScoring.ts`**

In `src/lib/rooms/runScoring.ts`:

1. Add `now?: () => Date` to `RunScoringDeps` (mirrors `updateStatus`).
2. Update `select(...)` columns to include `voting_ends_at`.
3. Replace the status guard:

```ts
// before
if (room.status !== "voting" && room.status !== "scoring") {
  // fail("INVALID_STATUS", "Scoring can only be triggered while the room is voting.", 409);
}

// after
const VALID_PRE_SCORE_STATUSES = ["voting", "voting_ending", "scoring"] as const;
if (!VALID_PRE_SCORE_STATUSES.includes(room.status as never)) {
  return fail(
    "INVALID_STATUS",
    "Scoring can only be triggered while the room is voting.",
    409
  );
}

if (room.status === "voting_ending") {
  const now = deps.now ? deps.now() : new Date();
  if (!room.voting_ends_at || Date.parse(room.voting_ends_at) > now.getTime()) {
    return fail(
      "VOTING_ENDING_NOT_ELAPSED",
      "Cannot finalize before the countdown completes.",
      409
    );
  }
}
```

4. Update the conditional UPDATE that transitions to `scoring`:

```ts
// before:
.update({ status: "scoring" })
.eq("id", roomId)
.in("status", ["voting", "scoring"])

// after:
.update({ status: "scoring", voting_ended_at: (deps.now ? deps.now() : new Date()).toISOString() })
.eq("id", roomId)
.in("status", ["voting", "voting_ending", "scoring"])
```

5. Update the broadcast (already broadcasts `status_changed:scoring` — no change).

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/lib/rooms/runScoring.test.ts`
Expected: PASS — both new tests + every existing one.

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: PASS — types changes from earlier tasks compose with the API extensions.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rooms/runScoring.ts src/lib/rooms/runScoring.test.ts src/lib/api-errors.ts
git commit -m "feat(rooms): runScoring accepts voting_ending after timer elapsed

SPEC §6.3.1 step 5: when voting_ending → scoring fires, requires
voting_ends_at <= now() (else 409 VOTING_ENDING_NOT_ELAPSED).
Atomic update writes voting_ended_at audit timestamp."
```

---

## Task 6: `<EndVotingModal>` component

**Files:**
- Create: `src/components/voting/EndVotingModal.tsx`

No unit tests — voting components in this codebase are validated via dev-server smoke (see `MissedCard.tsx`, `EndOfVotingCard.tsx`). The pure logic for the modal trigger is in the parent.

- [ ] **Step 1: Implement**

Create `src/components/voting/EndVotingModal.tsx`:

```tsx
"use client";

import Button from "@/components/ui/Button";

export interface EndVotingModalProps {
  isOpen: boolean;
  busy?: boolean;
  errorMessage?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function EndVotingModal({
  isOpen,
  busy = false,
  errorMessage,
  onConfirm,
  onCancel,
}: EndVotingModalProps) {
  if (!isOpen) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="end-voting-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
    >
      <div className="w-full max-w-sm rounded-lg bg-card p-5 shadow-xl space-y-4">
        <h2
          id="end-voting-modal-title"
          className="text-lg font-bold text-foreground"
        >
          End voting?
        </h2>
        <p className="text-sm text-muted-foreground">
          Voting ends in 5 seconds. You can undo within that window.
        </p>
        {errorMessage ? (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {errorMessage}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Ending…" : "End voting"}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/voting/EndVotingModal.tsx
git commit -m "feat(voting): EndVotingModal — replaces window.confirm

Standard centered dialog with backdrop. Cancel + confirm buttons,
busy state, error message slot. SPEC §6.3.1."
```

---

## Task 7: `<EndingPill>` (guest variant)

**Files:**
- Create: `src/components/voting/EndingPill.tsx`

- [ ] **Step 1: Implement**

Create `src/components/voting/EndingPill.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { votingEndingTimer } from "@/lib/rooms/votingEndingTimer";

export interface EndingPillProps {
  votingEndsAt: string | null;
}

export default function EndingPill({ votingEndsAt }: EndingPillProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!votingEndsAt) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, [votingEndsAt]);

  if (!votingEndsAt) return null;
  const { remainingSeconds, expired } = votingEndingTimer({
    votingEndsAt,
    now: new Date(),
  });
  // Suppress the ref so eslint doesn't complain about the unused `tick`.
  void tick;

  return (
    <div
      role="status"
      data-testid="ending-pill"
      className="fixed top-3 left-1/2 z-30 -translate-x-1/2 rounded-full bg-accent/15 px-4 py-1.5 text-xs font-medium text-foreground shadow-sm"
    >
      {expired
        ? "Voting ending…"
        : `Voting ending in ${remainingSeconds}s…`}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/voting/EndingPill.tsx
git commit -m "feat(voting): EndingPill — passive guest countdown

Top-of-screen pill rendered for non-admin viewers during
voting_ending. Reads votingEndsAt + ticks at 250ms via local state.
No buttons; voting continues underneath. SPEC §6.3.1."
```

---

## Task 8: `<EndVotingCountdownToast>` (admin variant)

**Files:**
- Create: `src/components/voting/EndVotingCountdownToast.tsx`

- [ ] **Step 1: Implement**

Create `src/components/voting/EndVotingCountdownToast.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { votingEndingTimer } from "@/lib/rooms/votingEndingTimer";

export interface EndVotingCountdownToastProps {
  votingEndsAt: string | null;
  onUndo: () => void;
  /** Called once when the countdown reaches zero. Caller fires POST /score. */
  onElapsed: () => void;
  undoBusy?: boolean;
}

export default function EndVotingCountdownToast({
  votingEndsAt,
  onUndo,
  onElapsed,
  undoBusy = false,
}: EndVotingCountdownToastProps) {
  const [, setTick] = useState(0);
  const elapsedFiredRef = useRef(false);

  useEffect(() => {
    if (!votingEndsAt) {
      elapsedFiredRef.current = false;
      return;
    }
    const id = window.setInterval(() => setTick((n) => n + 1), 100);
    return () => window.clearInterval(id);
  }, [votingEndsAt]);

  useEffect(() => {
    elapsedFiredRef.current = false;
  }, [votingEndsAt]);

  if (!votingEndsAt) return null;
  const { remainingSeconds, expired } = votingEndingTimer({
    votingEndsAt,
    now: new Date(),
  });

  if (expired && !elapsedFiredRef.current) {
    elapsedFiredRef.current = true;
    onElapsed();
  }

  return (
    <div
      role="status"
      data-testid="end-voting-countdown-toast"
      className="fixed top-3 left-1/2 z-40 -translate-x-1/2 flex items-center gap-3 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground shadow-lg"
    >
      <span>
        {expired
          ? "Finalising…"
          : `Voting ends in ${remainingSeconds}s`}
      </span>
      {!expired ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={onUndo}
          disabled={undoBusy}
          aria-label="Undo end voting"
        >
          {undoBusy ? "Undoing…" : "Undo"}
        </Button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/voting/EndVotingCountdownToast.tsx
git commit -m "feat(voting): EndVotingCountdownToast — admin countdown + Undo

Admin-only top-of-screen toast during voting_ending. Ticks at
100ms; renders 'Voting ends in Ns' + Undo button until expiry,
then 'Finalising…' and fires onElapsed once via firedRef guard.
SPEC §6.3.1."
```

---

## Task 9: Wire-in to `/room/[id]/page.tsx` + `useRoomRealtime` + remove floating pill

**Files:**
- Modify: `src/app/room/[id]/page.tsx`
- Modify: `src/hooks/useRoomRealtime.ts`
- Modify: `src/lib/room/api.ts` (or wherever postRoomScore + a new postRoomStatus live)

- [ ] **Step 1: Add a `postRoomStatus` API helper**

In `src/lib/room/api.ts` (where `postRoomScore` lives — confirm path with `git grep -n "postRoomScore" src/lib/room`), add:

```ts
export interface PostRoomStatusResult {
  ok: boolean;
  code?: string;
}

export async function postRoomStatus(
  roomId: string,
  userId: string,
  status: "voting" | "voting_ending",
  opts: { fetch: typeof fetch }
): Promise<PostRoomStatusResult> {
  const res = await opts.fetch(`/api/rooms/${roomId}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, status }),
  });
  if (res.ok) return { ok: true };
  let code: string | undefined;
  try {
    const body = await res.json();
    code = body?.code;
  } catch {}
  return { ok: false, code };
}
```

- [ ] **Step 2: Modify `useRoomRealtime` to handle `voting_ending`**

In `src/hooks/useRoomRealtime.ts`, find the message switch (search for `case "status_changed"` or `event.type`). Add a case for `voting_ending`:

```ts
case "voting_ending":
  // Trigger the same refetch flow as status_changed; the page reads votingEndsAt off the refetched room.
  refetch();
  break;
```

If the switch uses an exhaustive `never` branch, the type-check will guide placement.

- [ ] **Step 3: Replace `handleEndVoting` and remove the floating pill**

In `src/app/room/[id]/page.tsx`:

a. Add new state + handlers near the top of the component:

```ts
const [endVotingModalOpen, setEndVotingModalOpen] = useState(false);
const [endVotingBusy, setEndVotingBusy] = useState(false);
const [endVotingError, setEndVotingError] = useState<string | null>(null);
const [undoBusy, setUndoBusy] = useState(false);
const finalizeFiredRef = useRef(false);

const startEndVoting = useCallback(async () => {
  const session = getSession();
  if (!session) return;
  setEndVotingBusy(true);
  setEndVotingError(null);
  const result = await postRoomStatus(roomId, session.userId, "voting_ending", {
    fetch: window.fetch.bind(window),
  });
  setEndVotingBusy(false);
  if (result.ok) {
    setEndVotingModalOpen(false);
    return;
  }
  setEndVotingError(mapRoomError(result.code));
}, [roomId]);

const undoEndVoting = useCallback(async () => {
  const session = getSession();
  if (!session) return;
  setUndoBusy(true);
  await postRoomStatus(roomId, session.userId, "voting", {
    fetch: window.fetch.bind(window),
  });
  setUndoBusy(false);
}, [roomId]);

const finalizeVoting = useCallback(async () => {
  if (finalizeFiredRef.current) return;
  finalizeFiredRef.current = true;
  const session = getSession();
  if (!session) return;
  await postRoomScore(roomId, session.userId, {
    fetch: window.fetch.bind(window),
  });
}, [roomId]);
```

b. Remove the existing `handleEndVoting` function and replace its caller with a button that opens the modal:

```ts
// REMOVE:
//   const handleEndVoting = useCallback(...)
// And the JSX block at lines ~341–361 (the `fixed top-3 right-3` pill).
```

c. In the JSX, where the voting branch is rendered (around lines 338+), insert (admin only):

```tsx
{phase.room.status === "voting_ending" ? (
  isAdmin ? (
    <EndVotingCountdownToast
      votingEndsAt={phase.room.votingEndsAt}
      onUndo={undoEndVoting}
      onElapsed={finalizeVoting}
      undoBusy={undoBusy}
    />
  ) : (
    <EndingPill votingEndsAt={phase.room.votingEndsAt} />
  )
) : null}
<EndVotingModal
  isOpen={endVotingModalOpen}
  busy={endVotingBusy}
  errorMessage={endVotingError}
  onConfirm={startEndVoting}
  onCancel={() => {
    setEndVotingModalOpen(false);
    setEndVotingError(null);
  }}
/>
```

d. Add the End-voting button to the admin VotingView header. Two options:

- (Simpler) Pass a new prop `onEndVoting?: () => void` to `<VotingView>` and have VotingView render a small button next to the SaveChip cluster when `isAdmin && onEndVoting`.
- (Faster, MVP) Render a button inline in `room/[id]/page.tsx` adjacent to the rendered VotingView, but inside the same flex container.

Pick the prop approach — it co-locates header chrome and matches existing patterns. In `VotingView.tsx`, add to the props interface:

```ts
onEndVoting?: () => void;
```

In the destructure:

```ts
onEndVoting,
```

In the header JSX, next to the existing right-side cluster (`flex flex-col items-end gap-1 flex-shrink-0`), at the top:

```tsx
{onEndVoting ? (
  <Button
    variant="destructive"
    size="sm"
    onClick={onEndVoting}
    aria-label="End voting"
    className="self-end"
  >
    End voting
  </Button>
) : null}
```

In `room/[id]/page.tsx`, pass:

```tsx
onEndVoting={isAdmin ? () => setEndVotingModalOpen(true) : undefined}
```

e. Add the auto-fire effect for stale loads (admin reloads after deadline):

```ts
useEffect(() => {
  if (phase.kind !== "ready") return;
  if (!isAdmin) return;
  const r = phase.room;
  if (r.status !== "voting_ending") return;
  if (!r.votingEndsAt) return;
  if (new Date(r.votingEndsAt).getTime() > Date.now()) return;
  void finalizeVoting();
}, [phase, isAdmin, finalizeVoting]);
```

- [ ] **Step 4: Type-check + tests**

Run: `npm run type-check && npx vitest run`
Expected: PASS — type-check clean, all 818 + 13 new tests green.

- [ ] **Step 5: Commit**

```bash
git add src/app/room/[id]/page.tsx src/hooks/useRoomRealtime.ts src/lib/room/api.ts src/components/voting/VotingView.tsx
git commit -m "feat(voting): wire voting_ending UI into room page

- Replaces window.confirm flow with EndVotingModal trigger.
- Removes the floating top-right pill; new End-voting button lives
  in VotingView header chrome (admin-only).
- Mounts EndVotingCountdownToast (admin) / EndingPill (guest)
  during voting_ending status.
- Auto-fires POST /score on admin page-load when deadline already
  elapsed (stale-reload recovery).
- useRoomRealtime handles the new voting_ending broadcast variant.
- New postRoomStatus helper alongside postRoomScore."
```

---

## Task 10: Verify + locale keys + ship

**Files:**
- Modify: `src/locales/en.json`
- Update: `TODO.md` (gitignored, no commit needed)

- [ ] **Step 1: Add locale keys**

In `src/locales/en.json`, append a new block to the `voting` namespace:

```json
    "endVoting": {
      "button": "End voting",
      "modal": {
        "title": "End voting?",
        "body": "Voting ends in 5 seconds. You can undo within that window.",
        "confirm": "End voting",
        "cancel": "Cancel"
      },
      "countdown": {
        "body": "Voting ends in {seconds}s",
        "finalising": "Finalising…",
        "undo": "Undo"
      },
      "guest": {
        "body": "Voting ending in {seconds}s…"
      }
    }
```

(Components currently render English literals matching codebase convention; the keys are added for the upcoming Phase L L1 extraction PR.)

- [ ] **Step 2: Run final verification**

```bash
npm run type-check && npx vitest run && npm run lint
```

Expected:
- type-check exit 0
- vitest 100% pass (~830 tests)
- lint clean (or unchanged from main's baseline)

- [ ] **Step 3: Apply migration locally + manual smoke**

In Supabase Studio (local or hosted), run the migration ALTERs from `SUPABASE_SETUP.md`. Then:

```bash
npm run dev
```

Smoke matrix (each scenario takes <1 min):

1. **Modal happy path**: tap End voting (admin) → modal appears → tap End voting → modal closes → countdown toast appears → wait 5s → "Finalising…" → status flips to scoring → page navigates per existing flow.
2. **Undo**: tap End voting → confirm → countdown shows → tap Undo within 5s → countdown disappears → guests' votes still register.
3. **Refresh during countdown** (admin): start countdown → reload page → countdown resumes from server clock with reduced remaining time.
4. **Refresh after deadline** (admin): start countdown → close tab → wait 10s → reopen page → page auto-fires /score → status flips.
5. **Guest view**: open as a non-admin in a second browser → admin starts countdown → guest sees passive pill at top.
6. **Two admin tabs**: open admin in two tabs → admin starts countdown in tab A → both tabs render countdown → at t=0, only first /score call wins; second 409s silently.

If any scenario fails, fix and re-run.

- [ ] **Step 4: Update TODO.md (gitignored)**

In `/Users/valeriiakulynych/Projects/eurovisionmaxxing/TODO.md`, find the R0 + R4 lines and tick the relevant ones:

```diff
- [ ] Extend `rooms.status` CHECK to include `voting_ending`; bump VARCHAR to 14 (§6.3.1, §13)
+ [x] Extend `rooms.status` CHECK to include `voting_ending`; bump VARCHAR to 14 (§6.3.1, §13)

- [ ] Add `rooms.voting_ends_at TIMESTAMPTZ` + `rooms.voting_ended_at TIMESTAMPTZ` (§13)
+ [x] Add `rooms.voting_ends_at TIMESTAMPTZ` + `rooms.voting_ended_at TIMESTAMPTZ` (§13)
```

And the R4 §6.3.1 line:

```diff
- [~] §6.3.1 "End voting" undo — new intermediate status `voting_ending`, server-authoritative 5-s countdown, client toast with Undo  _(interim placeholder shipped in PR #36...)_
+ [x] §6.3.1 "End voting" undo — new intermediate status `voting_ending`, server-authoritative 5-s countdown, client toast with Undo  _(landed on `feat/voting-ending-undo`: schema migration + updateRoomStatus extensions + runScoring guards + EndVotingModal/CountdownToast/EndingPill + header-chrome End voting button. Spec: `docs/superpowers/specs/2026-04-27-voting-ending-undo-design.md`.)_
```

And the next two R4 lines:

```diff
- [ ] **Replace the interim "End voting" pill** ...
+ [x] **Replace the interim "End voting" pill** ... _(landed in same slice)_

- [ ] `POST /api/rooms/{id}/status/undo` — revert `voting_ending` → `voting` if within window; 409 otherwise; broadcast `status_changed`
+ [x] `POST /api/rooms/{id}/status/undo` — revert `voting_ending` → `voting` if within window; 409 otherwise; broadcast `status_changed`  _(implemented as PATCH /status with the new voting_ending → voting transition rather than a separate /undo route.)_

- [ ] `voting_ending` broadcast payload includes `votingEndsAt` ISO
+ [x] `voting_ending` broadcast payload includes `votingEndsAt` ISO
```

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin feat/voting-ending-undo
gh pr create --title "feat: 'End voting' 5-second undo window (R0 + R4 §6.3.1)" --body "$(cat <<'EOF'
## Summary
Closes SPEC §20 #5 ("admin closes voting with 5-second undo window") directly. Replaces the irreversible \`window.confirm\` floating-pill flow with a server-authoritative undo window:

- New room status \`voting_ending\` + \`voting_ends_at\` deadline column on \`rooms\`.
- \`PATCH /status\` extended for \`voting → voting_ending\` (sets deadline, broadcasts new \`voting_ending\` event) and \`voting_ending → voting\` undo (within deadline only).
- \`POST /score\` extended to accept \`voting_ending\` status when deadline has elapsed; atomic SQL UPDATE makes concurrent finalize calls safe.
- New components: \`<EndVotingModal>\`, \`<EndVotingCountdownToast>\` (admin), \`<EndingPill>\` (guest).
- Floating top-right pill removed; replaces with header-chrome End-voting button.
- Refresh-proof: countdown anchored on server-issued ISO; admin reload auto-fires /score if deadline elapsed.

Spec: [docs/superpowers/specs/2026-04-27-voting-ending-undo-design.md](docs/superpowers/specs/2026-04-27-voting-ending-undo-design.md)
Plan: [docs/superpowers/plans/2026-04-27-voting-ending-undo.md](docs/superpowers/plans/2026-04-27-voting-ending-undo.md)
TODO: R0 (3 lines) + R4 §6.3.1 (4 lines)

## Schema (must re-apply to existing Supabase projects)
See \`SUPABASE_SETUP.md\` changelog. ALTERs are idempotent.

## Verification
- ✅ \`npm run type-check\` clean
- ✅ \`npx vitest run\` — ~830 passing (incl. 13 new tests across votingEndingTimer / updateStatus / runScoring)
- ✅ \`npm run lint\` baseline-only

## Test plan (manual smoke)
- [ ] Modal → confirm → countdown → expiry → scoring (happy path)
- [ ] Undo within 5s reverts cleanly
- [ ] Admin reload during countdown resumes from server clock
- [ ] Admin reload after deadline auto-fires /score
- [ ] Guest sees passive pill, voting still works
- [ ] Two admin tabs → only first /score wins (409 on second)

## Coordination
\`feat/phase-5c1-instant-mode\` will need to rebase against this PR; expect merge conflicts in \`room/[id]/page.tsx\` (different status branches; resolution is merge-not-overwrite). No schema conflict.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**1. Spec coverage**
- Schema delta (3 columns) → Task 1 ✓
- RoomStatus + RoomEvent + Room + RoomEventPayload + mapRoom → Task 2 ✓
- votingEndingTimer pure helper → Task 3 ✓
- voting → voting_ending transition + 'voting_ending' broadcast → Task 4 ✓
- voting_ending → voting undo with deadline guard → Task 4 ✓
- runScoring accepts voting_ending + timer guard + voting_ended_at write → Task 5 ✓
- EndVotingModal → Task 6 ✓
- EndingPill (guest) → Task 7 ✓
- EndVotingCountdownToast (admin) → Task 8 ✓
- Header-chrome End-voting button + remove floating pill → Task 9 ✓
- useRoomRealtime handles voting_ending → Task 9 ✓
- Stale-reload auto-fire → Task 9 ✓
- Locale keys → Task 10 ✓
- 6-scenario manual smoke → Task 10 ✓

**2. Placeholder scan**
- One spot uses "match the existing test's mock-builder pattern" — this is a directive to copy concrete code, not a TBD. Acceptable.
- Task 1 Step 2 says "Read the file first to confirm exact heading style" — concrete instruction, not a TBD.
- No "TODO", "TBD", "implement later" anywhere.

**3. Type consistency**
- `RoomEventPayload` and `RoomEvent` both add `{ type: "voting_ending"; votingEndsAt: string }` — symmetric.
- `Room.votingEndsAt: string | null` — used consistently in components and `mapRoom`.
- `postRoomStatus(roomId, userId, status, opts)` — second arg userId, third status.
- Error code `VOTING_ENDING_NOT_ELAPSED` — consistent across runScoring + tests + api-errors union.
- `votingEndingTimer({ votingEndsAt, now })` — used identically in `EndingPill`, `EndVotingCountdownToast`, and `runScoring`.

**4. Risks / known sharp edges**
- Tasks 4 + 5 require updating in-line mock objects with `voting_ends_at` / `voting_ended_at` fields. The plan flags this in Task 2 Step 3.
- The "remove the existing handleEndVoting + floating pill" step in Task 9 must use the right line range — a careful Edit not Read+Write.
- Multi-tab safety relies on `runScoring`'s atomic conditional UPDATE; the second tab's `/score` call returns success on the already-scored room (the existing idempotency path). Confirmed by reading runScoring.ts in pre-plan exploration.
