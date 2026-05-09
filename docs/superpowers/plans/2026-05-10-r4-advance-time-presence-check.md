# R4 advance-time presence check — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-authoritative cascade-skip of absent users at every announcement-rotation point (`scoring → announcing` start, every reveal that ends an announcer's queue), driven by a `room_memberships.last_seen_at` heartbeat written from the client every 15 s.

**Architecture:** Pure helper `isAbsent(lastSeenAt, now)` — used by both rotation paths. Cascade reuses the existing `skipAnnouncer` mechanics, refactored into a shared `applySingleSkip` helper. Heartbeat is a `PATCH /api/rooms/{id}/heartbeat` endpoint + `useRoomHeartbeat` hook, fired on `<RoomPage>` mount across all room statuses (so `last_seen_at` is fresh at every transition). Cascade-exhausted lands `announcing_user_id = null` while keeping `status = 'announcing'` — the sentinel items #2/#3 will consume.

**Tech Stack:** Next.js 14 App Router, Supabase (Postgres + Realtime), TypeScript strict, Vitest (jsdom for RTL), Playwright (chromium), `next-intl` for locale strings.

**Spec:** [docs/superpowers/specs/2026-05-10-r4-advance-time-presence-check-design.md](../specs/2026-05-10-r4-advance-time-presence-check-design.md)

**Branch:** `feat/r4-advance-time-presence-check` (already created, spec already committed at 4a0ce3f).

---

## Task 1: Schema migration + types refresh

**Files:**
- Modify: `supabase/schema.sql` (add column)
- Modify: `SUPABASE_SETUP.md` (changelog entry)
- Modify: `src/types/database.ts` (add `last_seen_at` to `room_memberships` row types)

- [ ] **Step 1: Add the column to `supabase/schema.sql`**

Find the `CREATE TABLE room_memberships` block and append the column. Existing pattern (the `scores_locked_at` column from S0) sits at the bottom of the block. Add `last_seen_at` next to it:

```sql
CREATE TABLE IF NOT EXISTS room_memberships (
  ...existing columns...
  scores_locked_at TIMESTAMPTZ,
  last_seen_at    TIMESTAMPTZ
);
```

(Do not duplicate the closing `)` — patch in place.)

- [ ] **Step 2: Add the per-migration ALTER for existing DBs**

In the same `schema.sql`, find the existing `ALTER TABLE room_memberships ADD COLUMN IF NOT EXISTS scores_locked_at` line (S0 migration) and add the new ALTER directly below it, in the same block:

```sql
ALTER TABLE room_memberships
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
```

- [ ] **Step 3: Add the SUPABASE_SETUP.md changelog entry**

Open `SUPABASE_SETUP.md`, find the changelog section (chronological, most recent at top), and add an entry dated 2026-05-10:

```markdown
- **2026-05-10** — Phase R4 advance-time presence check: `room_memberships.last_seen_at TIMESTAMPTZ` (nullable). Used to detect absent announcers at rotation time. Re-apply via SQL Editor: `ALTER TABLE room_memberships ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;`
```

- [ ] **Step 4: Update `src/types/database.ts` to include the new column**

Find the `room_memberships` block (it's a Row + Insert + Update triplet). Add `last_seen_at: string | null;` to Row, and `last_seen_at?: string | null;` to Insert and Update. Mirror the shape of the existing `scores_locked_at` entries.

- [ ] **Step 5: Type-check passes**

Run: `npm run type-check`
Expected: no errors. The schema additions are additive.

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql SUPABASE_SETUP.md src/types/database.ts
git commit -m "feat(schema): R4 — room_memberships.last_seen_at for advance-time presence

Used by the upcoming cascade-skip path (SPEC §10.2.1). Nullable; NULL
reads as absent. Mirrors scores_locked_at additive ALTER pattern from
Phase S0.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `isAbsent` pure helper (TDD)

**Files:**
- Create: `src/lib/rooms/isAbsent.ts`
- Create: `src/lib/rooms/isAbsent.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/rooms/isAbsent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isAbsent } from "@/lib/rooms/isAbsent";

const NOW = new Date("2026-05-10T12:00:00.000Z");

describe("isAbsent", () => {
  it("returns true when lastSeenAt is null (never heartbeated)", () => {
    expect(isAbsent(null, NOW)).toBe(true);
  });

  it("returns false for a fresh heartbeat (1s ago)", () => {
    const fresh = new Date(NOW.getTime() - 1_000).toISOString();
    expect(isAbsent(fresh, NOW)).toBe(false);
  });

  it("returns false at the boundary (exactly 30s ago)", () => {
    const boundary = new Date(NOW.getTime() - 30_000).toISOString();
    expect(isAbsent(boundary, NOW)).toBe(false);
  });

  it("returns true at 30001ms (just past the threshold)", () => {
    const past = new Date(NOW.getTime() - 30_001).toISOString();
    expect(isAbsent(past, NOW)).toBe(true);
  });

  it("respects custom thresholdMs", () => {
    const tenSecondsAgo = new Date(NOW.getTime() - 10_000).toISOString();
    expect(isAbsent(tenSecondsAgo, NOW, 5_000)).toBe(true);
    expect(isAbsent(tenSecondsAgo, NOW, 60_000)).toBe(false);
  });

  it("treats future timestamps as not absent (clock skew tolerance)", () => {
    const future = new Date(NOW.getTime() + 5_000).toISOString();
    expect(isAbsent(future, NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/rooms/isAbsent.test.ts`
Expected: FAIL with module-not-found error on `@/lib/rooms/isAbsent`.

- [ ] **Step 3: Write the minimal implementation**

`src/lib/rooms/isAbsent.ts`:

```ts
/**
 * SPEC §10.2.1 — predicate for the advance-time presence check.
 *
 * A user is "absent" if they have never heartbeated (NULL) or if their
 * last heartbeat is older than the threshold. Default threshold is 30 s
 * to match the spec ("last seen ≤30 s"); 30 s exactly counts as present
 * (boundary is inclusive on the present side).
 *
 * Pure — no Supabase / Date-now dependency. Caller passes `now` explicitly
 * so tests are deterministic and so cascade loops can use a single
 * snapshot of "now" across multiple checks.
 */
export function isAbsent(
  lastSeenAt: string | null,
  now: Date,
  thresholdMs = 30_000,
): boolean {
  if (!lastSeenAt) return true;
  const seenMs = new Date(lastSeenAt).getTime();
  if (Number.isNaN(seenMs)) return true;
  return now.getTime() - seenMs > thresholdMs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/rooms/isAbsent.test.ts`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rooms/isAbsent.ts src/lib/rooms/isAbsent.test.ts
git commit -m "feat(rooms): isAbsent pure helper for advance-time presence check (R4)

Default threshold 30s per SPEC §10.2.1; null lastSeenAt reads as absent;
30s exactly counts as present (boundary inclusive). Future timestamps
tolerated as not-absent (clock skew). Pure — no Supabase / Date.now.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `recordHeartbeat` orchestrator + route adapter

**Files:**
- Create: `src/lib/rooms/recordHeartbeat.ts`
- Create: `src/lib/rooms/recordHeartbeat.test.ts`
- Create: `src/app/api/rooms/[id]/heartbeat/route.ts`

- [ ] **Step 1: Write the failing orchestrator test**

`src/lib/rooms/recordHeartbeat.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  recordHeartbeat,
  type RecordHeartbeatDeps,
} from "@/lib/rooms/recordHeartbeat";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const USER_ID = "10000000-0000-4000-8000-000000000001";

type Mock = { data: unknown; error: { message: string } | null };
interface Scripted {
  membershipUpdate?: Mock;
}

function makeSupabaseMock(s: Scripted = {}) {
  const membershipUpdate =
    s.membershipUpdate ?? { data: { user_id: USER_ID }, error: null };

  const updateCalls: Array<{
    patch: Record<string, unknown>;
    eqs: Array<{ col: string; val: unknown }>;
  }> = [];

  const from = vi.fn((table: string) => {
    if (table === "room_memberships") {
      return {
        update: vi.fn((patch: Record<string, unknown>) => {
          const eqs: Array<{ col: string; val: unknown }> = [];
          updateCalls.push({ patch, eqs });
          const chain = {
            eq: vi.fn((col: string, val: unknown) => {
              eqs.push({ col, val });
              return chain;
            }),
            select: vi.fn(() => ({
              maybeSingle: vi
                .fn()
                .mockResolvedValue(membershipUpdate),
            })),
          };
          return chain;
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as RecordHeartbeatDeps["supabase"],
    updateCalls,
  };
}

describe("recordHeartbeat", () => {
  it("400s on non-UUID roomId", async () => {
    const result = await recordHeartbeat(
      { roomId: "not-a-uuid", userId: USER_ID },
      { supabase: makeSupabaseMock().supabase },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_ROOM_ID");
      expect(result.status).toBe(400);
    }
  });

  it("400s on empty userId", async () => {
    const result = await recordHeartbeat(
      { roomId: VALID_ROOM_ID, userId: "" },
      { supabase: makeSupabaseMock().supabase },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_USER_ID");
  });

  it("404s when no membership row matches", async () => {
    const mock = makeSupabaseMock({
      membershipUpdate: { data: null, error: null },
    });
    const result = await recordHeartbeat(
      { roomId: VALID_ROOM_ID, userId: USER_ID },
      { supabase: mock.supabase },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ROOM_NOT_FOUND");
      expect(result.status).toBe(404);
    }
  });

  it("500s on DB error", async () => {
    const mock = makeSupabaseMock({
      membershipUpdate: { data: null, error: { message: "boom" } },
    });
    const result = await recordHeartbeat(
      { roomId: VALID_ROOM_ID, userId: USER_ID },
      { supabase: mock.supabase },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL_ERROR");
  });

  it("happy path UPDATEs last_seen_at filtered by (room_id, user_id)", async () => {
    const mock = makeSupabaseMock();
    const result = await recordHeartbeat(
      { roomId: VALID_ROOM_ID, userId: USER_ID },
      { supabase: mock.supabase },
    );
    expect(result.ok).toBe(true);
    expect(mock.updateCalls).toHaveLength(1);
    const call = mock.updateCalls[0];
    expect(call.patch).toHaveProperty("last_seen_at");
    expect(typeof call.patch.last_seen_at).toBe("string");
    expect(call.eqs).toEqual(
      expect.arrayContaining([
        { col: "room_id", val: VALID_ROOM_ID },
        { col: "user_id", val: USER_ID },
      ]),
    );
  });

  it("idempotent — two consecutive calls both succeed", async () => {
    const mock = makeSupabaseMock();
    const r1 = await recordHeartbeat(
      { roomId: VALID_ROOM_ID, userId: USER_ID },
      { supabase: mock.supabase },
    );
    const r2 = await recordHeartbeat(
      { roomId: VALID_ROOM_ID, userId: USER_ID },
      { supabase: mock.supabase },
    );
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(mock.updateCalls).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/rooms/recordHeartbeat.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the orchestrator**

`src/lib/rooms/recordHeartbeat.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";

export interface RecordHeartbeatInput {
  roomId: unknown;
  userId: unknown;
}

export interface RecordHeartbeatDeps {
  supabase: SupabaseClient<Database>;
}

export interface RecordHeartbeatSuccess {
  ok: true;
}

export interface RecordHeartbeatFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type RecordHeartbeatResult =
  | RecordHeartbeatSuccess
  | RecordHeartbeatFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): RecordHeartbeatFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

