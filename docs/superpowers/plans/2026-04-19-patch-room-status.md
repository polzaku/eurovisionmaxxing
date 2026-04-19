# PATCH /api/rooms/{id}/status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `PATCH /api/rooms/{id}/status` — admin-only room state transition with a `status_changed` broadcast — per `docs/superpowers/specs/2026-04-19-patch-room-status-design.md`.

**Architecture:** Pure `updateRoomStatus(input, deps)` library with DI over the Supabase client and a `broadcastRoomEvent` function. Thin Next.js PATCH adapter. Matches the pattern used by `createRoom`, `getRoom`, and `joinByPin`.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase (`@supabase/supabase-js`), Vitest.

---

## File structure

| Path | Kind | Responsibility |
|---|---|---|
| `src/lib/api-errors.ts` | modify | Add `FORBIDDEN`, `INVALID_STATUS`, `INVALID_TRANSITION` to `ApiErrorCode` |
| `src/lib/rooms/updateStatus.ts` | **new** | Pure handler: validate → lookup → auth → transition-check → UPDATE → broadcast |
| `src/lib/rooms/updateStatus.test.ts` | **new** | Unit tests against the pure handler |
| `src/app/api/rooms/[id]/status/route.ts` | modify | Thin PATCH adapter + default `broadcastRoomEvent` |
| `src/app/api/rooms/[id]/status/route.test.ts` | **new** | Adapter tests |

---

## Task 1: Bootstrap — error codes and lib stub

**Files:**
- Modify: `src/lib/api-errors.ts`
- Create: `src/lib/rooms/updateStatus.ts`

- [ ] **Step 1.1: Extend `ApiErrorCode`**

Edit `src/lib/api-errors.ts` — replace the existing `ApiErrorCode` union with:

```ts
export type ApiErrorCode =
  | "INVALID_BODY"
  | "INVALID_DISPLAY_NAME"
  | "INVALID_AVATAR_SEED"
  | "INVALID_ROOM_ID"
  | "INVALID_USER_ID"
  | "INVALID_PIN"
  | "INVALID_YEAR"
  | "INVALID_EVENT"
  | "INVALID_CATEGORIES"
  | "INVALID_CATEGORY"
  | "INVALID_ANNOUNCEMENT_MODE"
  | "INVALID_STATUS"
  | "INVALID_TRANSITION"
  | "FORBIDDEN"
  | "USER_NOT_FOUND"
  | "ROOM_NOT_FOUND"
  | "ROOM_NOT_JOINABLE"
  | "CANDIDATE_NOT_FOUND"
  | "INVALID_TOKEN"
  | "INTERNAL_ERROR";
```

- [ ] **Step 1.2: Create the lib stub**

Create `src/lib/rooms/updateStatus.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Room } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";

export interface RoomEventPayload {
  type: "status_changed";
  status: string;
}

export interface UpdateStatusInput {
  roomId: unknown;
  status: unknown;
  userId: unknown;
}

export interface UpdateStatusDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
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

export async function updateRoomStatus(
  _input: UpdateStatusInput,
  _deps: UpdateStatusDeps
): Promise<UpdateStatusResult> {
  throw new Error("not implemented");
}
```

- [ ] **Step 1.3: Type-check**

Run: `npm run type-check`
Expected: passes.

- [ ] **Step 1.4: Commit**

```bash
git add src/lib/api-errors.ts src/lib/rooms/updateStatus.ts
git commit -m "Bootstrap updateRoomStatus lib: error codes + stub handler"
```

---

## Task 2: Happy path (lobby → voting)

**Files:**
- Create: `src/lib/rooms/updateStatus.test.ts`
- Modify: `src/lib/rooms/updateStatus.ts`

- [ ] **Step 2.1: Write the happy-path test (RED)**

