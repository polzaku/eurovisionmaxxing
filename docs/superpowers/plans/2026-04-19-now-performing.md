# PATCH /api/rooms/{id}/now-performing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `PATCH /api/rooms/{id}/now-performing` — admin-only setter for `rooms.now_performing_id` with a `now_performing` broadcast — and extract the shared helpers (`mapRoom`, `RoomEventPayload`, `defaultBroadcastRoomEvent`) that are now duplicated across three existing endpoints. Per `docs/superpowers/specs/2026-04-19-now-performing-design.md`.

**Architecture:** Pure `updateRoomNowPerforming(input, deps)` library with DI over supabase and `broadcastRoomEvent`, mirroring the `updateStatus` shape. A new `src/lib/rooms/shared.ts` hosts the three primitives currently duplicated across `createRoom`, `getRoom`, `updateStatus`, and the `status` route adapter.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase (`@supabase/supabase-js`), Vitest.

---

## File structure

| Path | Kind | Responsibility |
|---|---|---|
| `src/lib/api-errors.ts` | modify | +3 codes: `INVALID_CONTESTANT_ID`, `NOW_PERFORMING_DISABLED`, `ROOM_NOT_VOTING` |
| `src/lib/rooms/shared.ts` | **new** | `mapRoom(row)`, `RoomEventPayload` union, `defaultBroadcastRoomEvent(roomId, event)` |
| `src/lib/rooms/shared.test.ts` | **new** | Unit test for `mapRoom` (canonical contract); type + broadcast impl are exercised indirectly |
| `src/lib/rooms/create.ts` | modify | Delete local `mapRoom`; `import { mapRoom } from "./shared"` |
| `src/lib/rooms/get.ts` | modify | Delete local `mapRoom`; `import { mapRoom } from "./shared"` |
| `src/lib/rooms/updateStatus.ts` | modify | Delete local `mapRoom` + local `RoomEventPayload`; `import { mapRoom, type RoomEventPayload } from "./shared"` |
| `src/lib/rooms/updateStatus.test.ts` | modify | Remove unused `type RoomEventPayload` from the `@/lib/rooms/updateStatus` import line |
| `src/app/api/rooms/[id]/status/route.ts` | modify | Delete local `defaultBroadcastRoomEvent`; import it and `RoomEventPayload` from `@/lib/rooms/shared` |
| `src/lib/rooms/updateNowPerforming.ts` | **new** | Pure handler: validate → load room → admin check → state guards → UPDATE → broadcast → return |
| `src/lib/rooms/updateNowPerforming.test.ts` | **new** | Unit tests over the pure handler |
| `src/app/api/rooms/[id]/now-performing/route.ts` | modify | Wire PATCH adapter (currently a 501 stub) using shared `defaultBroadcastRoomEvent` |
| `src/app/api/rooms/[id]/now-performing/route.test.ts` | **new** | Adapter tests |

---

## Task 1: Bootstrap — error codes + lib stub

**Files:**
- Modify: `src/lib/api-errors.ts`
- Create: `src/lib/rooms/updateNowPerforming.ts`

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
  | "INVALID_CONTESTANT_ID"
  | "FORBIDDEN"
  | "USER_NOT_FOUND"
  | "ROOM_NOT_FOUND"
  | "ROOM_NOT_JOINABLE"
  | "ROOM_NOT_VOTING"
  | "NOW_PERFORMING_DISABLED"
  | "CANDIDATE_NOT_FOUND"
  | "INVALID_TOKEN"
  | "INTERNAL_ERROR";
```

- [ ] **Step 1.2: Create the lib stub**

Create `src/lib/rooms/updateNowPerforming.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Room } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface UpdateNowPerformingInput {
  roomId: unknown;
  contestantId: unknown;
  userId: unknown;
}

export interface UpdateNowPerformingDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
}

export interface UpdateNowPerformingSuccess {
  ok: true;
  room: Room;
}

export interface UpdateNowPerformingFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type UpdateNowPerformingResult =
  | UpdateNowPerformingSuccess
  | UpdateNowPerformingFailure;

export async function updateRoomNowPerforming(
  _input: UpdateNowPerformingInput,
  _deps: UpdateNowPerformingDeps
): Promise<UpdateNowPerformingResult> {
  throw new Error("not implemented");
}
```

Note: imports `RoomEventPayload` from `@/lib/rooms/shared` which Task 2 creates. Type-check will fail until Task 2 — that's fine; we're not running it yet.

- [ ] **Step 1.3: Commit**

```bash
git add src/lib/api-errors.ts src/lib/rooms/updateNowPerforming.ts
git commit -m "Bootstrap updateNowPerforming lib: error codes + stub handler"
```

---

## Task 2: Create `shared.ts`

**Files:**
- Create: `src/lib/rooms/shared.ts`
- Create: `src/lib/rooms/shared.test.ts`

- [ ] **Step 2.1: Create `shared.ts`**

Create `src/lib/rooms/shared.ts`:

```ts
import type { Database } from "@/types/database";
import type { Room } from "@/types";
import { createServiceClient } from "@/lib/supabase/server";