/**
 * SPEC §10.2.1 — write `room_memberships.last_seen_at = NOW()` for the
 * (roomId, userId) tuple. Called every 15 s by the `useRoomHeartbeat`
 * hook on every mounted `<RoomPage>`. The advance-time cascade reads
 * this column to decide whether to skip the next announcer.
 *
 * No status guard: heartbeats are accepted in any room status, so the
 * value is fresh at every transition (including the moment
 * `scoring → announcing` flips, when the pre-cascade fires).
 *
 * Membership-required: a non-member writing is a 404. (We don't leak
 * "the room exists but you're not in it" — same convention as the rest
 * of the rooms layer.)
 */
export async function recordHeartbeat(
  input: RecordHeartbeatInput,
  deps: RecordHeartbeatDeps,
): Promise<RecordHeartbeatResult> {
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

  const updateQuery = await deps.supabase
    .from("room_memberships")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("room_id", input.roomId)
    .eq("user_id", input.userId)
    .select("user_id")
    .maybeSingle();

  if (updateQuery.error) {
    return fail("INTERNAL_ERROR", "Could not record heartbeat.", 500);
  }
  if (!updateQuery.data) {
    return fail(
      "ROOM_NOT_FOUND",
      "Room or membership not found.",
      404,
    );
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/rooms/recordHeartbeat.test.ts`
Expected: 6 PASS.

- [ ] **Step 5: Write the route adapter**

`src/app/api/rooms/[id]/heartbeat/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { recordHeartbeat } from "@/lib/rooms/recordHeartbeat";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * PATCH /api/rooms/{id}/heartbeat
 * Body: { userId }
 *
 * SPEC §10.2.1 — client heartbeat. Updates room_memberships.last_seen_at
 * so the advance-time cascade can decide whether the next announcer is
 * absent. Called by useRoomHeartbeat every 15 s on every mounted
 * <RoomPage> across all room statuses.
 */
export async function PATCH(
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
  const result = await recordHeartbeat(
    { roomId: params.id, userId: input.userId },
    { supabase: createServiceClient() },
  );

  if (result.ok) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }
  return apiError(
    result.error.code,
    result.error.message,
    result.status,
    result.error.field,
  );
}
```

- [ ] **Step 6: Type-check**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rooms/recordHeartbeat.ts src/lib/rooms/recordHeartbeat.test.ts src/app/api/rooms/[id]/heartbeat/route.ts
git commit -m "feat(rooms): recordHeartbeat orchestrator + PATCH /heartbeat route (R4)

UPDATEs room_memberships.last_seen_at = NOW() filtered by (room_id,
user_id). 404 when no membership row matches (non-member or unknown
room). No status guard — heartbeats accepted in any room status so the
value is fresh when the pre-cascade fires at scoring → announcing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `useRoomHeartbeat` hook + RoomPage wiring

**Files:**
- Create: `src/hooks/useRoomHeartbeat.ts`
- Modify: `src/app/room/[id]/page.tsx` (add the hook call)

- [ ] **Step 1: Write the hook**

`src/hooks/useRoomHeartbeat.ts`:

```ts
"use client";

import { useEffect } from "react";

const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * SPEC §10.2.1 — fire `PATCH /api/rooms/{id}/heartbeat` on mount, then
 * every 15 s while `active`. Hook stops on unmount or when `active`
 * flips to false. The endpoint UPDATEs room_memberships.last_seen_at;
 * the advance-time cascade reads that column.
 *
 * Active across all room statuses (lobby / voting / voting_ending /
 * scoring / announcing) so last_seen_at is fresh at every transition,
 * including the scoring → announcing flip when the pre-cascade fires.
 *
 * Failures are silent — the heartbeat is best-effort and a transient
 * network blip should not surface to the user. (A real outage will
 * show up as the user being marked absent at the next rotation; that's
 * a self-correcting signal.)
 */
export function useRoomHeartbeat(
  roomId: string | null,
  userId: string | null,
  active: boolean,
): void {
  useEffect(() => {
    if (!active || !roomId || !userId) return;

    let cancelled = false;
    const fire = async () => {
      try {
        await fetch(`/api/rooms/${roomId}/heartbeat`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId }),
        });
      } catch {
        // Best-effort. The next tick will retry.
      }
    };

    void fire(); // immediate on mount
    const interval = window.setInterval(() => {
      if (!cancelled) void fire();
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [roomId, userId, active]);
}
```

- [ ] **Step 2: Wire into `<RoomPage>`**

Open `src/app/room/[id]/page.tsx`. Find the existing hook section (where `useRoomRealtime` and `useRoomPresence` are called). Add the import and call:

```ts
import { useRoomHeartbeat } from "@/hooks/useRoomHeartbeat";

// ...inside the component, alongside the existing hooks:
useRoomHeartbeat(roomId, currentUserId, true);
```

`active` is hard-coded to `true` — the hook itself short-circuits when ids are null. The page only renders for authenticated members anyway.

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 4: Smoke-test in the browser**

```bash
npm run dev
```

Open `http://localhost:3000`, create a room, navigate into it. Open DevTools → Network. Filter by `heartbeat`. Expected: a `PATCH /api/rooms/{id}/heartbeat` immediately on landing the page, then another every 15 s.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useRoomHeartbeat.ts src/app/room/[id]/page.tsx
git commit -m "feat(room): useRoomHeartbeat hook fires every 15s on RoomPage (R4)

Hook fires PATCH /heartbeat immediately on mount, then every 15s while
active. Wired into RoomPage with active=true so it runs across all
statuses — keeps last_seen_at fresh for the upcoming advance-time
cascade. Failures are silent (best-effort).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Extract `applySingleSkip` helper from `skipAnnouncer`

This is a refactor with no behaviour change. The existing `skipAnnouncer` tests must still pass after the refactor. We extract the inner DB-mutation logic so the cascade in tasks 6 + 7 can reuse it.

**Files:**
- Create: `src/lib/rooms/applySingleSkip.ts`
- Create: `src/lib/rooms/applySingleSkip.test.ts`
- Modify: `src/lib/rooms/skipAnnouncer.ts` (call the new helper)

- [ ] **Step 1: Write the failing helper test**

`src/lib/rooms/applySingleSkip.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  applySingleSkip,
  type ApplySingleSkipDeps,
} from "@/lib/rooms/applySingleSkip";

const ROOM_ID = "11111111-2222-4333-8444-555555555555";
const SKIP_USER = "20000000-0000-4000-8000-000000000002";

function makeSupabase() {
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const from = vi.fn((table: string) => {
    if (table === "results") {
      return {
        update: vi.fn((patch: Record<string, unknown>) => {
          updates.push({ table, patch });
          const chain = {
            eq: vi.fn(() => chain),
            then: (...args: unknown[]) =>
              Promise.resolve({ data: null, error: null }).then(
                ...(args as [(v: unknown) => unknown]),
              ),
          };
          return chain;
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });
  return {
    supabase: { from } as unknown as ApplySingleSkipDeps["supabase"],
    updates,
  };
}

describe("applySingleSkip", () => {
  it("marks all of the user's results as announced", async () => {
    const mock = makeSupabase();
    const result = await applySingleSkip(
      { roomId: ROOM_ID, skippedUserId: SKIP_USER },
      { supabase: mock.supabase },
    );
    expect(result.ok).toBe(true);
    expect(mock.updates).toHaveLength(1);
    expect(mock.updates[0].patch).toEqual({ announced: true });
  });

  it("returns the skippedUserId on success (so the caller can broadcast)", async () => {
    const mock = makeSupabase();
    const result = await applySingleSkip(
      { roomId: ROOM_ID, skippedUserId: SKIP_USER },
      { supabase: mock.supabase },
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.skippedUserId).toBe(SKIP_USER);
  });

  it("500s on DB error", async () => {
    const supabase = {
      from: vi.fn(() => ({
        update: vi.fn(() => {
          const chain = {
            eq: vi.fn(() => chain),
            then: (...args: unknown[]) =>
              Promise.resolve({
                data: null,
                error: { message: "boom" },
              }).then(...(args as [(v: unknown) => unknown])),
          };
          return chain;
        }),
      })),
    };
    const result = await applySingleSkip(
      { roomId: ROOM_ID, skippedUserId: SKIP_USER },
      { supabase: supabase as unknown as ApplySingleSkipDeps["supabase"] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL_ERROR");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/rooms/applySingleSkip.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the helper**

`src/lib/rooms/applySingleSkip.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";

export interface ApplySingleSkipInput {
  roomId: string;
  skippedUserId: string;
}

export interface ApplySingleSkipDeps {
  supabase: SupabaseClient<Database>;
}

export interface ApplySingleSkipSuccess {
  ok: true;
  skippedUserId: string;
}

export interface ApplySingleSkipFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string };
}