Create `src/lib/rooms/updateStatus.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  updateRoomStatus,
  type UpdateStatusDeps,
  type RoomEventPayload,
} from "@/lib/rooms/updateStatus";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const defaultRoomRow = {
  id: VALID_ROOM_ID,
  status: "lobby",
  owner_user_id: VALID_USER_ID,
};

const defaultUpdatedRow = {
  id: VALID_ROOM_ID,
  pin: "AAAAAA",
  year: 2026,
  event: "final",
  categories: [{ name: "Vocals", weight: 1 }],
  owner_user_id: VALID_USER_ID,
  status: "voting",
  announcement_mode: "instant",
  announcement_order: null,
  announcing_user_id: null,
  current_announce_idx: 0,
  now_performing_id: null,
  allow_now_performing: false,
  created_at: "2026-04-19T12:00:00Z",
};

interface MockOptions {
  roomSelectResult?: { data: unknown; error: { message: string } | null };
  roomUpdateResult?: { data: unknown; error: { message: string } | null };
}

function makeSupabaseMock(opts: MockOptions = {}) {
  const roomSelectResult =
    opts.roomSelectResult ?? { data: defaultRoomRow, error: null };
  const roomUpdateResult =
    opts.roomUpdateResult ?? { data: defaultUpdatedRow, error: null };

  const selectEqCalls: Array<{ col: string; val: unknown }> = [];
  const updatePatches: Array<Record<string, unknown>> = [];
  const updateEqCalls: Array<{ col: string; val: unknown }> = [];

  const from = vi.fn((table: string) => {
    if (table !== "rooms") throw new Error(`unexpected table: ${table}`);
    return {
      select: vi.fn(() => ({
        eq: vi.fn((col: string, val: unknown) => {
          selectEqCalls.push({ col, val });
          return { maybeSingle: vi.fn().mockResolvedValue(roomSelectResult) };
        }),
      })),
      update: vi.fn((patch: Record<string, unknown>) => {
        updatePatches.push(patch);
        return {
          eq: vi.fn((col: string, val: unknown) => {
            updateEqCalls.push({ col, val });
            return {
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue(roomUpdateResult),
              })),
            };
          }),
        };
      }),
    };
  });

  return {
    supabase: { from } as unknown as UpdateStatusDeps["supabase"],
    selectEqCalls,
    updatePatches,
    updateEqCalls,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<UpdateStatusDeps> = {}
): UpdateStatusDeps {
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("updateRoomStatus — happy path", () => {
  it("transitions lobby → voting, UPDATEs DB, broadcasts, returns { room }", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    const result = await updateRoomStatus(
      { roomId: VALID_ROOM_ID, status: "voting", userId: VALID_USER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.room).toMatchObject({
      id: VALID_ROOM_ID,
      status: "voting",
      ownerUserId: VALID_USER_ID,
    });
    expect(mock.updatePatches).toEqual([{ status: "voting" }]);
    expect(mock.updateEqCalls).toEqual([{ col: "id", val: VALID_ROOM_ID }]);
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "status_changed",
      status: "voting",
    });
  });
});
```

- [ ] **Step 2.2: Run test — verify RED**

Run: `npx vitest run src/lib/rooms/updateStatus.test.ts`
Expected: FAIL — `Error: not implemented`.

- [ ] **Step 2.3: Write minimal impl (GREEN)**

Replace the body of `src/lib/rooms/updateStatus.ts` with:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Room } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";

export interface RoomEventPayload {
  type: "status_changed";
  status: string;
}

export interface UpdateStatusInput {
  roomId: unknown;
  status: unknown;
  userId: unknown;
}

export interface UpdateStatusDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
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

type RoomRow = Database["public"]["Tables"]["rooms"]["Row"];

function mapRoom(row: RoomRow): Room {
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
    createdAt: row.created_at,
  };
}