/** Discriminated union of realtime broadcast payloads on `room:{id}` channels (SPEC §15). */
export type RoomEventPayload =
  | { type: "status_changed"; status: string }
  | { type: "now_performing"; contestantId: string };

type RoomRow = Database["public"]["Tables"]["rooms"]["Row"];

/** Maps a rooms row to the domain Room. */
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
    createdAt: row.created_at,
  };
}

/** Default production broadcast implementation. Route adapters inject this; tests mock it. */
export async function defaultBroadcastRoomEvent(
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
```

- [ ] **Step 2.2: Create `shared.test.ts` (mapRoom contract)**

Create `src/lib/rooms/shared.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapRoom } from "@/lib/rooms/shared";
import type { Database } from "@/types/database";

type RoomRow = Database["public"]["Tables"]["rooms"]["Row"];

describe("mapRoom", () => {
  it("maps a full rooms row to the domain Room shape", () => {
    const row: RoomRow = {
      id: "room-uuid",
      pin: "AAAAAA",
      year: 2026,
      event: "final",
      categories: [{ name: "Vocals", weight: 1 }],
      owner_user_id: "owner-uuid",
      status: "lobby",
      announcement_mode: "instant",
      announcement_order: null,
      announcing_user_id: null,
      current_announce_idx: 0,
      now_performing_id: null,
      allow_now_performing: false,
      created_at: "2026-04-19T12:00:00Z",
    };
    expect(mapRoom(row)).toEqual({
      id: "room-uuid",
      pin: "AAAAAA",
      year: 2026,
      event: "final",
      categories: [{ name: "Vocals", weight: 1 }],
      ownerUserId: "owner-uuid",
      status: "lobby",
      announcementMode: "instant",
      announcementOrder: null,
      announcingUserId: null,
      currentAnnounceIdx: 0,
      nowPerformingId: null,
      allowNowPerforming: false,
      createdAt: "2026-04-19T12:00:00Z",
    });
  });

  it("passes through nullable announcement fields unchanged", () => {
    const row: RoomRow = {
      id: "r",
      pin: "BBBBBB",
      year: 2025,
      event: "semi1",
      categories: [],
      owner_user_id: "u",
      status: "announcing",
      announcement_mode: "live",
      announcement_order: ["u-1", "u-2"],
      announcing_user_id: "u-1",
      current_announce_idx: 3,
      now_performing_id: "2025-ua",
      allow_now_performing: true,
      created_at: "2026-04-19T12:00:00Z",
    };
    const mapped = mapRoom(row);
    expect(mapped.announcementOrder).toEqual(["u-1", "u-2"]);
    expect(mapped.announcingUserId).toBe("u-1");
    expect(mapped.currentAnnounceIdx).toBe(3);
    expect(mapped.nowPerformingId).toBe("2025-ua");
    expect(mapped.allowNowPerforming).toBe(true);
  });
});
```

- [ ] **Step 2.3: Run test + type-check**

Run: `npx vitest run src/lib/rooms/shared.test.ts && npm run type-check`
Expected: vitest 2/2 PASS; tsc exit 0. (`updateNowPerforming.ts` now type-checks because `shared.ts` exports `RoomEventPayload`.)

- [ ] **Step 2.4: Commit**

```bash
git add src/lib/rooms/shared.ts src/lib/rooms/shared.test.ts
git commit -m "Extract mapRoom, RoomEventPayload, defaultBroadcastRoomEvent to rooms/shared"
```

---

## Task 3: Migrate existing call sites to `shared.ts`

**Files:**
- Modify: `src/lib/rooms/create.ts`
- Modify: `src/lib/rooms/get.ts`
- Modify: `src/lib/rooms/updateStatus.ts`
- Modify: `src/lib/rooms/updateStatus.test.ts`
- Modify: `src/app/api/rooms/[id]/status/route.ts`

**Strategy:** behaviour-preserving edits only. Existing test suites (68 tests across these three libs + their route adapters) must stay green.

- [ ] **Step 3.1: Edit `create.ts`**

In `src/lib/rooms/create.ts`:
- Delete the local `type RoomRow = Database["public"]["Tables"]["rooms"]["Row"];` line.
- Delete the local `function mapRoom(row: RoomRow): Room { ... }` block (~18 lines).
- Add `import { mapRoom } from "@/lib/rooms/shared";` among the other imports.

The `type RoomRow` import is still needed elsewhere in the file — re-inline it only if grep shows it's referenced. If it's now unused, remove it.

- [ ] **Step 3.2: Edit `get.ts`**

In `src/lib/rooms/get.ts`:
- Delete the local `type RoomRow = …` and `function mapRoom(row: RoomRow): Room { ... }`.
- Add `import { mapRoom } from "@/lib/rooms/shared";`.
- Remove any now-unused `type RoomRow` or `Database` imports.

- [ ] **Step 3.3: Edit `updateStatus.ts`**

In `src/lib/rooms/updateStatus.ts`:
- Delete the top-of-file block defining `RoomEventPayload` (the local discriminated union — currently only has `status_changed`).
- Delete the local `type RoomRow = …` and `function mapRoom(row: RoomRow): Room { ... }`.
- Replace them with `import { mapRoom, type RoomEventPayload } from "@/lib/rooms/shared";`.
- Keep the re-export `export type { RoomEventPayload }` at the same module level so existing external importers (route adapter) that still read it from this file don't break while we migrate them in the next step. Add:

```ts
export type { RoomEventPayload } from "@/lib/rooms/shared";
```

- [ ] **Step 3.4: Edit `updateStatus.test.ts`**

In `src/lib/rooms/updateStatus.test.ts`, find the imports block:

```ts
import {
  updateRoomStatus,
  type UpdateStatusDeps,
  type RoomEventPayload,
} from "@/lib/rooms/updateStatus";
```

Delete the line `type RoomEventPayload,` — the test body doesn't reference the type. The import becomes:

```ts
import {
  updateRoomStatus,
  type UpdateStatusDeps,
} from "@/lib/rooms/updateStatus";
```

- [ ] **Step 3.5: Edit `status/route.ts`**

In `src/app/api/rooms/[id]/status/route.ts`:
- Delete the local `async function defaultBroadcastRoomEvent(...) { ... }` block.
- Replace the imports top-of-file with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { updateRoomStatus } from "@/lib/rooms/updateStatus";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";
```