export type ApplySingleSkipResult =
  | ApplySingleSkipSuccess
  | ApplySingleSkipFailure;

/**
 * The inner DB-mutation step of skipping a single user (SPEC §10.2.1).
 * Marks every results row owned by `skippedUserId` in `roomId` as
 * `announced = true` so the live leaderboard reflects their points,
 * but the dramatic per-point reveal is suppressed.
 *
 * Does NOT mutate `rooms.announce_skipped_user_ids` — that's the
 * caller's responsibility, since the caller may be batching multiple
 * skips into a single room UPDATE (cascade case).
 *
 * Does NOT broadcast — the caller broadcasts in cascade order so the
 * client-side banner queue receives them in sequence.
 */
export async function applySingleSkip(
  input: ApplySingleSkipInput,
  deps: ApplySingleSkipDeps,
): Promise<ApplySingleSkipResult> {
  const markAnnounced = await deps.supabase
    .from("results")
    .update({ announced: true })
    .eq("room_id", input.roomId)
    .eq("user_id", input.skippedUserId);

  if (markAnnounced.error) {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Could not mark skipped user's points as announced.",
      },
    };
  }

  return { ok: true, skippedUserId: input.skippedUserId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/rooms/applySingleSkip.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Refactor `skipAnnouncer.ts` to call `applySingleSkip`**

In `src/lib/rooms/skipAnnouncer.ts`, find step 6 (the `markAnnounced = await deps.supabase.from("results").update(...)` block, lines ~174–186) and replace it with:

```ts
  // 6. Mark all of the skipped user's not-yet-announced results as
  // announced so the live leaderboard reflects their points immediately.
  const skipResult = await applySingleSkip(
    { roomId, skippedUserId },
    { supabase: deps.supabase },
  );
  if (!skipResult.ok) {
    return fail(skipResult.error.code, skipResult.error.message, 500);
  }
```

Add the import at the top:

```ts
import { applySingleSkip } from "@/lib/rooms/applySingleSkip";
```

- [ ] **Step 6: Run all rooms tests to verify no regression**

Run: `npm test -- src/lib/rooms`
Expected: ALL PASS — including the existing `skipAnnouncer.test.ts` cases. The refactor is behaviour-preserving.

- [ ] **Step 7: Type-check**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/rooms/applySingleSkip.ts src/lib/rooms/applySingleSkip.test.ts src/lib/rooms/skipAnnouncer.ts
git commit -m "refactor(rooms): extract applySingleSkip helper from skipAnnouncer (R4)

Pure refactor — no behaviour change. The cascade in advanceAnnouncement
+ runScoring (next two tasks) reuses this helper. Existing
skipAnnouncer tests pass unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Cascade in `advanceAnnouncement` (TDD)

**Files:**
- Modify: `src/lib/rooms/advanceAnnouncement.ts`
- Modify: `src/lib/rooms/advanceAnnouncement.test.ts` (add cases)

- [ ] **Step 1: Read the existing test file shape**

Open `src/lib/rooms/advanceAnnouncement.test.ts`. Note the existing `makeSupabaseMock` helper and how it scripts `roomSelect`, `announcerResults`, `roomUpdate`, etc. The new test cases will extend this pattern by adding a `membershipSelects` script for the per-user `last_seen_at` lookup.

- [ ] **Step 2: Add a new failing test for single-skip-on-rotation**

Add to `src/lib/rooms/advanceAnnouncement.test.ts` (at the bottom of the existing `describe` block):

```ts
  describe("cascade-skip on rotation (SPEC §10.2.1)", () => {
    const NOW = new Date("2026-05-10T12:00:00.000Z");
    const FRESH = new Date(NOW.getTime() - 5_000).toISOString();
    const STALE = new Date(NOW.getTime() - 60_000).toISOString();

    it("skips the next announcer if absent and rotates to the user after them", async () => {
      // Order: [A, B, C]. A reveals last point; B is absent (stale);
      // C is present. Expect: skip B, rotate to C, no extra reveal call
      // for B (only B's results.announced gets flipped).
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
        // A has only one result-row left → next call is the last for A.
        announcerResults: {
          data: [
            { contestant_id: "c1", points_awarded: 12, rank: 1, announced: false },
          ],
          error: null,
        },
        // The cascade looks up last_seen_at for B (absent), then for C (fresh).
        membershipSelects: [
          { data: { last_seen_at: STALE }, error: null }, // B
          { data: { last_seen_at: FRESH }, error: null }, // C
        ],
      });

      const result = await advanceAnnouncement(
        { roomId: VALID_ROOM_ID, userId: OWNER_ID },
        makeDeps(mock, { now: () => NOW }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Final state: announcing_user_id = C; B in announce_skipped_user_ids.
      const lastRoomUpdate = mock.roomUpdateCalls.at(-1);
      expect(lastRoomUpdate?.patch.announcing_user_id).toBe(U3);
      expect(lastRoomUpdate?.patch.announce_skipped_user_ids).toEqual([U2]);

      // Broadcast: one announce_skip for B in addition to the regular reveal events.
      const broadcasts = (mock.broadcastCalls as Array<{ event: { type: string; userId?: string } }>);
      const skipBroadcasts = broadcasts.filter((b) => b.event.type === "announce_skip");
      expect(skipBroadcasts).toHaveLength(1);
      expect(skipBroadcasts[0].event.userId).toBe(U2);
    });

    it("cascades through 3 absent users and lands on the 4th present", async () => {
      const mock = makeSupabaseMock({
        roomSelect: {
          data: {
            id: VALID_ROOM_ID,
            status: "announcing",
            owner_user_id: OWNER_ID,
            announcement_order: [U1, U2, U3, U4, U5],
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
          { data: { last_seen_at: STALE }, error: null }, // B - absent
          { data: { last_seen_at: STALE }, error: null }, // C - absent
          { data: { last_seen_at: STALE }, error: null }, // D - absent
          { data: { last_seen_at: FRESH }, error: null }, // E - present
        ],
      });

      const result = await advanceAnnouncement(
        { roomId: VALID_ROOM_ID, userId: OWNER_ID },
        makeDeps(mock, { now: () => NOW }),
      );

      expect(result.ok).toBe(true);
      const lastRoomUpdate = mock.roomUpdateCalls.at(-1);
      expect(lastRoomUpdate?.patch.announcing_user_id).toBe(U5);
      expect(lastRoomUpdate?.patch.announce_skipped_user_ids).toEqual([U2, U3, U4]);

      const skipBroadcasts = mock.broadcastCalls.filter(
        (b) => b.event.type === "announce_skip",
      );
      expect(skipBroadcasts.map((b) => b.event.userId)).toEqual([U2, U3, U4]);
    });

    it("cascade exhausts → announcing_user_id = null, status stays announcing", async () => {
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
          { data: { last_seen_at: STALE }, error: null }, // B - absent
          { data: { last_seen_at: STALE }, error: null }, // C - absent
        ],
      });

      const result = await advanceAnnouncement(
        { roomId: VALID_ROOM_ID, userId: OWNER_ID },
        makeDeps(mock, { now: () => NOW }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.cascadeExhausted).toBe(true);

      const lastRoomUpdate = mock.roomUpdateCalls.at(-1);
      expect(lastRoomUpdate?.patch.announcing_user_id).toBeNull();
      // status NOT flipped to 'done' — item #2 will surface "Finish the show"
      expect(lastRoomUpdate?.patch.status).toBeUndefined();
    });

    it("does not skip when next announcer is present (golden path regression)", async () => {
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
          { data: { last_seen_at: FRESH }, error: null }, // B - present
        ],
      });

      const result = await advanceAnnouncement(
        { roomId: VALID_ROOM_ID, userId: OWNER_ID },
        makeDeps(mock, { now: () => NOW }),
      );

      expect(result.ok).toBe(true);
      const lastRoomUpdate = mock.roomUpdateCalls.at(-1);
      expect(lastRoomUpdate?.patch.announcing_user_id).toBe(U2);
      expect(lastRoomUpdate?.patch.announce_skipped_user_ids).toBeUndefined();

      const skipBroadcasts = mock.broadcastCalls.filter(
        (b) => b.event.type === "announce_skip",
      );
      expect(skipBroadcasts).toHaveLength(0);
    });
  });
```

You will also need to extend `makeSupabaseMock` to script `membershipSelects` (a sequential array, popped per call) and to capture broadcast calls into `broadcastCalls`. Additional `U3`, `U4`, `U5` constants needed at the top of the file.

The test file's `makeDeps` already accepts `overrides`; add a `now` function override:

```ts
function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<AdvanceAnnouncementDeps> = {},
): AdvanceAnnouncementDeps {
  const broadcastCalls: Array<{ roomId: string; event: any }> = [];
  mock.broadcastCalls = broadcastCalls;
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn(async (roomId: string, event: any) => {
      broadcastCalls.push({ roomId, event });
    }),
    ...overrides,
  };
}
```

If the existing test file doesn't already expose a `now` injection, see Step 3.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- src/lib/rooms/advanceAnnouncement.test.ts`
Expected: FAIL on the new cascade cases — `cascadeExhausted` is undefined, no skip broadcast emitted, etc. Existing cases should still pass.

- [ ] **Step 4: Implement the cascade in `advanceAnnouncement.ts`**

Find the `AdvanceAnnouncementSuccess` interface and add a field:

```ts
export interface AdvanceAnnouncementSuccess {
  ok: true;
  contestantId: string;
  points: number;
  announcingUserId: string;
  newTotal: number;
  newRank: number;
  nextAnnouncingUserId: string | null;
  finished: boolean;
  /** SPEC §10.2.1 — set when the cascade exhausted the order with no
   * present user. announcing_user_id is null but status stays
   * 'announcing' for items #2/#3 to consume. */
  cascadeExhausted: boolean;
  /** SPEC §10.2.1 — userIds skipped during this advance call, in cascade order. */
  cascadedSkippedUserIds: string[];
}
```

Add an optional `now` to `AdvanceAnnouncementDeps`:

```ts
export interface AdvanceAnnouncementDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
  /** Injected for testability. Defaults to `() => new Date()`. */
  now?: () => Date;
}
```

Modify the orchestrator's step 6 ("determine next state"). After computing `nextAnnouncingUserId` (line ~213-228), if `nextAnnouncingUserId !== null && !finishedShow`, run the cascade:

```ts
  // SPEC §10.2.1 — cascade-skip absent users at rotation time.
  const now = (deps.now ?? (() => new Date()))();
  const cascadedSkipped: string[] = [];
  let cascadeExhausted = false;

  if (nextAnnouncingUserId !== null && isLastForAnnouncer && !finishedShow) {
    // We're rotating from currentAnnouncer to the user at announcement_order[pos+1].
    const announcers = room.announcement_order;
    let probePos = announcers.indexOf(currentAnnouncer) + 1;

    while (probePos < announcers.length) {
      const probeUser = announcers[probePos];
      const membershipQuery = await deps.supabase
        .from("room_memberships")
        .select("last_seen_at")
        .eq("room_id", roomId)
        .eq("user_id", probeUser)
        .maybeSingle();

      if (membershipQuery.error) {
        return fail(
          "INTERNAL_ERROR",
          "Could not read membership for presence check.",
          500,
        );
      }
      const lastSeenAt =
        (membershipQuery.data as { last_seen_at: string | null } | null)
          ?.last_seen_at ?? null;

      if (!isAbsent(lastSeenAt, now)) {
        nextAnnouncingUserId = probeUser;
        break;
      }

      // Absent → skip them.
      const skipResult = await applySingleSkip(
        { roomId, skippedUserId: probeUser },
        { supabase: deps.supabase },
      );
      if (!skipResult.ok) {
        return fail(skipResult.error.code, skipResult.error.message, 500);
      }
      cascadedSkipped.push(probeUser);
      probePos += 1;
    }

    if (probePos >= announcers.length) {
      cascadeExhausted = true;
      nextAnnouncingUserId = null;
      // status stays 'announcing' — do NOT set finishedShow.
    }
  }
```

Modify the room patch (step 7) to include `announce_skipped_user_ids` if any cascaded:

```ts
  const roomPatch: {
    announcing_user_id: string | null;
    current_announce_idx: number;
    status?: string;
    announce_skipped_user_ids?: string[];
  } = {
    announcing_user_id: nextAnnouncingUserId,
    current_announce_idx: nextIdx,
  };
  if (finishedShow) roomPatch.status = "done";
  if (cascadedSkipped.length > 0) {
    const prev = (room.announce_skipped_user_ids ?? []) as string[];
    roomPatch.announce_skipped_user_ids = [...prev, ...cascadedSkipped];
  }
```

You'll need to extend the `RoomRow` type at the top to include `announce_skipped_user_ids`.

After the room UPDATE succeeds (step 7), emit the `announce_skip` broadcasts in cascade order (BEFORE the existing `announce_next`/`score_update` so the banner train precedes the next reveal):

```ts
  // SPEC §10.2.1 — emit one announce_skip per cascaded user.
  if (cascadedSkipped.length > 0) {
    // Look up display names for the broadcasts.
    const namesQuery = await deps.supabase
      .from("users")
      .select("id, display_name")
      .in("id", cascadedSkipped);
    const nameMap = new Map<string, string>();
    if (!namesQuery.error && namesQuery.data) {
      for (const u of namesQuery.data as Array<{ id: string; display_name: string }>) {
        nameMap.set(u.id, u.display_name);
      }
    }
    for (const skippedId of cascadedSkipped) {
      try {
        await deps.broadcastRoomEvent(roomId, {
          type: "announce_skip",
          userId: skippedId,
          displayName: nameMap.get(skippedId) ?? "",
        });
      } catch (err) {
        console.warn(
          `broadcast 'announce_skip' failed for room ${roomId}; state committed regardless:`,
          err,
        );
      }
    }
  }
```

Add the imports:

```ts
import { isAbsent } from "@/lib/rooms/isAbsent";
import { applySingleSkip } from "@/lib/rooms/applySingleSkip";
```

Update the return statement to include the new fields:

```ts
  return {
    ok: true,
    contestantId: revealRow.contestant_id,
    points: revealRow.points_awarded,
    announcingUserId: currentAnnouncer,
    newTotal,
    newRank,
    nextAnnouncingUserId,
    finished: finishedShow,
    cascadeExhausted,
    cascadedSkippedUserIds: cascadedSkipped,
  };
```

- [ ] **Step 5: Run advanceAnnouncement tests**

Run: `npm test -- src/lib/rooms/advanceAnnouncement.test.ts`
Expected: ALL PASS — including the 4 new cascade cases.

- [ ] **Step 6: Run all rooms tests for regression**

Run: `npm test -- src/lib/rooms`
Expected: ALL PASS.

- [ ] **Step 7: Type-check**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/rooms/advanceAnnouncement.ts src/lib/rooms/advanceAnnouncement.test.ts
git commit -m "feat(announce): cascade-skip absent users at rotation time (R4 §10.2.1)

When advanceAnnouncement is rotating from announcer A to the next user,
loop through announcement_order checking each candidate's
last_seen_at via isAbsent. Absent users are passed to applySingleSkip
(results.announced=true) and accumulated; the room UPDATE writes them
all to announce_skipped_user_ids in one batch and emits one
announce_skip broadcast per skipped user in cascade order. Cascade
exhausted → announcing_user_id=null, status stays 'announcing' for
items #2/#3 to consume (Finish the show + /present awaiting copy).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Pre-cascade in `runScoring` (TDD)

**Files:**
- Modify: `src/lib/rooms/runScoring.ts`
- Modify: `src/lib/rooms/runScoring.test.ts` (add cases)

- [ ] **Step 1: Add failing tests for pre-cascade**

In `src/lib/rooms/runScoring.test.ts`, add cases inside the existing `describe("runScoring", ...)` block (or a new nested `describe("pre-cascade", ...)` block):

```ts
  describe("scoring → announcing pre-cascade (SPEC §10.2.1)", () => {
    const NOW = new Date("2026-05-10T12:00:00.000Z");
    const FRESH = new Date(NOW.getTime() - 5_000).toISOString();
    const STALE = new Date(NOW.getTime() - 60_000).toISOString();

    it("skips the first 2 absent users; lands on order[2]", async () => {
      // Set up: live mode, 3 announcers eligible, first 2 absent.
      const mock = makeRunScoringMock({
        // ...existing scaffolding for scoring data...
        announcementOrder: [U1, U2, U3], // post-shuffle
        membershipSelects: [
          { user_id: U1, last_seen_at: STALE },
          { user_id: U2, last_seen_at: STALE },
          { user_id: U3, last_seen_at: FRESH },
        ],
      });

      const result = await runScoring(
        { roomId: VALID_ROOM_ID, userId: OWNER_ID },
        makeRunScoringDeps(mock, { now: () => NOW }),
      );

      expect(result.ok).toBe(true);
      const finalRoomUpdate = mock.roomUpdateCalls.at(-1);
      expect(finalRoomUpdate?.patch.announcing_user_id).toBe(U3);
      expect(finalRoomUpdate?.patch.announce_skipped_user_ids).toEqual([U1, U2]);

      // 2 announce_skip broadcasts emitted.
      const skipBroadcasts = mock.broadcastCalls.filter(
        (b) => b.event.type === "announce_skip",
      );
      expect(skipBroadcasts.map((b) => b.event.userId)).toEqual([U1, U2]);
    });

    it("all absent → announcing_user_id null, status announcing", async () => {
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
      const finalRoomUpdate = mock.roomUpdateCalls.at(-1);
      expect(finalRoomUpdate?.patch.announcing_user_id).toBeNull();
      expect(finalRoomUpdate?.patch.status).toBe("announcing");
      expect(finalRoomUpdate?.patch.announce_skipped_user_ids).toEqual([U1, U2]);
    });

    it("first user present → no skips, golden path regression", async () => {
      const mock = makeRunScoringMock({
        announcementOrder: [U1, U2],
        membershipSelects: [{ user_id: U1, last_seen_at: FRESH }],
      });

      const result = await runScoring(
        { roomId: VALID_ROOM_ID, userId: OWNER_ID },
        makeRunScoringDeps(mock, { now: () => NOW }),
      );

      expect(result.ok).toBe(true);
      const finalRoomUpdate = mock.roomUpdateCalls.at(-1);
      expect(finalRoomUpdate?.patch.announcing_user_id).toBe(U1);
      expect(finalRoomUpdate?.patch.announce_skipped_user_ids).toBeUndefined();
    });
  });
```

The existing `makeRunScoringMock` will need extending with `membershipSelects` support (similar shape to Task 6). The `makeRunScoringDeps` will need an optional `now` injection that mirrors `advanceAnnouncement`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/rooms/runScoring.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement the pre-cascade in `runScoring.ts`**

In `src/lib/rooms/runScoring.ts`, find the live-mode block (around lines 351–364 — the `if (room.announcement_mode === "live")` block). After `const order = shuffle(eligibleOrdered);` and BEFORE `announcingPatch.announcing_user_id = order[0] ?? null;`, run the pre-cascade:

```ts
    // SPEC §10.2.1 — pre-cascade: at scoring → announcing flip, skip
    // any absent users from the front of the order.
    const now = (deps.now ?? (() => new Date()))();
    const preSkipped: string[] = [];
    let firstPresentIdx = order.length; // sentinel: all absent

    for (let i = 0; i < order.length; i += 1) {
      const candidate = order[i];
      const memQuery = await deps.supabase
        .from("room_memberships")
        .select("last_seen_at")
        .eq("room_id", roomId)
        .eq("user_id", candidate)
        .maybeSingle();
      if (memQuery.error) {
        return fail(
          "INTERNAL_ERROR",
          "Could not read membership for pre-cascade presence check.",
          500,
        );
      }
      const lastSeenAt =
        (memQuery.data as { last_seen_at: string | null } | null)
          ?.last_seen_at ?? null;
      if (!isAbsent(lastSeenAt, now)) {
        firstPresentIdx = i;
        break;
      }
      // Absent → record for skip.
      preSkipped.push(candidate);
      const skipResult = await applySingleSkip(
        { roomId, skippedUserId: candidate },
        { supabase: deps.supabase },
      );
      if (!skipResult.ok) {
        return fail(skipResult.error.code, skipResult.error.message, 500);
      }
    }

    announcingPatch.announcement_order = order;
    announcingPatch.announcing_user_id =
      firstPresentIdx < order.length ? order[firstPresentIdx] : null;
    announcingPatch.current_announce_idx = 0;
    if (preSkipped.length > 0) {
      announcingPatch.announce_skipped_user_ids = preSkipped;
    }
```

Replace the existing 3-line set (`announcement_order = order; announcing_user_id = order[0] ?? null; current_announce_idx = 0;`) with the block above.

Also extend the `announcingPatch` type at line 344 to include `announce_skipped_user_ids?: string[]`.

After the room UPDATE succeeds (around line 366–380), emit `announce_skip` broadcasts BEFORE the existing `status_changed` broadcast:

```ts
  // SPEC §10.2.1 — emit announce_skip broadcasts in cascade order
  // (only if pre-cascade ran in live mode).
  if (
    room.announcement_mode === "live" &&
    announcingPatch.announce_skipped_user_ids &&
    announcingPatch.announce_skipped_user_ids.length > 0
  ) {
    const skippedIds = announcingPatch.announce_skipped_user_ids;
    const namesQuery = await deps.supabase
      .from("users")
      .select("id, display_name")
      .in("id", skippedIds);
    const nameMap = new Map<string, string>();
    if (!namesQuery.error && namesQuery.data) {
      for (const u of namesQuery.data as Array<{
        id: string;
        display_name: string;
      }>) {
        nameMap.set(u.id, u.display_name);
      }
    }
    for (const skippedId of skippedIds) {
      try {
        await deps.broadcastRoomEvent(roomId, {
          type: "announce_skip",
          userId: skippedId,
          displayName: nameMap.get(skippedId) ?? "",
        });
      } catch (err) {
        console.warn(
          `broadcast 'announce_skip' failed for room ${roomId}; state committed regardless:`,
          err,
        );
      }
    }
  }
```

Add imports at the top:

```ts
import { isAbsent } from "@/lib/rooms/isAbsent";
import { applySingleSkip } from "@/lib/rooms/applySingleSkip";
```

Add `now?: () => Date;` to the `RunScoringDeps` interface.

- [ ] **Step 4: Run runScoring tests**

Run: `npm test -- src/lib/rooms/runScoring.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Run all rooms tests**

Run: `npm test -- src/lib/rooms`
Expected: ALL PASS.

- [ ] **Step 6: Type-check**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rooms/runScoring.ts src/lib/rooms/runScoring.test.ts
git commit -m "feat(scoring): pre-cascade absent announcers at scoring → announcing (R4 §10.2.1)

Before flipping status to 'announcing', loop through the freshly-shuffled
order and pop absent users off the front. Each absent user gets the
applySingleSkip treatment (results.announced=true) and the batch is
written to announce_skipped_user_ids in the same room UPDATE that
flips status. Emits one announce_skip broadcast per skipped user.
All-absent → announcing_user_id=null, status='announcing'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Banner queue component + RTL + AnnouncingView wiring

**Files:**
- Create: `src/components/room/SkipBannerQueue.tsx`
- Create: `src/components/room/SkipBannerQueue.test.tsx`
- Modify: `src/components/room/AnnouncingView.tsx` (mount the queue)
- Modify: `src/components/room/PresentScreen.tsx` (mount the queue)
- Modify: `src/locales/en.json` (banner copy keys)

- [ ] **Step 1: Add locale keys**

In `src/locales/en.json`, find an appropriate namespace (likely `announce` or similar) and add:

```json
"announce": {
  "skipBanner": {
    "single": "{name} isn't here — their points are being skipped",
    "coalesced": "{count} skipped: {names}",
    "coalescedTrailing": "+{remaining}"
  }
}
```

Pick the actual existing `announce.*` key prefix used by the codebase — open the file and inspect existing keys before adding to avoid namespace drift.

- [ ] **Step 2: Write the failing component test**

`src/components/room/SkipBannerQueue.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import SkipBannerQueue, {
  type SkipEvent,
} from "@/components/room/SkipBannerQueue";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, p?: Record<string, unknown>) => {
    if (k === "announce.skipBanner.single") return `${p?.name} skipped`;
    if (k === "announce.skipBanner.coalesced")
      return `${p?.count} skipped: ${p?.names}`;
    if (k === "announce.skipBanner.coalescedTrailing")
      return `+${p?.remaining}`;
    return k;
  },
}));