export async function updateRoomStatus(
  input: UpdateStatusInput,
  deps: UpdateStatusDeps
): Promise<UpdateStatusResult> {
  const roomId = input.roomId as string;
  const status = input.status as string;

  const { data: updated } = await deps.supabase
    .from("rooms")
    .update({ status })
    .eq("id", roomId)
    .select()
    .single();

  await deps.broadcastRoomEvent(roomId, { type: "status_changed", status });
  return { ok: true, room: mapRoom(updated as RoomRow) };
}
```

- [ ] **Step 2.4: Run test — verify GREEN**

Run: `npx vitest run src/lib/rooms/updateStatus.test.ts`
Expected: PASS (1/1).

- [ ] **Step 2.5: Commit**

```bash
git add src/lib/rooms/updateStatus.ts src/lib/rooms/updateStatus.test.ts
git commit -m "updateRoomStatus: happy path (UPDATE + broadcast + return room)"
```

---

## Task 3: Input validation

**Files:**
- Modify: `src/lib/rooms/updateStatus.ts`
- Modify: `src/lib/rooms/updateStatus.test.ts`

- [ ] **Step 3.1: Append validation tests (RED)**

Append to `src/lib/rooms/updateStatus.test.ts`:

```ts
describe("updateRoomStatus — input validation", () => {
  it("rejects non-UUID roomId with INVALID_ROOM_ID", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn();
    const result = await updateRoomStatus(
      { roomId: "not-a-uuid", status: "voting", userId: VALID_USER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
    expect(mock.updatePatches).toEqual([]);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it("rejects non-string roomId with INVALID_ROOM_ID", async () => {
    const mock = makeSupabaseMock();
    const result = await updateRoomStatus(
      { roomId: 42, status: "voting", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_ROOM_ID" } });
  });

  it.each([undefined, null, 42, ""])(
    "rejects missing/empty/non-string userId (%s) with INVALID_USER_ID",
    async (userId) => {
      const mock = makeSupabaseMock();
      const result = await updateRoomStatus(
        { roomId: VALID_ROOM_ID, status: "voting", userId },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_USER_ID", field: "userId" },
      });
      expect(mock.updatePatches).toEqual([]);
    }
  );

  it.each([undefined, null, 42, "", "scoring", "announcing", "lobby", "voting_ending"])(
    "rejects status=%s (outside {voting, done}) with INVALID_STATUS",
    async (status) => {
      const mock = makeSupabaseMock();
      const result = await updateRoomStatus(
        { roomId: VALID_ROOM_ID, status, userId: VALID_USER_ID },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_STATUS", field: "status" },
      });
      expect(mock.updatePatches).toEqual([]);
    }
  );
});
```

- [ ] **Step 3.2: Run tests — verify RED**

Run: `npx vitest run src/lib/rooms/updateStatus.test.ts`
Expected: FAIL — most new tests fail (no validation yet); impl will try to query DB with garbage.

- [ ] **Step 3.3: Add validation (GREEN)**

In `src/lib/rooms/updateStatus.ts`, add near the top (above `mapRoom`):

```ts
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_REQUESTED_STATUSES: ReadonlySet<string> = new Set([
  "voting",
  "done",
]);

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): UpdateStatusFailure {
  return { ok: false, error: field ? { code, message, field } : { code, message }, status };
}
```

Then replace the body of `updateRoomStatus` with:

```ts
  if (typeof input.roomId !== "string" || !UUID_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID.", 400, "roomId");
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return fail("INVALID_USER_ID", "userId must be a non-empty string.", 400, "userId");
  }
  if (typeof input.status !== "string" || !ALLOWED_REQUESTED_STATUSES.has(input.status)) {
    return fail(
      "INVALID_STATUS",
      "status must be one of 'voting' or 'done'.",
      400,
      "status"
    );
  }
  const roomId = input.roomId;
  const status = input.status;

  const { data: updated } = await deps.supabase
    .from("rooms")
    .update({ status })
    .eq("id", roomId)
    .select()
    .single();

  await deps.broadcastRoomEvent(roomId, { type: "status_changed", status });
  return { ok: true, room: mapRoom(updated as RoomRow) };
```

- [ ] **Step 3.4: Run tests — verify GREEN**

Run: `npx vitest run src/lib/rooms/updateStatus.test.ts`
Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
git add src/lib/rooms/updateStatus.ts src/lib/rooms/updateStatus.test.ts
git commit -m "updateRoomStatus: validate roomId (UUID), userId, status"
```

---

## Task 4: Lookup guards (ROOM_NOT_FOUND + FORBIDDEN)

**Files:**
- Modify: `src/lib/rooms/updateStatus.ts`
- Modify: `src/lib/rooms/updateStatus.test.ts`

- [ ] **Step 4.1: Append lookup-guard tests (RED)**

Append to `src/lib/rooms/updateStatus.test.ts`:

```ts
describe("updateRoomStatus — room not found", () => {
  it("returns 404 ROOM_NOT_FOUND when the room does not exist", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: null },
    });
    const broadcastSpy = vi.fn();
    const result = await updateRoomStatus(
      { roomId: VALID_ROOM_ID, status: "voting", userId: VALID_USER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
    expect(mock.updatePatches).toEqual([]);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it("returns 404 ROOM_NOT_FOUND when the room SELECT errors", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: { message: "boom" } },
    });
    const result = await updateRoomStatus(
      { roomId: VALID_ROOM_ID, status: "voting", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "ROOM_NOT_FOUND" },
    });
  });
});

describe("updateRoomStatus — admin authorization", () => {
  it("returns 403 FORBIDDEN when caller is not the owner", async () => {
    const otherUserId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    const mock = makeSupabaseMock({
      roomSelectResult: {
        data: { id: VALID_ROOM_ID, status: "lobby", owner_user_id: otherUserId },
        error: null,
      },
    });
    const broadcastSpy = vi.fn();
    const result = await updateRoomStatus(
      { roomId: VALID_ROOM_ID, status: "voting", userId: VALID_USER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 403,
      error: { code: "FORBIDDEN" },
    });
    expect(mock.updatePatches).toEqual([]);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4.2: Run tests — verify RED**

Run: `npx vitest run src/lib/rooms/updateStatus.test.ts`
Expected: FAIL — current impl skips the SELECT entirely and runs UPDATE straight.

- [ ] **Step 4.3: Add room lookup + admin check (GREEN)**

In `src/lib/rooms/updateStatus.ts`, replace the body of `updateRoomStatus` (from the validation block to the end) with:

```ts
  if (typeof input.roomId !== "string" || !UUID_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID.", 400, "roomId");
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return fail("INVALID_USER_ID", "userId must be a non-empty string.", 400, "userId");
  }
  if (typeof input.status !== "string" || !ALLOWED_REQUESTED_STATUSES.has(input.status)) {
    return fail(
      "INVALID_STATUS",
      "status must be one of 'voting' or 'done'.",
      400,
      "status"
    );
  }
  const roomId = input.roomId;
  const userId = input.userId;
  const status = input.status;

  const roomQuery = await deps.supabase
    .from("rooms")
    .select("id, status, owner_user_id")
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const row = roomQuery.data as {
    id: string;
    status: string;
    owner_user_id: string;
  };

  if (row.owner_user_id !== userId) {
    return fail(
      "FORBIDDEN",
      "Only the room owner can change the room's status.",
      403
    );
  }

  const { data: updated } = await deps.supabase
    .from("rooms")
    .update({ status })
    .eq("id", roomId)
    .select()
    .single();

  await deps.broadcastRoomEvent(roomId, { type: "status_changed", status });
  return { ok: true, room: mapRoom(updated as RoomRow) };
```

- [ ] **Step 4.4: Run tests — verify GREEN**

Run: `npx vitest run src/lib/rooms/updateStatus.test.ts`
Expected: PASS.

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/rooms/updateStatus.ts src/lib/rooms/updateStatus.test.ts
git commit -m "updateRoomStatus: load room + admin check (404/403 guards)"
```

---

## Task 5: Transition matrix (INVALID_TRANSITION)

**Files:**
- Modify: `src/lib/rooms/updateStatus.ts`
- Modify: `src/lib/rooms/updateStatus.test.ts`

- [ ] **Step 5.1: Append transition tests (RED)**

Append to `src/lib/rooms/updateStatus.test.ts`:

```ts
describe("updateRoomStatus — transition matrix", () => {
  // Allowed edges: lobby->voting and announcing->done. All others should 409.
  const allowed: Array<[string, string]> = [
    ["lobby", "voting"],
    ["announcing", "done"],
  ];
  const allStatuses = ["lobby", "voting", "scoring", "announcing", "done"];
  const requested = ["voting", "done"];

  for (const current of allStatuses) {
    for (const req of requested) {
      const isAllowed = allowed.some(
        ([from, to]) => from === current && to === req
      );
      const label = `${current} -> ${req}`;
      if (isAllowed) {
        it(`allows ${label}`, async () => {
          const mock = makeSupabaseMock({
            roomSelectResult: {
              data: {
                id: VALID_ROOM_ID,
                status: current,
                owner_user_id: VALID_USER_ID,
              },
              error: null,
            },
            roomUpdateResult: {
              data: { ...defaultUpdatedRow, status: req },
              error: null,
            },
          });
          const broadcastSpy = vi.fn().mockResolvedValue(undefined);
          const result = await updateRoomStatus(
            { roomId: VALID_ROOM_ID, status: req, userId: VALID_USER_ID },
            makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
          );
          expect(result).toMatchObject({ ok: true, room: { status: req } });
          expect(broadcastSpy).toHaveBeenCalledTimes(1);
        });
      } else {
        it(`rejects ${label} with 409 INVALID_TRANSITION`, async () => {
          const mock = makeSupabaseMock({
            roomSelectResult: {
              data: {
                id: VALID_ROOM_ID,
                status: current,
                owner_user_id: VALID_USER_ID,
              },
              error: null,
            },
          });
          const broadcastSpy = vi.fn();
          const result = await updateRoomStatus(
            { roomId: VALID_ROOM_ID, status: req, userId: VALID_USER_ID },
            makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
          );
          expect(result).toMatchObject({
            ok: false,
            status: 409,
            error: { code: "INVALID_TRANSITION" },
          });
          expect(mock.updatePatches).toEqual([]);
          expect(broadcastSpy).not.toHaveBeenCalled();
        });
      }
    }
  }
});
```

- [ ] **Step 5.2: Run tests — verify RED**

Run: `npx vitest run src/lib/rooms/updateStatus.test.ts`
Expected: FAIL — 8 new `rejects …` tests fail; impl currently lets any status through.

- [ ] **Step 5.3: Add transition matrix guard (GREEN)**

In `src/lib/rooms/updateStatus.ts`, near the top (alongside `ALLOWED_REQUESTED_STATUSES`), add:

```ts
const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  lobby: ["voting"],
  announcing: ["done"],
};
```

Then, in `updateRoomStatus`, between the `if (row.owner_user_id !== userId)` block and the UPDATE call, insert:

```ts
  const allowed = ALLOWED_TRANSITIONS[row.status] ?? [];
  if (!allowed.includes(status)) {
    return fail(
      "INVALID_TRANSITION",
      `Cannot transition from '${row.status}' to '${status}'.`,
      409
    );
  }
```

- [ ] **Step 5.4: Run tests — verify GREEN**

Run: `npx vitest run src/lib/rooms/updateStatus.test.ts`
Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add src/lib/rooms/updateStatus.ts src/lib/rooms/updateStatus.test.ts
git commit -m "updateRoomStatus: enforce allowed transitions (lobby->voting, announcing->done)"
```

---

## Task 6: Broadcast semantics + UPDATE error

**Files:**
- Modify: `src/lib/rooms/updateStatus.ts`
- Modify: `src/lib/rooms/updateStatus.test.ts`

- [ ] **Step 6.1: Append broadcast + DB-error tests (RED)**

Append to `src/lib/rooms/updateStatus.test.ts`:

```ts
describe("updateRoomStatus — broadcast semantics", () => {
  it("does NOT roll back or 500 when the broadcast throws; logs a warning", async () => {
    const mock = makeSupabaseMock();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broadcastSpy = vi
      .fn()
      .mockRejectedValue(new Error("realtime channel disconnected"));
    const result = await updateRoomStatus(
      { roomId: VALID_ROOM_ID, status: "voting", userId: VALID_USER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result).toMatchObject({ ok: true, room: { status: "voting" } });
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

describe("updateRoomStatus — UPDATE error", () => {
  it("returns 500 INTERNAL_ERROR when the UPDATE fails; does NOT broadcast", async () => {
    const mock = makeSupabaseMock({
      roomUpdateResult: { data: null, error: { message: "write failed" } },
    });
    const broadcastSpy = vi.fn();
    const result = await updateRoomStatus(
      { roomId: VALID_ROOM_ID, status: "voting", userId: VALID_USER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
    expect(broadcastSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6.2: Run tests — verify RED**

Run: `npx vitest run src/lib/rooms/updateStatus.test.ts`
Expected: both new tests fail — broadcast failure currently bubbles and rejects the promise; UPDATE error currently passes null to mapRoom and crashes.

- [ ] **Step 6.3: Guard UPDATE error + wrap broadcast (GREEN)**

In `src/lib/rooms/updateStatus.ts`, replace the UPDATE + broadcast + return block at the end of `updateRoomStatus` with:

```ts
  const updateResult = await deps.supabase
    .from("rooms")
    .update({ status })
    .eq("id", roomId)
    .select()
    .single();

  if (updateResult.error || !updateResult.data) {
    return fail("INTERNAL_ERROR", "Could not update room. Please try again.", 500);
  }

  try {
    await deps.broadcastRoomEvent(roomId, { type: "status_changed", status });
  } catch (err) {
    console.warn(
      `broadcast 'status_changed' failed for room ${roomId}; state committed regardless:`,
      err
    );
  }

  return { ok: true, room: mapRoom(updateResult.data as RoomRow) };
```

- [ ] **Step 6.4: Run tests — verify GREEN**

Run: `npx vitest run src/lib/rooms/updateStatus.test.ts`
Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
git add src/lib/rooms/updateStatus.ts src/lib/rooms/updateStatus.test.ts
git commit -m "updateRoomStatus: UPDATE-error 500, broadcast-failure non-fatal with warn"
```

---

## Task 7: Route adapter

**Files:**
- Modify: `src/app/api/rooms/[id]/status/route.ts`
- Create: `src/app/api/rooms/[id]/status/route.test.ts`

- [ ] **Step 7.1: Write the route-adapter tests (RED)**

Create `src/app/api/rooms/[id]/status/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

let roomSelectResult: { data: unknown; error: { message: string } | null } = {
  data: {
    id: VALID_ROOM_ID,
    status: "lobby",
    owner_user_id: VALID_USER_ID,
  },
  error: null,
};

const updatedRow = {
  id: VALID_ROOM_ID,
  pin: "AAAAAA",
  year: 2026,
  event: "final",
  categories: [{ name: "Vocals", weight: 1 }],
  owner_user_id: VALID_USER_ID,
  status: "voting",
  announcement_mode: "instant",
  announcement_order: null,
  announcing_user_id: null,
  current_announce_idx: 0,
  now_performing_id: null,
  allow_now_performing: false,
  created_at: "2026-04-19T12:00:00Z",
};

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue(roomSelectResult),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: updatedRow, error: null }),
          })),
        })),
      })),
    })),
    channel: vi.fn(() => ({
      send: vi.fn().mockResolvedValue(undefined),
    })),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { PATCH } from "@/app/api/rooms/[id]/status/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/rooms/${VALID_ROOM_ID}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/rooms/[id]/status (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roomSelectResult = {
      data: {
        id: VALID_ROOM_ID,
        status: "lobby",
        owner_user_id: VALID_USER_ID,
      },
      error: null,
    };
  });

  it("returns 200 with { room } on lobby -> voting", async () => {
    const res = await PATCH(
      makeRequest({ status: "voting", userId: VALID_USER_ID }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      room: { id: string; status: string };
    };
    expect(body.room).toMatchObject({
      id: VALID_ROOM_ID,
      status: "voting",
    });
  });

  it("returns 400 INVALID_BODY on non-JSON body", async () => {
    const req = new NextRequest(
      `http://localhost/api/rooms/${VALID_ROOM_ID}/status`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "not json{{{",
      }
    );
    const res = await PATCH(req, { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 403 FORBIDDEN when userId is not the owner", async () => {
    const res = await PATCH(
      makeRequest({ status: "voting", userId: "cccccccc-dddd-4eee-8fff-000000000000" }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 404 ROOM_NOT_FOUND on unknown room", async () => {
    roomSelectResult = { data: null, error: null };
    const res = await PATCH(
      makeRequest({ status: "voting", userId: VALID_USER_ID }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("returns 409 INVALID_TRANSITION on lobby -> done", async () => {
    const res = await PATCH(
      makeRequest({ status: "done", userId: VALID_USER_ID }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_TRANSITION");
  });
});
```

- [ ] **Step 7.2: Run tests — verify RED**

Run: `npx vitest run src/app/api/rooms/[id]/status/route.test.ts`
Expected: FAIL — route currently returns 501; all tests fail.

- [ ] **Step 7.3: Wire the route (GREEN)**

Replace the entire contents of `src/app/api/rooms/[id]/status/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { updateRoomStatus, type RoomEventPayload } from "@/lib/rooms/updateStatus";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

async function defaultBroadcastRoomEvent(
  roomId: string,
  event: RoomEventPayload
): Promise<void> {
  const supabase = createServiceClient();
  const channel = supabase.channel(`room:${roomId}`);
  try {
    await channel.send({
      type: "broadcast",
      event: "room_event",
      payload: event,
    });
  } finally {
    await supabase.removeChannel(channel);
  }
}

/**
 * PATCH /api/rooms/{id}/status
 * Body: { status: 'voting' | 'done', userId: string }
 * Returns 200 { room } on success.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_BODY", "Request body must be valid JSON.", 400);
  }
  if (typeof body !== "object" || body === null) {
    return apiError("INVALID_BODY", "Request body must be a JSON object.", 400);
  }

  const input = body as { status?: unknown; userId?: unknown };
  const result = await updateRoomStatus(
    { roomId: params.id, status: input.status, userId: input.userId },
    {
      supabase: createServiceClient(),
      broadcastRoomEvent: defaultBroadcastRoomEvent,
    }
  );

  if (result.ok) {
    return NextResponse.json({ room: result.room }, { status: 200 });
  }
  return apiError(result.error.code, result.error.message, result.status, result.error.field);
}
```

- [ ] **Step 7.4: Run tests — verify GREEN**

Run: `npx vitest run src/app/api/rooms/[id]/status/route.test.ts`
Expected: PASS (5/5).

- [ ] **Step 7.5: Commit**

```bash
git add src/app/api/rooms/[id]/status/route.ts src/app/api/rooms/[id]/status/route.test.ts
git commit -m "updateRoomStatus: wire PATCH /api/rooms/[id]/status route adapter"
```

---

## Task 8: Full verification + push + PR

**Files:**
- Modify: `TODO.md` (gitignored — local tick only)

- [ ] **Step 8.1: Run the full pre-push gate**

Run: `npm run pre-push`
Expected: `tsc --noEmit` clean; `vitest` full suite passes. Test count expected to grow by ~25–30 versus baseline.

- [ ] **Step 8.2: Tick Phase 2 item in `TODO.md`**

Edit `TODO.md` — find the Phase 2 line `- [ ] PATCH /api/rooms/{id}/status` and change `[ ]` to `[x]`. `TODO.md` is gitignored — no commit needed.

- [ ] **Step 8.3: Push the branch**

Run: `git push -u origin feat/patch-room-status`
Expected: push succeeds (pre-push hook re-runs `npm run pre-push`).

- [ ] **Step 8.4: Open the PR**

Run:

```bash
gh pr create --base main \
  --title "Add PATCH /api/rooms/{id}/status (admin state transitions + broadcast)" \
  --body "$(cat <<'EOF'
## Summary
- Pure `updateRoomStatus()` lib under `src/lib/rooms/updateStatus.ts` with DI over supabase and `broadcastRoomEvent`. Validates inputs, loads the room, enforces admin ownership (403), validates transition (only `lobby → voting` and `announcing → done`; all other combinations → 409), UPDATEs the row, then broadcasts `{ type: 'status_changed', status }` on the `room:{roomId}` channel.
- Broadcast failure is non-fatal (state already committed, postgres_changes are a redundant path per §13); logs a warning.
- Thin route adapter at `src/app/api/rooms/[id]/status/route.ts` with a default `broadcastRoomEvent` implementation using `supabase.channel(...).send(...)`.
- New error codes: `FORBIDDEN`, `INVALID_STATUS`, `INVALID_TRANSITION`.
- Follows the approved design + plan:
  - [design](docs/superpowers/specs/2026-04-19-patch-room-status-design.md)
  - [plan](docs/superpowers/plans/2026-04-19-patch-room-status.md)

Closes the fourth item of Phase 2 in TODO.md.

## Test plan
- [x] `npm run type-check`
- [x] `npm test` (all green)
- [ ] Manual smoke once lobby UI's "Start voting" button consumes this

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 8.5: Done**

Report the PR URL and await merge.

---

## Out of scope

- `voting_ending` transition (§6.3.1) — requires Phase R0 schema migration.
- `assertRoomAdmin()` / `broadcastRoomEvent()` shared helper extraction — deferred until `/now-performing` (next endpoint) lands as the second caller.
- `mapRoom` extraction (now duplicated 3× across `createRoom`/`getRoom`/`updateStatus`) — flagged as a follow-up refactor; this PR keeps it local to preserve the committed design.
- Per-request session token verification — cross-cutting; its own PR.
- i18n of error messages (`errors.*` keys) — Phase 1.5 T9 will pick these up including the three new codes this PR adds.
- UI consumption (lobby "Start voting" button) — Phase 2 UI tasks.

---

## Self-review

**Spec coverage**
- Contract (§Contract) — Task 2 (200 shape) + Task 7 (route adapter 200/400/403/404/409).
- Allowed transitions choice A (§Allowed transitions) — Task 5.
- Admin auth (§Admin authentication) — Task 4.
- Broadcast semantics (§Broadcast) — Task 6.
- Authorization ordering (§Authorization / lookup ordering) — implicit through validation (Task 3) → lookup (Task 4) → transition check (Task 5) → UPDATE (Task 6).
- New error codes (§Additions to `api-errors.ts`) — Task 1.
- Test plan (§Test plan) — covered across Tasks 2–7.

**Placeholder scan:** none. Every step has concrete code blocks or concrete commands with expected output. No "TBD", no "handle edge cases".

**Type consistency:** `UpdateStatusInput`, `UpdateStatusDeps`, `UpdateStatusResult`, `RoomEventPayload` defined in Task 1, reused verbatim in Tasks 2–6. `ALLOWED_REQUESTED_STATUSES` (Task 3), `ALLOWED_TRANSITIONS` (Task 5), `fail()` (Task 3), `mapRoom()` (Task 2), `RoomRow` (Task 2) all named consistently and referenced exactly where introduced.

**Scope:** one endpoint, one lib, one route adapter, one set of tests each. Single-plan territory.