The `RoomEventPayload` type is no longer needed in this file (the local `defaultBroadcastRoomEvent` used it; the shared one carries its own type internally). Remove that import if it was there.

Leave the rest of the file (the `PATCH` handler body) untouched.

- [ ] **Step 3.6: Drop the re-export compat shim from `updateStatus.ts`**

Now that the only external caller (`status/route.ts`) imports from `shared` directly, the `export type { RoomEventPayload }` line in `updateStatus.ts` added in Step 3.3 can be deleted — it was a temporary bridge. Delete it.

- [ ] **Step 3.7: Run the full regression suite + type-check**

Run: `npm run pre-push`
Expected: `tsc --noEmit` exit 0; vitest passes — at least 283/283 (pre-existing 281 + the 2 new `shared` tests from Task 2).

**If anything fails:** stop and diagnose. The refactor is supposed to be behaviour-preserving. Common failure modes:
- Unused `Database` / `RoomRow` import left behind → delete it.
- Missed the `updateStatus.test.ts` type-import line → remove `type RoomEventPayload` from the import.

- [ ] **Step 3.8: Commit**

```bash
git add src/lib/rooms/create.ts src/lib/rooms/get.ts src/lib/rooms/updateStatus.ts src/lib/rooms/updateStatus.test.ts src/app/api/rooms/[id]/status/route.ts
git commit -m "Migrate create/get/updateStatus/status-route to rooms/shared helpers"
```

---

## Task 4: Happy path for `updateRoomNowPerforming`

**Files:**
- Create: `src/lib/rooms/updateNowPerforming.test.ts`
- Modify: `src/lib/rooms/updateNowPerforming.ts`

- [ ] **Step 4.1: Write the happy-path test (RED)**

Create `src/lib/rooms/updateNowPerforming.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  updateRoomNowPerforming,
  type UpdateNowPerformingDeps,
} from "@/lib/rooms/updateNowPerforming";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const VALID_CONTESTANT_ID = "2026-ua";

const defaultRoomRow = {
  id: VALID_ROOM_ID,
  status: "voting",
  owner_user_id: VALID_USER_ID,
  allow_now_performing: true,
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
  now_performing_id: VALID_CONTESTANT_ID,
  allow_now_performing: true,
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
    supabase: { from } as unknown as UpdateNowPerformingDeps["supabase"],
    selectEqCalls,
    updatePatches,
    updateEqCalls,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<UpdateNowPerformingDeps> = {}
): UpdateNowPerformingDeps {
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("updateRoomNowPerforming — happy path", () => {
  it("sets now_performing_id, broadcasts, returns { room }", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    const result = await updateRoomNowPerforming(
      {
        roomId: VALID_ROOM_ID,
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.room).toMatchObject({
      id: VALID_ROOM_ID,
      nowPerformingId: VALID_CONTESTANT_ID,
    });
    expect(mock.updatePatches).toEqual([
      { now_performing_id: VALID_CONTESTANT_ID },
    ]);
    expect(mock.updateEqCalls).toEqual([{ col: "id", val: VALID_ROOM_ID }]);
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "now_performing",
      contestantId: VALID_CONTESTANT_ID,
    });
  });
});
```