describe("<SkipBannerQueue>", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders nothing when no events", () => {
    const { container } = render(<SkipBannerQueue events={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a single banner for one event for 3 s, then disappears", () => {
    const events: SkipEvent[] = [
      { id: "1", userId: "u1", displayName: "Alice", at: 1000 },
    ];
    render(<SkipBannerQueue events={events} />);
    expect(screen.getByRole("status")).toHaveTextContent("Alice skipped");
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders 3 sequential banners (3 s each, in arrival order)", () => {
    const events: SkipEvent[] = [
      { id: "1", userId: "u1", displayName: "Alice", at: 1000 },
      { id: "2", userId: "u2", displayName: "Bob", at: 1100 },
      { id: "3", userId: "u3", displayName: "Carol", at: 1200 },
    ];
    render(<SkipBannerQueue events={events} />);
    expect(screen.getByRole("status")).toHaveTextContent("Alice skipped");
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.getByRole("status")).toHaveTextContent("Bob skipped");
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.getByRole("status")).toHaveTextContent("Carol skipped");
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("coalesces to a single banner when >3 events arrive within 2 s", () => {
    const events: SkipEvent[] = [
      { id: "1", userId: "u1", displayName: "Alice", at: 1000 },
      { id: "2", userId: "u2", displayName: "Bob", at: 1100 },
      { id: "3", userId: "u3", displayName: "Carol", at: 1200 },
      { id: "4", userId: "u4", displayName: "Dave", at: 1300 },
    ];
    render(<SkipBannerQueue events={events} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "4 skipped: Alice, Bob, Carol",
    );
    expect(screen.getByRole("status")).toHaveTextContent("+1");
  });

  it("does not coalesce when events arrive >2 s apart", () => {
    const events: SkipEvent[] = [
      { id: "1", userId: "u1", displayName: "Alice", at: 1000 },
      { id: "2", userId: "u2", displayName: "Bob", at: 5000 }, // 4 s later
    ];
    render(<SkipBannerQueue events={events} />);
    expect(screen.getByRole("status")).toHaveTextContent("Alice skipped");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/components/room/SkipBannerQueue.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 4: Write the component**

`src/components/room/SkipBannerQueue.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

export interface SkipEvent {
  /** Stable id for the event (e.g. monotonic counter or `${userId}-${at}`). */
  id: string;
  userId: string;
  displayName: string;
  /** Arrival timestamp in ms (Date.now()). */
  at: number;
}

const PER_BANNER_MS = 3_000;
const COALESCE_WINDOW_MS = 2_000;
const COALESCE_THRESHOLD = 3; // > this many within window → coalesce

interface SkipBannerQueueProps {
  events: SkipEvent[];
}

/**
 * SPEC §10.2.1 — renders incoming announce_skip events as a sequential
 * banner train (3 s per event). When >3 events arrive within a 2 s
 * window, the queue coalesces into a single banner ("4 skipped: Alice,
 * Bob, Carol +1") to avoid a 9+ second train.
 *
 * The parent owns the events array — typically appending one entry per
 * announce_skip broadcast. The component reads from the array and
 * advances internally; the parent does not need to mutate it on
 * dismissal.
 */
export default function SkipBannerQueue({ events }: SkipBannerQueueProps) {
  const t = useTranslations();
  const [head, setHead] = useState(0);

  // Detect a coalesce burst: events[head..head+N] all within COALESCE_WINDOW_MS.
  const burst = useMemo(() => {
    if (head >= events.length) return null;
    const start = events[head];
    const window: SkipEvent[] = [];
    for (let i = head; i < events.length; i += 1) {
      if (events[i].at - start.at <= COALESCE_WINDOW_MS) window.push(events[i]);
      else break;
    }
    return window.length > COALESCE_THRESHOLD ? window : null;
  }, [events, head]);

  useEffect(() => {
    if (head >= events.length) return undefined;
    const advance = burst ? burst.length : 1;
    const timer = window.setTimeout(() => {
      setHead((h) => h + advance);
    }, PER_BANNER_MS);
    return () => window.clearTimeout(timer);
  }, [head, events, burst]);

  if (head >= events.length) return null;

  if (burst) {
    const visibleNames = burst.slice(0, COALESCE_THRESHOLD).map((e) => e.displayName);
    const remaining = burst.length - COALESCE_THRESHOLD;
    const trailing =
      remaining > 0 ? ` ${t("announce.skipBanner.coalescedTrailing", { remaining })}` : "";
    return (
      <div role="status" className="emx-skip-banner emx-skip-banner--coalesced">
        {t("announce.skipBanner.coalesced", {
          count: burst.length,
          names: visibleNames.join(", "),
        })}
        {trailing}
      </div>
    );
  }

  const current = events[head];
  return (
    <div role="status" className="emx-skip-banner">
      {t("announce.skipBanner.single", { name: current.displayName })}
    </div>
  );
}
```

You will need a small CSS adjustment for `.emx-skip-banner` — pick the existing toast/banner style (e.g. mimic `<EndVotingCountdownToast>`'s shell). Check `src/components/ui/` for a shared `<Banner>` if one exists; if so, use it.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/components/room/SkipBannerQueue.test.tsx`
Expected: 5 PASS.

- [ ] **Step 6: Wire `<SkipBannerQueue>` into `<AnnouncingView>`**

In `src/components/room/AnnouncingView.tsx`:

1. Add a state variable for the events array:

```ts
const [skipEvents, setSkipEvents] = useState<SkipEvent[]>([]);
```

2. In the existing `useRoomRealtime` `onMessage` callback, handle `announce_skip`:

```ts
if (msg.type === "announce_skip") {
  setSkipEvents((prev) => [
    ...prev,
    {
      id: `${msg.userId}-${Date.now()}`,
      userId: msg.userId,
      displayName: msg.displayName,
      at: Date.now(),
    },
  ]);
}
```

3. Render `<SkipBannerQueue events={skipEvents} />` near the top of the view's JSX (above the leaderboard).

Add the import at the top of the file.

- [ ] **Step 7: Mirror the wiring into `<PresentScreen>`**

Open `src/components/room/PresentScreen.tsx`. If the file exists and already subscribes to `room:{id}` broadcasts, add the same `skipEvents` state + `<SkipBannerQueue>` render. If `<PresentScreen>` polls `/api/results` rather than subscribing to broadcasts, leave a TODO comment referencing item #3 (which will add the broadcast subscriber to the present screen). For this slice, the `/room/[id]` admin/guest view rendering the banner is sufficient.

- [ ] **Step 8: Run all RTL tests for regression**

Run: `npm test -- src/components/room`
Expected: ALL PASS — including the existing `AnnouncingView.test.tsx`. You may need to update existing `AnnouncingView` tests to mock `SkipBannerQueue` if they assert on the full component tree.

- [ ] **Step 9: Type-check**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/components/room/SkipBannerQueue.tsx src/components/room/SkipBannerQueue.test.tsx src/components/room/AnnouncingView.tsx src/components/room/PresentScreen.tsx src/locales/en.json
git commit -m "feat(room): SkipBannerQueue renders cascaded announce_skip events (R4 §10.2.1)

Sequential 3-s-per-event banner train; coalesces to a single 'N
skipped: ...' banner when >3 events arrive within 2 s. Wired into
<AnnouncingView>; <PresentScreen> wiring stubbed for item #3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Seed-room state extension

**Files:**
- Modify: `scripts/seed-helpers.ts` (add a new state builder)
- Modify: `scripts/seed-helpers.test.ts` (test the builder)
- Modify: `scripts/seed-room.ts` (CLI flag for the new state)
- Modify: `scripts/README.md` (document the state)

- [ ] **Step 1: Read the existing seed-helpers shape**

Open `scripts/seed-helpers.ts` and `scripts/seed-helpers.test.ts`. Note the existing builders (`buildLobbyWithGuests`, `buildVotingHalfDone`, etc.) and the canonical user/membership/result row shapes. The new state piggybacks on `buildAnnouncingMidQueueLive` if it exists.

- [ ] **Step 2: Add a failing test for the new state builder**

In `scripts/seed-helpers.test.ts`, add:

```ts
describe("buildAnnouncingCascadeAbsent", () => {
  it("produces an announcing room with users B, C absent (last_seen_at 60s ago), A and D present", () => {
    const now = new Date("2026-05-10T12:00:00.000Z");
    const result = buildAnnouncingCascadeAbsent({ now });

    expect(result.room.status).toBe("announcing");
    expect(result.room.announcement_order).toHaveLength(4);
    const [a, b, c, d] = result.room.announcement_order!;

    const memById = new Map(
      result.memberships.map((m) => [m.user_id, m]),
    );
    expect(memById.get(a)!.last_seen_at).not.toBeNull();
    // A is the active announcer — fresh.
    expect(
      now.getTime() - new Date(memById.get(a)!.last_seen_at!).getTime(),
    ).toBeLessThan(30_000);
    // B and C are stale (>30 s ago).
    expect(
      now.getTime() - new Date(memById.get(b)!.last_seen_at!).getTime(),
    ).toBeGreaterThan(30_000);
    expect(
      now.getTime() - new Date(memById.get(c)!.last_seen_at!).getTime(),
    ).toBeGreaterThan(30_000);
    // D is fresh.
    expect(
      now.getTime() - new Date(memById.get(d)!.last_seen_at!).getTime(),
    ).toBeLessThan(30_000);

    expect(result.room.announcing_user_id).toBe(a);
    expect(result.room.current_announce_idx).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- scripts/seed-helpers.test.ts`
Expected: FAIL with `buildAnnouncingCascadeAbsent` not defined.

- [ ] **Step 4: Implement the builder**

In `scripts/seed-helpers.ts`:

```ts
export interface BuildAnnouncingCascadeAbsentOpts {
  now?: Date;
  pin?: string;
}

export function buildAnnouncingCascadeAbsent(
  opts: BuildAnnouncingCascadeAbsentOpts = {},
) {
  const now = opts.now ?? new Date();
  const fresh = new Date(now.getTime() - 5_000).toISOString();
  const stale = new Date(now.getTime() - 60_000).toISOString();

  // Reuse buildAnnouncingMidQueueLive's user/result scaffolding to keep this
  // tight. The delta is: 4 users in announcement_order (instead of N), each
  // with results that put them in the announce queue, and B + C have stale
  // last_seen_at while A + D are fresh.
  const base = buildAnnouncingMidQueueLive({ ...opts, now });

  // Take the first 4 users from base; if base has fewer, throw.
  if (base.users.length < 4) {
    throw new Error("buildAnnouncingCascadeAbsent requires base to seed ≥4 users");
  }
  const [a, b, c, d] = base.users.slice(0, 4);
  const order = [a.id, b.id, c.id, d.id];

  return {
    ...base,
    room: {
      ...base.room,
      announcement_order: order,
      announcing_user_id: a.id,
      current_announce_idx: 0,
      announce_skipped_user_ids: [],
    },
    memberships: base.memberships.map((m) => {
      if (m.user_id === a.id) return { ...m, last_seen_at: fresh };
      if (m.user_id === b.id) return { ...m, last_seen_at: stale };
      if (m.user_id === c.id) return { ...m, last_seen_at: stale };
      if (m.user_id === d.id) return { ...m, last_seen_at: fresh };
      return m;
    }),
  };
}
```

If `buildAnnouncingMidQueueLive` doesn't already produce ≥4 users, extend it to take a `userCount` option (default to whatever it produces today) so this builder can request 4. If significant changes to base are needed, leave a comment and copy-paste the structure rather than over-extending the existing helper.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- scripts/seed-helpers.test.ts`
Expected: ALL PASS.

- [ ] **Step 6: Wire into the CLI**

In `scripts/seed-room.ts`, find the existing state-string switch (the CLI's `--state=...` argument). Add a case `'announcing-cascade-absent'` that calls `buildAnnouncingCascadeAbsent()` and inserts the rows. Mirror the existing seed-flow exactly.

- [ ] **Step 7: Document in scripts/README.md**

Add a row to the states table:

```markdown
| `announcing-cascade-absent` | Live-mode announcing room: 4-user order [A, B, C, D]; A active, B + C absent (last_seen_at 60s ago), D present. Drives the R4 cascade-skip path on next advance. |
```

- [ ] **Step 8: Smoke-test the CLI**

```bash
npm run seed:room -- --state=announcing-cascade-absent
```

Expected: outputs a PIN like `SEED-ABCD12` with no errors.

- [ ] **Step 9: Commit**

```bash
git add scripts/seed-helpers.ts scripts/seed-helpers.test.ts scripts/seed-room.ts scripts/README.md
git commit -m "test(seed): announcing-cascade-absent state for R4 Playwright spec

4-user announcement order with the active announcer + last user fresh
and the two middle users 60s stale. Drives the cascade-skip path on
next advance. Used by tests/e2e/announce-cascade.spec.ts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Playwright E2E spec

**Files:**
- Create: `tests/e2e/announce-cascade.spec.ts`

- [ ] **Step 1: Read existing Playwright patterns**

Open `tests/e2e/awards-ceremony.spec.ts` to see how it bootstraps a seeded room (signs in as the admin, navigates to `/room/[id]`, etc.). Mirror the pattern.

- [ ] **Step 2: Write the spec**

`tests/e2e/announce-cascade.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { execSync } from "child_process";

interface SeedOutput {
  roomId: string;
  pin: string;
  ownerUserId: string;
  ownerRejoinToken: string;
}

function seedRoom(state: string): SeedOutput {
  // The seed-room CLI emits JSON on stdout with --json flag.
  const raw = execSync(
    `npm run --silent seed:room -- --state=${state} --json`,
    { encoding: "utf-8" },
  );
  return JSON.parse(raw) as SeedOutput;
}

async function signInAsOwner(page: any, seed: SeedOutput) {
  // Set the localStorage session before any navigation so the rejoin
  // path picks it up.
  await page.goto("/");
  await page.evaluate(
    ({ userId, rejoinToken, displayName }: any) => {
      window.localStorage.setItem(
        "emx_session",
        JSON.stringify({
          userId,
          rejoinToken,
          displayName,
          avatarSeed: "owner",
          expiresAt: new Date(Date.now() + 90 * 86400_000).toISOString(),
        }),
      );
    },
    {
      userId: seed.ownerUserId,
      rejoinToken: seed.ownerRejoinToken,
      displayName: "Admin",
    },
  );
}

test.describe("R4 advance-time presence cascade (SPEC §10.2.1)", () => {
  test("cascades through 2 absent users → lands on the 4th present", async ({
    page,
  }) => {
    const seed = seedRoom("announcing-cascade-absent");
    await signInAsOwner(page, seed);

    await page.goto(`/room/${seed.roomId}`);
    // Wait for the announcing view.
    await expect(page.getByText(/Announcer/i)).toBeVisible({ timeout: 10_000 });

    // Drive A's reveals to the end. The seed sets A as active with the
    // standard 10-row reveal queue. Tap 'Reveal next point' until A's queue
    // ends and rotation triggers the cascade.
    const revealBtn = page.getByRole("button", { name: /reveal/i });
    while (await revealBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      // Bail out once the announcer transitions away from A.
      const advances = await page.evaluate(() =>
        document.body.textContent?.includes("Bob"),
      );
      if (advances) break;
      await revealBtn.click();
      await page.waitForTimeout(150); // small delay for state to settle
    }

    // Expect the two skip banners to appear (sequential, ~3 s each).
    await expect(page.getByRole("status")).toContainText(
      /Bob isn't here/i,
      { timeout: 10_000 },
    );
    // Wait for the second banner.
    await expect(page.getByRole("status")).toContainText(
      /Carol isn't here/i,
      { timeout: 10_000 },
    );

    // Active announcer transitions to D (last user in the seeded order).
    await expect(page.getByText(/Dave/i)).toBeVisible({ timeout: 10_000 });

    // /api/results/{id} reflects the skipped users.
    const apiRes = await page.request.get(`/api/results/${seed.roomId}`);
    expect(apiRes.ok()).toBe(true);
    const body = await apiRes.json();
    expect(body.announcement?.skippedUserIds).toEqual(
      expect.arrayContaining([
        expect.any(String),
        expect.any(String),
      ]),
    );
    expect(body.announcement?.skippedUserIds).toHaveLength(2);
  });

  test("cascade exhausts → announcing_user_id null, status announcing", async ({
    page,
  }) => {
    // Rely on a seed variant where order is [A, B, C] with B + C absent.
    // If the seed CLI doesn't yet support that variant, we'd add it; for
    // this slice, reuse 'announcing-cascade-absent' and skip to the end.
    test.skip(
      true,
      "Cascade-exhaust variant requires a separate seed state — covered by unit tests for now; revisit if Playwright slot available.",
    );
  });
});
```

The test relies on `seed-room.ts` supporting `--json`. If it doesn't yet, add that flag in Task 9 or a small Task-9 follow-up: emit `JSON.stringify({ roomId, pin, ownerUserId, ownerRejoinToken })` to stdout when `--json` is set.

- [ ] **Step 3: Run the spec**

Make sure the dev server is running on port 3457:

```bash
PORT=3457 npm run dev &
```

Then:

```bash
npm run test:e2e -- tests/e2e/announce-cascade.spec.ts
```

Expected: PASS for the cascade test; SKIP for the exhaust test.

- [ ] **Step 4: Type-check**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/announce-cascade.spec.ts
git commit -m "test(e2e): Playwright spec for R4 advance-time cascade

Seeded room with [A, B, C, D] order; B + C absent (60s stale). Drives
A's reveals to the end; asserts (a) two announce_skip banners appear in
sequence with B's then C's display name, (b) active announcer
transitions to D, (c) /api/results/{id} payload includes B + C in
skippedUserIds.

Cascade-exhaust path stubbed test.skip — covered by unit tests; add
seed variant + activate when Playwright slot available.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Final cleanup — TODO tick + type-check + push

**Files:**
- Modify: `TODO.md` (tick line 265)

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: ALL PASS.

- [ ] **Step 2: Run type-check**

```bash
npm run type-check
```

Expected: no errors.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 4: Tick TODO.md line 265**

Change:

```markdown
  - [ ] Advance-time presence check; if absent → write to `announce_skipped_user_ids`, broadcast `announce_skip`, advance pointer
```

to:

```markdown
  - [x] Advance-time presence check; if absent → write to `announce_skipped_user_ids`, broadcast `announce_skip`, advance pointer  _(landed on `feat/r4-advance-time-presence-check` — server-authoritative cascade in `advanceAnnouncement` + `runScoring`, driven by 15-s `room_memberships.last_seen_at` heartbeats from `useRoomHeartbeat` on `<RoomPage>`. Cascade-exhausted lands `announcing_user_id = null` with `status = 'announcing'` for items #2/#3 to consume. Spec: `docs/superpowers/specs/2026-05-10-r4-advance-time-presence-check-design.md`. Plan: `docs/superpowers/plans/2026-05-10-r4-advance-time-presence-check.md`.)_
```

(TODO.md is gitignored — this is local-only.)

- [ ] **Step 5: Push the branch + open PR**

```bash
git push -u origin feat/r4-advance-time-presence-check
gh pr create --title "feat(announce): R4 advance-time presence cascade-skip (§10.2.1)" --body "$(cat <<'EOF'
## Summary

- Server-authoritative cascade-skip of absent announcers at every rotation point (`scoring → announcing` start + every reveal that ends an announcer's queue).
- Driven by a new `room_memberships.last_seen_at` column heartbeated every 15 s via `useRoomHeartbeat` on `<RoomPage>`.
- Cascade-exhausted lands `announcing_user_id = null` with `status = 'announcing'` — the sentinel items #2 ("Finish the show" batch reveal) and #3 (`/present` "Awaiting an admin to continue…") will consume.

## Test plan

- [ ] Apply the schema migration (one ALTER, additive) via Supabase SQL Editor: `ALTER TABLE room_memberships ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;`
- [ ] Seed a cascade room: `npm run seed:room -- --state=announcing-cascade-absent`
- [ ] Open the room as admin, drive A's reveals to the end, observe two skip banners + transition to D.
- [ ] Verify `/api/results/{id}` shows the two skipped users in `announcement.skippedUserIds`.
- [ ] Run `npm test`, `npm run type-check`, `npm run lint`, `npm run test:e2e`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(Reminder: never `--no-verify`. If pre-push fails, fix and recommit.)

- [ ] **Step 6: Confirm CI green**

```bash
gh pr view --web
```

Wait for CI checks — type-check, lint, test, build. All green → PR is mergeable.

---

## Parallelization map

For agentic execution: tasks 2 and 3 (and 4) are independent of task 1 only in code (the schema is needed for Task 3 to run integration-style, but `recordHeartbeat.test.ts` mocks Supabase so the mock won't fail without the column). Strict order: 1 → 2/3/4 (parallel) → 5 → 6/7 (parallel) → 8 → 9 → 10 → 11.

If executing inline, the safest serial order is just 1→11 in the listed sequence; the `applySingleSkip` extraction (Task 5) **must** land before Tasks 6 and 7 to avoid two diverging cascade implementations.

## Self-review checklist (run before declaring complete)

- [ ] Schema column lives in `supabase/schema.sql` AND `SUPABASE_SETUP.md` changelog.
- [ ] `database.ts` has the new `last_seen_at` field on `room_memberships`.
- [ ] `isAbsent` boundary (exactly 30 s) returns false; >30 s returns true.
- [ ] `recordHeartbeat` returns 404 for non-member, 400 for invalid input.
- [ ] `applySingleSkip` does NOT mutate `rooms` — that's the caller's job.
- [ ] Cascade in `advanceAnnouncement` uses a single `now` snapshot across all probes (one `deps.now()` call before the loop).
- [ ] Cascade order matches `announcement_order` array order, not `Set` ordering.
- [ ] Pre-cascade in `runScoring` runs only in `live` mode (instant mode has no announcement order).
- [ ] `announce_skip` broadcasts emit AFTER the room UPDATE commits, in cascade order.
- [ ] `<SkipBannerQueue>` mounts in `<AnnouncingView>` AND a TODO comment in `<PresentScreen>` references item #3 for the broadcast subscriber.
- [ ] `npm test` + `npm run type-check` + `npm run lint` all green.
- [ ] Playwright spec runs on the seeded room and asserts the cascade outcome.
- [ ] TODO.md line 265 ticked with branch + spec + plan refs.