- [ ] **Step 4.2: Run test — verify RED**

Run: `npx vitest run src/lib/rooms/updateNowPerforming.test.ts`
Expected: FAIL — `Error: not implemented`.

- [ ] **Step 4.3: Write minimal impl (GREEN)**

Replace the body of `src/lib/rooms/updateNowPerforming.ts` with:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Room } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";
import { mapRoom, type RoomEventPayload } from "@/lib/rooms/shared";

export interface UpdateNowPerformingInput {
  roomId: unknown;
  contestantId: unknown;
  userId: unknown;
}

export interface UpdateNowPerformingDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
}

export interface UpdateNowPerformingSuccess {
  ok: true;
  room: Room;
}

export interface UpdateNowPerformingFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type UpdateNowPerformingResult =
  | UpdateNowPerformingSuccess
  | UpdateNowPerformingFailure;

type RoomRow = Database["public"]["Tables"]["rooms"]["Row"];

export async function updateRoomNowPerforming(
  input: UpdateNowPerformingInput,
  deps: UpdateNowPerformingDeps
): Promise<UpdateNowPerformingResult> {
  const roomId = input.roomId as string;
  const contestantId = input.contestantId as string;

  const { data: updated } = await deps.supabase
    .from("rooms")
    .update({ now_performing_id: contestantId })
    .eq("id", roomId)
    .select()
    .single();

  await deps.broadcastRoomEvent(roomId, {
    type: "now_performing",
    contestantId,
  });
  return { ok: true, room: mapRoom(updated as RoomRow) };
}
```

- [ ] **Step 4.4: Run test — verify GREEN**

Run: `npx vitest run src/lib/rooms/updateNowPerforming.test.ts`
Expected: PASS (1/1).

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/rooms/updateNowPerforming.ts src/lib/rooms/updateNowPerforming.test.ts
git commit -m "updateNowPerforming: happy path (UPDATE + broadcast + return room)"
```

---

## Task 5: Input validation

**Files:**
- Modify: `src/lib/rooms/updateNowPerforming.ts`
- Modify: `src/lib/rooms/updateNowPerforming.test.ts`

- [ ] **Step 5.1: Append validation tests (RED)**

Append to `src/lib/rooms/updateNowPerforming.test.ts`:

```ts
describe("updateRoomNowPerforming — input validation", () => {
  it("rejects non-UUID roomId with INVALID_ROOM_ID", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn();
    const result = await updateRoomNowPerforming(
      {
        roomId: "not-a-uuid",
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      },
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
    const result = await updateRoomNowPerforming(
      { roomId: 42, contestantId: VALID_CONTESTANT_ID, userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_ROOM_ID" } });
  });

  it.each([undefined, null, 42, ""])(
    "rejects missing/empty/non-string userId (%s) with INVALID_USER_ID",
    async (userId) => {
      const mock = makeSupabaseMock();
      const result = await updateRoomNowPerforming(
        { roomId: VALID_ROOM_ID, contestantId: VALID_CONTESTANT_ID, userId },
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

  it.each([undefined, null, 42, ""])(
    "rejects missing/empty/non-string contestantId (%s) with INVALID_CONTESTANT_ID",
    async (contestantId) => {
      const mock = makeSupabaseMock();
      const result = await updateRoomNowPerforming(
        { roomId: VALID_ROOM_ID, contestantId, userId: VALID_USER_ID },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_CONTESTANT_ID", field: "contestantId" },
      });
      expect(mock.updatePatches).toEqual([]);
    }
  );

  it("rejects contestantId longer than 20 chars with INVALID_CONTESTANT_ID", async () => {
    const mock = makeSupabaseMock();
    const result = await updateRoomNowPerforming(
      {
        roomId: VALID_ROOM_ID,
        contestantId: "2026-thisistoolongforthecolumn",
        userId: VALID_USER_ID,
      },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_CONTESTANT_ID" },
    });
  });
});
```

- [ ] **Step 5.2: Run tests — verify RED**

Run: `npx vitest run src/lib/rooms/updateNowPerforming.test.ts`
Expected: most new tests fail (no validation).

- [ ] **Step 5.3: Add validation (GREEN)**

In `src/lib/rooms/updateNowPerforming.ts`, insert these constants + helper near the top (above `updateRoomNowPerforming`, below the types):

```ts
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTESTANT_ID_MAX_LEN = 20;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): UpdateNowPerformingFailure {
  return { ok: false, error: field ? { code, message, field } : { code, message }, status };
}
```

Replace the body of `updateRoomNowPerforming` (starting with `const roomId = input.roomId as string;`) with:

```ts
  if (typeof input.roomId !== "string" || !UUID_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID.", 400, "roomId");
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return fail("INVALID_USER_ID", "userId must be a non-empty string.", 400, "userId");
  }
  if (
    typeof input.contestantId !== "string" ||
    input.contestantId.length === 0 ||
    input.contestantId.length > CONTESTANT_ID_MAX_LEN
  ) {
    return fail(
      "INVALID_CONTESTANT_ID",
      `contestantId must be a string between 1 and ${CONTESTANT_ID_MAX_LEN} characters.`,
      400,
      "contestantId"
    );
  }
  const roomId = input.roomId;
  const contestantId = input.contestantId;

  const { data: updated } = await deps.supabase
    .from("rooms")
    .update({ now_performing_id: contestantId })
    .eq("id", roomId)
    .select()
    .single();

  await deps.broadcastRoomEvent(roomId, {
    type: "now_performing",
    contestantId,
  });
  return { ok: true, room: mapRoom(updated as RoomRow) };
```

- [ ] **Step 5.4: Run tests — verify GREEN**

Run: `npx vitest run src/lib/rooms/updateNowPerforming.test.ts`
Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add src/lib/rooms/updateNowPerforming.ts src/lib/rooms/updateNowPerforming.test.ts
git commit -m "updateNowPerforming: validate roomId (UUID), userId, contestantId"
```

---

## Task 6: Lookup guards (ROOM_NOT_FOUND + FORBIDDEN)

**Files:**
- Modify: `src/lib/rooms/updateNowPerforming.ts`
- Modify: `src/lib/rooms/updateNowPerforming.test.ts`

- [ ] **Step 6.1: Append lookup-guard tests (RED)**

Append to `src/lib/rooms/updateNowPerforming.test.ts`:

```ts
describe("updateRoomNowPerforming — room not found", () => {
  it("returns 404 ROOM_NOT_FOUND when the room does not exist", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: null },
    });
    const broadcastSpy = vi.fn();
    const result = await updateRoomNowPerforming(
      {
        roomId: VALID_ROOM_ID,
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      },
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
    const result = await updateRoomNowPerforming(
      {
        roomId: VALID_ROOM_ID,
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "ROOM_NOT_FOUND" } });
  });
});

describe("updateRoomNowPerforming — admin authorization", () => {
  it("returns 403 FORBIDDEN when caller is not the owner", async () => {
    const otherUserId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    const mock = makeSupabaseMock({
      roomSelectResult: {
        data: {
          id: VALID_ROOM_ID,
          status: "voting",
          owner_user_id: otherUserId,
          allow_now_performing: true,
        },
        error: null,
      },
    });
    const broadcastSpy = vi.fn();
    const result = await updateRoomNowPerforming(
      {
        roomId: VALID_ROOM_ID,
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      },
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

- [ ] **Step 6.2: Run tests — verify RED**

Run: `npx vitest run src/lib/rooms/updateNowPerforming.test.ts`
Expected: FAIL — current impl skips the SELECT entirely.

- [ ] **Step 6.3: Add room lookup + admin check (GREEN)**

In `src/lib/rooms/updateNowPerforming.ts`, replace the part of `updateRoomNowPerforming` starting at `const roomId = input.roomId;` through the end with:

```ts
  const roomId = input.roomId;
  const userId = input.userId;
  const contestantId = input.contestantId;

  const roomQuery = await deps.supabase
    .from("rooms")
    .select("id, status, owner_user_id, allow_now_performing")
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const row = roomQuery.data as {
    id: string;
    status: string;
    owner_user_id: string;
    allow_now_performing: boolean;
  };

  if (row.owner_user_id !== userId) {
    return fail(
      "FORBIDDEN",
      "Only the room owner can set the currently-performing contestant.",
      403
    );
  }

  const { data: updated } = await deps.supabase
    .from("rooms")
    .update({ now_performing_id: contestantId })
    .eq("id", roomId)
    .select()
    .single();

  await deps.broadcastRoomEvent(roomId, {
    type: "now_performing",
    contestantId,
  });
  return { ok: true, room: mapRoom(updated as RoomRow) };
}
```

- [ ] **Step 6.4: Run tests — verify GREEN**

Run: `npx vitest run src/lib/rooms/updateNowPerforming.test.ts`
Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
git add src/lib/rooms/updateNowPerforming.ts src/lib/rooms/updateNowPerforming.test.ts
git commit -m "updateNowPerforming: load room + admin check (404/403 guards)"
```

---

## Task 7: State guards (NOW_PERFORMING_DISABLED + ROOM_NOT_VOTING)

**Files:**
- Modify: `src/lib/rooms/updateNowPerforming.ts`
- Modify: `src/lib/rooms/updateNowPerforming.test.ts`

- [ ] **Step 7.1: Append state-guard tests (RED)**

Append to `src/lib/rooms/updateNowPerforming.test.ts`:

```ts
describe("updateRoomNowPerforming — state guards", () => {
  it("returns 409 NOW_PERFORMING_DISABLED when allow_now_performing is false", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: {
        data: {
          id: VALID_ROOM_ID,
          status: "voting",
          owner_user_id: VALID_USER_ID,
          allow_now_performing: false,
        },
        error: null,
      },
    });
    const broadcastSpy = vi.fn();
    const result = await updateRoomNowPerforming(
      {
        roomId: VALID_ROOM_ID,
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "NOW_PERFORMING_DISABLED" },
    });
    expect(mock.updatePatches).toEqual([]);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it.each(["lobby", "scoring", "announcing", "done"] as const)(
    "returns 409 ROOM_NOT_VOTING when status=%s (with allow_now_performing=true)",
    async (status) => {
      const mock = makeSupabaseMock({
        roomSelectResult: {
          data: {
            id: VALID_ROOM_ID,
            status,
            owner_user_id: VALID_USER_ID,
            allow_now_performing: true,
          },
          error: null,
        },
      });
      const broadcastSpy = vi.fn();
      const result = await updateRoomNowPerforming(
        {
          roomId: VALID_ROOM_ID,
          contestantId: VALID_CONTESTANT_ID,
          userId: VALID_USER_ID,
        },
        makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
      );
      expect(result).toMatchObject({
        ok: false,
        status: 409,
        error: { code: "ROOM_NOT_VOTING" },
      });
      expect(mock.updatePatches).toEqual([]);
      expect(broadcastSpy).not.toHaveBeenCalled();
    }
  );
});
```

- [ ] **Step 7.2: Run tests — verify RED**

Run: `npx vitest run src/lib/rooms/updateNowPerforming.test.ts`
Expected: FAIL — current impl lets any state through.

- [ ] **Step 7.3: Add state guards (GREEN)**

In `src/lib/rooms/updateNowPerforming.ts`, between the `if (row.owner_user_id !== userId) { ... }` block and the UPDATE call, insert:

```ts
  if (!row.allow_now_performing) {
    return fail(
      "NOW_PERFORMING_DISABLED",
      "This room did not enable the 'now performing' feature.",
      409
    );
  }

  if (row.status !== "voting") {
    return fail(
      "ROOM_NOT_VOTING",
      "The now-performing pointer can only be set while the room is voting.",
      409
    );
  }
```

- [ ] **Step 7.4: Run tests — verify GREEN**

Run: `npx vitest run src/lib/rooms/updateNowPerforming.test.ts`
Expected: PASS.

- [ ] **Step 7.5: Commit**

```bash
git add src/lib/rooms/updateNowPerforming.ts src/lib/rooms/updateNowPerforming.test.ts
git commit -m "updateNowPerforming: guard allow_now_performing and status=voting"
```

---

## Task 8: Broadcast semantics + UPDATE error

**Files:**
- Modify: `src/lib/rooms/updateNowPerforming.ts`
- Modify: `src/lib/rooms/updateNowPerforming.test.ts`

- [ ] **Step 8.1: Append broadcast + DB-error tests (RED)**

Append to `src/lib/rooms/updateNowPerforming.test.ts`:

```ts
describe("updateRoomNowPerforming — broadcast semantics", () => {
  it("does NOT roll back or 500 when the broadcast throws; logs a warning", async () => {
    const mock = makeSupabaseMock();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broadcastSpy = vi
      .fn()
      .mockRejectedValue(new Error("realtime channel disconnected"));
    const result = await updateRoomNowPerforming(
      {
        roomId: VALID_ROOM_ID,
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result).toMatchObject({
      ok: true,
      room: { nowPerformingId: VALID_CONTESTANT_ID },
    });
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

describe("updateRoomNowPerforming — UPDATE error", () => {
  it("returns 500 INTERNAL_ERROR when the UPDATE fails; does NOT broadcast", async () => {
    const mock = makeSupabaseMock({
      roomUpdateResult: { data: null, error: { message: "write failed" } },
    });
    const broadcastSpy = vi.fn();
    const result = await updateRoomNowPerforming(
      {
        roomId: VALID_ROOM_ID,
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      },
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

- [ ] **Step 8.2: Run tests — verify RED**

Run: `npx vitest run src/lib/rooms/updateNowPerforming.test.ts`
Expected: both new tests fail.

- [ ] **Step 8.3: Guard UPDATE error + wrap broadcast (GREEN)**

In `src/lib/rooms/updateNowPerforming.ts`, replace the UPDATE + broadcast + return block at the end of `updateRoomNowPerforming` with:

```ts
  const updateResult = await deps.supabase
    .from("rooms")
    .update({ now_performing_id: contestantId })
    .eq("id", roomId)
    .select()
    .single();

  if (updateResult.error || !updateResult.data) {
    return fail("INTERNAL_ERROR", "Could not update room. Please try again.", 500);
  }

  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "now_performing",
      contestantId,
    });
  } catch (err) {
    console.warn(
      `broadcast 'now_performing' failed for room ${roomId}; state committed regardless:`,
      err
    );
  }

  return { ok: true, room: mapRoom(updateResult.data as RoomRow) };
}
```

- [ ] **Step 8.4: Run tests — verify GREEN**

Run: `npx vitest run src/lib/rooms/updateNowPerforming.test.ts`
Expected: PASS.

- [ ] **Step 8.5: Commit**

```bash
git add src/lib/rooms/updateNowPerforming.ts src/lib/rooms/updateNowPerforming.test.ts
git commit -m "updateNowPerforming: UPDATE-error 500, broadcast-failure non-fatal with warn"
```

---

## Task 9: Route adapter

**Files:**
- Modify: `src/app/api/rooms/[id]/now-performing/route.ts`
- Create: `src/app/api/rooms/[id]/now-performing/route.test.ts`

- [ ] **Step 9.1: Write the route-adapter tests (RED)**

Create `src/app/api/rooms/[id]/now-performing/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const VALID_CONTESTANT_ID = "2026-ua";

let roomSelectResult: { data: unknown; error: { message: string } | null } = {
  data: {
    id: VALID_ROOM_ID,
    status: "voting",
    owner_user_id: VALID_USER_ID,
    allow_now_performing: true,
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
  now_performing_id: VALID_CONTESTANT_ID,
  allow_now_performing: true,
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

import { PATCH } from "@/app/api/rooms/[id]/now-performing/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/rooms/${VALID_ROOM_ID}/now-performing`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("PATCH /api/rooms/[id]/now-performing (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roomSelectResult = {
      data: {
        id: VALID_ROOM_ID,
        status: "voting",
        owner_user_id: VALID_USER_ID,
        allow_now_performing: true,
      },
      error: null,
    };
  });

  it("returns 200 with { room } on happy path", async () => {
    const res = await PATCH(
      makeRequest({
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      room: { id: string; nowPerformingId: string };
    };
    expect(body.room).toMatchObject({
      id: VALID_ROOM_ID,
      nowPerformingId: VALID_CONTESTANT_ID,
    });
  });

  it("returns 400 INVALID_BODY on non-JSON body", async () => {
    const req = new NextRequest(
      `http://localhost/api/rooms/${VALID_ROOM_ID}/now-performing`,
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
      makeRequest({
        contestantId: VALID_CONTESTANT_ID,
        userId: "cccccccc-dddd-4eee-8fff-000000000000",
      }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 404 ROOM_NOT_FOUND on unknown room", async () => {
    roomSelectResult = { data: null, error: null };
    const res = await PATCH(
      makeRequest({
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("returns 409 ROOM_NOT_VOTING when room status is lobby", async () => {
    roomSelectResult = {
      data: {
        id: VALID_ROOM_ID,
        status: "lobby",
        owner_user_id: VALID_USER_ID,
        allow_now_performing: true,
      },
      error: null,
    };
    const res = await PATCH(
      makeRequest({
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_VOTING");
  });
});
```

- [ ] **Step 9.2: Run tests — verify RED**

Run: `npx vitest run src/app/api/rooms/[id]/now-performing/route.test.ts`
Expected: FAIL — route currently returns 501.

- [ ] **Step 9.3: Wire the route (GREEN)**

Replace the entire contents of `src/app/api/rooms/[id]/now-performing/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { updateRoomNowPerforming } from "@/lib/rooms/updateNowPerforming";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * PATCH /api/rooms/{id}/now-performing
 * Body: { contestantId: string, userId: string }
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

  const input = body as { contestantId?: unknown; userId?: unknown };
  const result = await updateRoomNowPerforming(
    {
      roomId: params.id,
      contestantId: input.contestantId,
      userId: input.userId,
    },
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

- [ ] **Step 9.4: Run tests — verify GREEN**

Run: `npx vitest run src/app/api/rooms/[id]/now-performing/route.test.ts`
Expected: PASS (5/5).

- [ ] **Step 9.5: Commit**

```bash
git add src/app/api/rooms/[id]/now-performing/route.ts src/app/api/rooms/[id]/now-performing/route.test.ts
git commit -m "updateNowPerforming: wire PATCH /api/rooms/[id]/now-performing route adapter"
```

---

## Task 10: Full verification + push + PR

**Files:**
- Modify: `TODO.md` (gitignored — local tick only)

- [ ] **Step 10.1: Run the full pre-push gate**

Run: `npm run pre-push`
Expected: `tsc --noEmit` clean; full vitest suite passes. Test count expected growth ≈ +25 vs. main baseline of 281.

- [ ] **Step 10.2: Tick Phase 2 item in `TODO.md`**

Edit `TODO.md` — find the Phase 2 line `- [ ] PATCH /api/rooms/{id}/now-performing` and change `[ ]` to `[x]`. `TODO.md` is gitignored — no commit needed.

- [ ] **Step 10.3: Push the branch**

Run: `git push -u origin feat/now-performing`
Expected: push succeeds.

- [ ] **Step 10.4: Open the PR**

Run:

```bash
gh pr create --base main \
  --title "Add PATCH /api/rooms/{id}/now-performing + extract shared helpers" \
  --body "$(cat <<'EOF'
## Summary
- Pure `updateRoomNowPerforming()` lib under `src/lib/rooms/updateNowPerforming.ts` with DI over supabase and `broadcastRoomEvent`. Validates inputs (UUID roomId, non-empty userId, 1–20 char contestantId), loads room, enforces admin ownership (403), checks `allow_now_performing` (409 `NOW_PERFORMING_DISABLED`) and `status === 'voting'` (409 `ROOM_NOT_VOTING`), UPDATEs `now_performing_id`, then broadcasts `{ type: 'now_performing', contestantId }` on `room:{roomId}`.
- Broadcast failure is non-fatal (warn + 200).
- Thin route adapter at `src/app/api/rooms/[id]/now-performing/route.ts` using the shared `defaultBroadcastRoomEvent`.

### Shared helpers extracted
- New `src/lib/rooms/shared.ts` hosting:
  - `mapRoom(row)` — previously duplicated in `create.ts`, `get.ts`, `updateStatus.ts`.
  - `RoomEventPayload` — discriminated union, now covers `status_changed` and `now_performing`.
  - `defaultBroadcastRoomEvent(roomId, event)` — previously inlined in `status/route.ts`.
- Three lib files + one route adapter migrated to import from `shared.ts`.
- Zero behavioural change for existing endpoints; all pre-existing tests remain green.

### New error codes
- `INVALID_CONTESTANT_ID`
- `NOW_PERFORMING_DISABLED`
- `ROOM_NOT_VOTING`

Follows the approved design + plan:
- [design](docs/superpowers/specs/2026-04-19-now-performing-design.md)
- [plan](docs/superpowers/plans/2026-04-19-now-performing.md)

Closes the fifth item of Phase 2 in TODO.md.

## Test plan
- [x] `npm run type-check`
- [x] `npm test` (all green)
- [ ] Manual smoke once the admin "now performing" panel consumes this

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 10.5: Done**

Report the PR URL and await merge.

---

## Out of scope

- Validating `contestantId` against the room's actual contestant list (requires `fetchContestants` dependency).
- Clearing `now_performing_id` by sending null — SPEC §6.5 doesn't require it.
- Extracting an `assertRoomAdmin` helper — admin check remains inline.
- i18n of error messages (Phase 1.5 T9 will cover the three new codes).
- UI consumption (admin control panel, non-admin snap/indicator logic) — Phase 2 UI tasks.

---

## Self-review

**Spec coverage**
- Contract (§Contract) — Task 4 (200 shape) + Task 9 (route adapter 200/400/403/404/409).
- Relaxed contestantId validation (§Relaxed `contestantId` validation) — Task 5.
- Rejection ordering (§Rejection ordering) — Task 5 (400s) → Task 6 (404/403) → Task 7 (409s) → Task 8 (UPDATE+broadcast).
- Two distinct 409 codes (§Two distinct state-rejection codes) — Task 7.
- Broadcast non-fatal semantics (§Broadcast) — Task 8.
- Shared helpers extraction (§Refactor) — Tasks 2 + 3.
- New error codes (§Additions) — Task 1.
- Regression guarantee (§Regression guarantee) — Task 3 Step 3.7 runs the full suite as the gate.
- Test plan (§Test plan) — covered across Tasks 2, 4–9.

**Placeholder scan:** none. Every step carries concrete code blocks or concrete commands with expected output.

**Type consistency:**
- `UpdateNowPerformingInput` / `Deps` / `Result` / `Success` / `Failure` — defined in Task 1, reused verbatim in Tasks 4–8.
- `fail()`, `UUID_REGEX`, `CONTESTANT_ID_MAX_LEN`, `RoomRow` — introduced in Tasks 5/6 and referenced consistently.
- `RoomEventPayload` — defined in Task 2, imported (same name) in Tasks 1/4 via `@/lib/rooms/shared`, eventually imported the same way in migrated consumers (Task 3).
- `mapRoom` — defined in Task 2, imported in Tasks 3 (existing callers) and 4/6/8 (new caller).
- `defaultBroadcastRoomEvent` — defined in Task 2, referenced by status route (Task 3) and now-performing route (Task 9).

**Scope:** one new endpoint + bundled ≤40-line refactor. Still single-plan territory.
