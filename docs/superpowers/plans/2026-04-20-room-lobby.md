# /room/[id] lobby + POST /{id}/join + user_joined broadcasts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `/room/[id]` stub to a functional lobby (PIN, live participant list, admin "Start voting"), wire the pending `POST /api/rooms/{id}/join` endpoint, and add a `user_joined` broadcast to both join endpoints so the lobby updates live. Per `docs/superpowers/specs/2026-04-20-room-lobby-design.md`.

**Architecture:** New backend lib `joinRoomByMembership(input, deps)` mirroring `joinByPin` minus PIN resolution. Existing `joinByPin` extended to broadcast `user_joined`. `RoomEventPayload` union gains the new variant. Client side: three fetch-helper functions + error-mapping helper + two presentational components (`LobbyView`, `StatusStub`) composed by the `/room/[id]` orchestrator page.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase, Vitest. No new deps.

---

## File structure

| Path | Kind | Responsibility |
|---|---|---|
| `src/lib/rooms/shared.ts` | modify | Add `user_joined` variant to `RoomEventPayload` |
| `src/lib/rooms/joinRoom.ts` | **new** | `joinRoomByMembership` — pure handler: validate → lookup → status guard → upsert → SELECT user → broadcast |
| `src/lib/rooms/joinRoom.test.ts` | **new** | Unit tests |
| `src/app/api/rooms/[id]/join/route.ts` | modify | Wire POST adapter using `joinRoomByMembership` + `defaultBroadcastRoomEvent` |
| `src/app/api/rooms/[id]/join/route.test.ts` | **new** | Adapter tests (200/400/404/409) |
| `src/lib/rooms/joinByPin.ts` | modify | Add `broadcastRoomEvent` dep + fire `user_joined` after upsert |
| `src/lib/rooms/joinByPin.test.ts` | modify | Assert broadcast calls (happy path + idempotency) |
| `src/app/api/rooms/join-by-pin/route.ts` | modify | Inject `defaultBroadcastRoomEvent` |
| `src/lib/room/api.ts` | **new** | `fetchRoomData`, `joinRoomApi`, `patchRoomStatus` — client fetch wrappers |
| `src/lib/room/api.test.ts` | **new** | Mocked-fetch tests for each helper |
| `src/lib/room/errors.ts` | **new** | `mapRoomError(code)` table |
| `src/lib/room/errors.test.ts` | **new** | Table test |
| `src/components/room/StatusStub.tsx` | **new** | Presentational placeholder for non-lobby statuses |
| `src/components/room/LobbyView.tsx` | **new** | Presentational lobby (PIN + participants + admin CTA) |
| `src/app/room/[id]/page.tsx` | modify | Orchestrator: fetch → auto-join → realtime subscribe → render branch |

---

## Task 1: Extend `RoomEventPayload` + bootstrap `joinRoom` stub

**Files:**
- Modify: `src/lib/rooms/shared.ts`
- Create: `src/lib/rooms/joinRoom.ts`

- [ ] **Step 1.1: Extend `RoomEventPayload` union**

In `src/lib/rooms/shared.ts`, replace the current `RoomEventPayload` export with:

```ts
export type RoomEventPayload =
  | { type: "status_changed"; status: string }
  | { type: "now_performing"; contestantId: string }
  | {
      type: "user_joined";
      user: { id: string; displayName: string; avatarSeed: string };
    };
```

- [ ] **Step 1.2: Create the lib stub**

Create `src/lib/rooms/joinRoom.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface JoinRoomInput {
  roomId: unknown;
  userId: unknown;
}

export interface JoinRoomDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
}

export interface JoinRoomSuccess {
  ok: true;
}

export interface JoinRoomFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type JoinRoomResult = JoinRoomSuccess | JoinRoomFailure;

export async function joinRoomByMembership(
  _input: JoinRoomInput,
  _deps: JoinRoomDeps
): Promise<JoinRoomResult> {
  throw new Error("not implemented");
}
```

- [ ] **Step 1.3: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 1.4: Commit**

```bash
git add src/lib/rooms/shared.ts src/lib/rooms/joinRoom.ts
git commit -m "Extend RoomEventPayload with user_joined + stub joinRoomByMembership"
```

---

## Task 2: `joinRoomByMembership` — happy path

**Files:**
- Create: `src/lib/rooms/joinRoom.test.ts`
- Modify: `src/lib/rooms/joinRoom.ts`

- [ ] **Step 2.1: Write the happy-path test (RED)**

Create `src/lib/rooms/joinRoom.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  joinRoomByMembership,
  type JoinRoomDeps,
} from "@/lib/rooms/joinRoom";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const defaultRoomRow = { id: VALID_ROOM_ID, status: "lobby" };
const defaultUserRow = {
  display_name: "Alice",
  avatar_seed: "seed-abc",
};

interface MockOptions {
  roomSelectResult?: { data: unknown; error: { message: string } | null };
  upsertResult?: { error: { message: string } | null };
  userSelectResult?: { data: unknown; error: { message: string } | null };
}

function makeSupabaseMock(opts: MockOptions = {}) {
  const roomSelectResult =
    opts.roomSelectResult ?? { data: defaultRoomRow, error: null };
  const upsertResult = opts.upsertResult ?? { error: null };
  const userSelectResult =
    opts.userSelectResult ?? { data: defaultUserRow, error: null };

  const roomEqArgs: Array<{ col: string; val: unknown }> = [];
  const upsertRows: Array<Record<string, unknown>> = [];
  const upsertOptions: Array<Record<string, unknown>> = [];
  const userEqArgs: Array<{ col: string; val: unknown }> = [];

  const from = vi.fn((table: string) => {
    if (table === "rooms") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((col: string, val: unknown) => {
            roomEqArgs.push({ col, val });
            return {
              maybeSingle: vi.fn().mockResolvedValue(roomSelectResult),
            };
          }),
        })),
      };
    }
    if (table === "room_memberships") {
      return {
        upsert: vi.fn(
          (row: Record<string, unknown>, options: Record<string, unknown>) => {
            upsertRows.push(row);
            upsertOptions.push(options);
            return Promise.resolve(upsertResult);
          }
        ),
      };
    }
    if (table === "users") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((col: string, val: unknown) => {
            userEqArgs.push({ col, val });
            return {
              maybeSingle: vi.fn().mockResolvedValue(userSelectResult),
            };
          }),
        })),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as JoinRoomDeps["supabase"],
    roomEqArgs,
    upsertRows,
    upsertOptions,
    userEqArgs,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<JoinRoomDeps> = {}
): JoinRoomDeps {
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("joinRoomByMembership — happy path", () => {
  it("upserts membership, reads user, broadcasts user_joined, returns { ok: true }", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn().mockResolvedValue(undefined);
    const result = await joinRoomByMembership(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result).toEqual({ ok: true });
    expect(mock.upsertRows).toEqual([
      { room_id: VALID_ROOM_ID, user_id: VALID_USER_ID },
    ]);
    expect(mock.upsertOptions[0]).toMatchObject({
      onConflict: "room_id,user_id",
      ignoreDuplicates: true,
    });
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "user_joined",
      user: {
        id: VALID_USER_ID,
        displayName: "Alice",
        avatarSeed: "seed-abc",
      },
    });
  });
});
```

- [ ] **Step 2.2: Run test — verify RED**

Run: `npx vitest run src/lib/rooms/joinRoom.test.ts`
Expected: FAIL — `Error: not implemented`.

- [ ] **Step 2.3: Write minimal impl (GREEN)**

Replace the body of `src/lib/rooms/joinRoom.ts` with:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface JoinRoomInput {
  roomId: unknown;
  userId: unknown;
}

export interface JoinRoomDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
}

export interface JoinRoomSuccess {
  ok: true;
}

export interface JoinRoomFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type JoinRoomResult = JoinRoomSuccess | JoinRoomFailure;

export async function joinRoomByMembership(
  input: JoinRoomInput,
  deps: JoinRoomDeps
): Promise<JoinRoomResult> {
  const roomId = input.roomId as string;
  const userId = input.userId as string;

  await deps.supabase
    .from("room_memberships")
    .upsert(
      { room_id: roomId, user_id: userId },
      { onConflict: "room_id,user_id", ignoreDuplicates: true }
    );

  const { data: userRow } = await deps.supabase
    .from("users")
    .select("display_name, avatar_seed")
    .eq("id", userId)
    .maybeSingle();

  const u = userRow as { display_name: string; avatar_seed: string };
  await deps.broadcastRoomEvent(roomId, {
    type: "user_joined",
    user: { id: userId, displayName: u.display_name, avatarSeed: u.avatar_seed },
  });

  return { ok: true };
}
```

- [ ] **Step 2.4: Run test — verify GREEN**

Run: `npx vitest run src/lib/rooms/joinRoom.test.ts`
Expected: PASS (1/1).

- [ ] **Step 2.5: Commit**

```bash
git add src/lib/rooms/joinRoom.ts src/lib/rooms/joinRoom.test.ts
git commit -m "joinRoomByMembership: happy path (upsert + user SELECT + user_joined broadcast)"
```

---

## Task 3: Input validation + lookup + status guard + DB/broadcast error handling

**Files:**
- Modify: `src/lib/rooms/joinRoom.ts`
- Modify: `src/lib/rooms/joinRoom.test.ts`

This task bundles four concerns that all share the same error-path discipline established in prior endpoints (joinByPin, updateStatus, updateNowPerforming): input validation, not-found, status-guard, and broadcast-non-fatal + DB-error.

- [ ] **Step 3.1: Append all remaining tests (RED)**

Append to `src/lib/rooms/joinRoom.test.ts`:

```ts
describe("joinRoomByMembership — input validation", () => {
  it("rejects non-UUID roomId with INVALID_ROOM_ID", async () => {
    const mock = makeSupabaseMock();
    const broadcastSpy = vi.fn();
    const result = await joinRoomByMembership(
      { roomId: "not-a-uuid", userId: VALID_USER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
    expect(mock.upsertRows).toEqual([]);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 42, ""])(
    "rejects missing/empty/non-string userId (%s) with INVALID_USER_ID",
    async (userId) => {
      const mock = makeSupabaseMock();
      const result = await joinRoomByMembership(
        { roomId: VALID_ROOM_ID, userId },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_USER_ID", field: "userId" },
      });
      expect(mock.upsertRows).toEqual([]);
    }
  );
});

describe("joinRoomByMembership — room not found", () => {
  it("returns 404 ROOM_NOT_FOUND when room SELECT returns null", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: null },
    });
    const broadcastSpy = vi.fn();
    const result = await joinRoomByMembership(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
    expect(mock.upsertRows).toEqual([]);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it("returns 404 ROOM_NOT_FOUND when room SELECT errors", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: { message: "boom" } },
    });
    const result = await joinRoomByMembership(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "ROOM_NOT_FOUND" } });
  });
});

describe("joinRoomByMembership — status guard", () => {
  it.each(["scoring", "announcing", "done"] as const)(
    "rejects status=%s with 409 ROOM_NOT_JOINABLE",
    async (status) => {
      const mock = makeSupabaseMock({
        roomSelectResult: {
          data: { id: VALID_ROOM_ID, status },
          error: null,
        },
      });
      const broadcastSpy = vi.fn();
      const result = await joinRoomByMembership(
        { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
        makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
      );
      expect(result).toMatchObject({
        ok: false,
        status: 409,
        error: { code: "ROOM_NOT_JOINABLE" },
      });
      expect(mock.upsertRows).toEqual([]);
      expect(broadcastSpy).not.toHaveBeenCalled();
    }
  );

  it.each(["lobby", "voting"] as const)(
    "accepts status=%s and upserts membership",
    async (status) => {
      const mock = makeSupabaseMock({
        roomSelectResult: {
          data: { id: VALID_ROOM_ID, status },
          error: null,
        },
      });
      const result = await joinRoomByMembership(
        { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
        makeDeps(mock)
      );
      expect(result).toEqual({ ok: true });
    }
  );
});

describe("joinRoomByMembership — DB errors", () => {
  it("returns 500 INTERNAL_ERROR when upsert fails", async () => {
    const mock = makeSupabaseMock({
      upsertResult: { error: { message: "fk violation" } },
    });
    const broadcastSpy = vi.fn();
    const result = await joinRoomByMembership(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it("returns 500 INTERNAL_ERROR when user SELECT returns null", async () => {
    const mock = makeSupabaseMock({
      userSelectResult: { data: null, error: null },
    });
    const broadcastSpy = vi.fn();
    const result = await joinRoomByMembership(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
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

describe("joinRoomByMembership — broadcast semantics", () => {
  it("does NOT 500 when the broadcast throws; logs a warning", async () => {
    const mock = makeSupabaseMock();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broadcastSpy = vi
      .fn()
      .mockRejectedValue(new Error("realtime channel disconnected"));
    const result = await joinRoomByMembership(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      makeDeps(mock, { broadcastRoomEvent: broadcastSpy })
    );
    expect(result).toEqual({ ok: true });
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 3.2: Run tests — verify RED**

Run: `npx vitest run src/lib/rooms/joinRoom.test.ts`
Expected: multiple failures — the minimal impl doesn't validate, look up room, guard status, or handle errors.

- [ ] **Step 3.3: Implement full body (GREEN)**

Replace the full body of `src/lib/rooms/joinRoom.ts` with:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface JoinRoomInput {
  roomId: unknown;
  userId: unknown;
}

export interface JoinRoomDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
}

export interface JoinRoomSuccess {
  ok: true;
}

export interface JoinRoomFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type JoinRoomResult = JoinRoomSuccess | JoinRoomFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UNJOINABLE_STATUSES: ReadonlySet<string> = new Set([
  "scoring",
  "announcing",
  "done",
]);

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): JoinRoomFailure {
  return { ok: false, error: field ? { code, message, field } : { code, message }, status };
}

export async function joinRoomByMembership(
  input: JoinRoomInput,
  deps: JoinRoomDeps
): Promise<JoinRoomResult> {
  if (typeof input.roomId !== "string" || !UUID_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID.", 400, "roomId");
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return fail("INVALID_USER_ID", "userId must be a non-empty string.", 400, "userId");
  }
  const roomId = input.roomId;
  const userId = input.userId;

  const roomQuery = await deps.supabase
    .from("rooms")
    .select("id, status")
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const row = roomQuery.data as { id: string; status: string };

  if (UNJOINABLE_STATUSES.has(row.status)) {
    return fail(
      "ROOM_NOT_JOINABLE",
      "This room is no longer accepting new members.",
      409
    );
  }

  const { error: upsertError } = await deps.supabase
    .from("room_memberships")
    .upsert(
      { room_id: roomId, user_id: userId },
      { onConflict: "room_id,user_id", ignoreDuplicates: true }
    );

  if (upsertError) {
    return fail("INTERNAL_ERROR", "Could not join room. Please try again.", 500);
  }

  const userQuery = await deps.supabase
    .from("users")
    .select("display_name, avatar_seed")
    .eq("id", userId)
    .maybeSingle();

  if (userQuery.error || !userQuery.data) {
    return fail("INTERNAL_ERROR", "Could not read user record.", 500);
  }
  const u = userQuery.data as { display_name: string; avatar_seed: string };

  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "user_joined",
      user: { id: userId, displayName: u.display_name, avatarSeed: u.avatar_seed },
    });
  } catch (err) {
    console.warn(
      `broadcast 'user_joined' failed for room ${roomId}; state committed regardless:`,
      err
    );
  }

  return { ok: true };
}
```

- [ ] **Step 3.4: Run tests — verify GREEN**

Run: `npx vitest run src/lib/rooms/joinRoom.test.ts`
Expected: PASS (all tests).

- [ ] **Step 3.5: Commit**

```bash
git add src/lib/rooms/joinRoom.ts src/lib/rooms/joinRoom.test.ts
git commit -m "joinRoomByMembership: validation + lookup + status guard + DB/broadcast errors"
```

---

## Task 4: Wire `POST /api/rooms/{id}/join` route adapter

**Files:**
- Modify: `src/app/api/rooms/[id]/join/route.ts`
- Create: `src/app/api/rooms/[id]/join/route.test.ts`

- [ ] **Step 4.1: Write the route-adapter tests (RED)**

Create `src/app/api/rooms/[id]/join/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

let roomSelectResult: { data: unknown; error: { message: string } | null } = {
  data: { id: VALID_ROOM_ID, status: "lobby" },
  error: null,
};

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: vi.fn((table: string) => {
      if (table === "rooms") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue(roomSelectResult),
            })),
          })),
        };
      }
      if (table === "room_memberships") {
        return { upsert: vi.fn().mockResolvedValue({ error: null }) };
      }
      if (table === "users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { display_name: "Alice", avatar_seed: "seed-abc" },
                error: null,
              }),
            })),
          })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
    channel: vi.fn(() => ({
      send: vi.fn().mockResolvedValue(undefined),
    })),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { POST } from "@/app/api/rooms/[id]/join/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/rooms/${VALID_ROOM_ID}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/rooms/[id]/join (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roomSelectResult = {
      data: { id: VALID_ROOM_ID, status: "lobby" },
      error: null,
    };
  });

  it("returns 200 { joined: true } on happy path", async () => {
    const res = await POST(
      makeRequest({ userId: VALID_USER_ID }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { joined: boolean };
    expect(body).toEqual({ joined: true });
  });

  it("returns 400 INVALID_BODY on non-JSON body", async () => {
    const req = new NextRequest(
      `http://localhost/api/rooms/${VALID_ROOM_ID}/join`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json{{{",
      }
    );
    const res = await POST(req, { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 400 INVALID_USER_ID when userId is missing", async () => {
    const res = await POST(
      makeRequest({}),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_USER_ID");
  });

  it("returns 404 ROOM_NOT_FOUND when the room does not exist", async () => {
    roomSelectResult = { data: null, error: null };
    const res = await POST(
      makeRequest({ userId: VALID_USER_ID }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("returns 409 ROOM_NOT_JOINABLE on announcing", async () => {
    roomSelectResult = {
      data: { id: VALID_ROOM_ID, status: "announcing" },
      error: null,
    };
    const res = await POST(
      makeRequest({ userId: VALID_USER_ID }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_JOINABLE");
  });
});
```

- [ ] **Step 4.2: Run tests — verify RED**

Run: `npx vitest run src/app/api/rooms/[id]/join/route.test.ts`
Expected: FAIL — route currently returns 501.

- [ ] **Step 4.3: Wire the route (GREEN)**

Replace the full contents of `src/app/api/rooms/[id]/join/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { joinRoomByMembership } from "@/lib/rooms/joinRoom";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/rooms/{id}/join
 * Body: { userId: string }
 * Returns 200 { joined: true } on success.
 */
export async function POST(
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

  const input = body as { userId?: unknown };
  const result = await joinRoomByMembership(
    { roomId: params.id, userId: input.userId },
    {
      supabase: createServiceClient(),
      broadcastRoomEvent: defaultBroadcastRoomEvent,
    }
  );

  if (result.ok) {
    return NextResponse.json({ joined: true }, { status: 200 });
  }
  return apiError(result.error.code, result.error.message, result.status, result.error.field);
}
```

- [ ] **Step 4.4: Run tests — verify GREEN**

Run: `npx vitest run src/app/api/rooms/[id]/join/route.test.ts`
Expected: PASS (5/5).

- [ ] **Step 4.5: Commit**

```bash
git add src/app/api/rooms/[id]/join/route.ts src/app/api/rooms/[id]/join/route.test.ts
git commit -m "Wire POST /api/rooms/[id]/join route adapter"
```

---

## Task 5: Extend `joinByPin` with `user_joined` broadcast

**Files:**
- Modify: `src/lib/rooms/joinByPin.ts`
- Modify: `src/lib/rooms/joinByPin.test.ts`
- Modify: `src/app/api/rooms/join-by-pin/route.ts`

- [ ] **Step 5.1: Extend `JoinByPinDeps` + add broadcast to lib**

In `src/lib/rooms/joinByPin.ts`:

1. Add import at the top:
   ```ts
   import type { RoomEventPayload } from "@/lib/rooms/shared";
   ```
2. Replace the `JoinByPinDeps` interface with:
   ```ts
   export interface JoinByPinDeps {
     supabase: SupabaseClient<Database>;
     broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
   }
   ```
3. Replace the tail of the `joinByPin` function (from the membership upsert through the end) with:
   ```ts
     const { error: upsertError } = await deps.supabase
       .from("room_memberships")
       .upsert(
         { room_id: row.id, user_id: userId },
         { onConflict: "room_id,user_id", ignoreDuplicates: true }
       );

     if (upsertError) {
       return fail("INTERNAL_ERROR", "Could not join room. Please try again.", 500);
     }

     const userQuery = await deps.supabase
       .from("users")
       .select("display_name, avatar_seed")
       .eq("id", userId)
       .maybeSingle();

     if (userQuery.error || !userQuery.data) {
       return fail("INTERNAL_ERROR", "Could not read user record.", 500);
     }
     const u = userQuery.data as { display_name: string; avatar_seed: string };

     try {
       await deps.broadcastRoomEvent(row.id, {
         type: "user_joined",
         user: {
           id: userId,
           displayName: u.display_name,
           avatarSeed: u.avatar_seed,
         },
       });
     } catch (err) {
       console.warn(
         `broadcast 'user_joined' failed for room ${row.id}; state committed regardless:`,
         err
       );
     }

     return { ok: true, roomId: row.id };
   }
   ```

- [ ] **Step 5.2: Update existing happy-path test + idempotency test**

In `src/lib/rooms/joinByPin.test.ts`:

1. Extend the `MockOptions` interface in the mock helper (add `userSelectResult`) and extend the `from()` mock to handle `"users"` similar to Task 2's mock. Specifically, replace the `makeSupabaseMock` block's `from = vi.fn(...)` with:

   ```ts
     const from = vi.fn((table: string) => {
       if (table === "rooms") {
         return {
           select: vi.fn(() => ({
             eq: vi.fn((col: string, val: unknown) => {
               roomEqArgs.push({ col, val });
               return { maybeSingle: roomMaybeSingleSpy };
             }),
           })),
         };
       }
       if (table === "room_memberships") {
         return { upsert: membershipUpsertSpy };
       }
       if (table === "users") {
         return {
           select: vi.fn(() => ({
             eq: vi.fn(() => ({
               maybeSingle: vi
                 .fn()
                 .mockResolvedValue(
                   opts.userSelectResult ?? {
                     data: { display_name: "Alice", avatar_seed: "seed-abc" },
                     error: null,
                   }
                 ),
             })),
           })),
         };
       }
       throw new Error(`unexpected table: ${table}`);
     });
   ```

2. Extend `MockOptions`:

   ```ts
   interface MockOptions {
     roomSelectResult?: { data: unknown; error: { message: string } | null };
     membershipUpsertResult?: { error: { message: string } | null };
     userSelectResult?: { data: unknown; error: { message: string } | null };
   }
   ```

3. Update `makeDeps` to include `broadcastRoomEvent`:

   ```ts
   function makeDeps(mock: ReturnType<typeof makeSupabaseMock>): JoinByPinDeps {
     return {
       supabase: mock.supabase,
       broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
     };
   }
   ```

4. The existing happy path test should still pass. Add a new assertion just after the `expect(result).toEqual({ ok: true, roomId: VALID_ROOM_ID });` line in the happy-path test:

   ```ts
   const deps = makeDeps(mock);
   // ... existing `await joinByPin(...)` invocation, but pass the same deps reference
   // so we can inspect broadcastRoomEvent:
   expect(deps.broadcastRoomEvent).toHaveBeenCalledTimes(1);
   expect(deps.broadcastRoomEvent).toHaveBeenCalledWith(VALID_ROOM_ID, {
     type: "user_joined",
     user: { id: VALID_USER_ID, displayName: "Alice", avatarSeed: "seed-abc" },
   });
   ```

   Note: this requires restructuring the happy-path test to capture `deps` in a variable (instead of inlining `makeDeps(mock)` into the call). Make that refactor.

5. The idempotency test already calls `joinByPin` twice. After the existing assertions, add:

   ```ts
   // Each successful upsert fires a broadcast — total of two for the two calls.
   expect(firstDeps.broadcastRoomEvent).toHaveBeenCalledTimes(1);
   expect(secondDeps.broadcastRoomEvent).toHaveBeenCalledTimes(1);
   ```

   (Again, capture `deps` per call in variables to assert on.)

- [ ] **Step 5.3: Run joinByPin tests — verify GREEN (updated pattern)**

Run: `npx vitest run src/lib/rooms/joinByPin.test.ts`
Expected: all joinByPin tests pass, including the new broadcast assertions.

If any other existing test fails because the `JoinByPinDeps` shape changed, update the test's `makeDeps` call to include `broadcastRoomEvent: vi.fn().mockResolvedValue(undefined)`.

- [ ] **Step 5.4: Update `/join-by-pin` route adapter to inject the broadcast**

Replace the full contents of `src/app/api/rooms/join-by-pin/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { joinByPin } from "@/lib/rooms/joinByPin";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/rooms/join-by-pin
 * Body: { pin: string, userId: string }
 * Returns 200 { roomId } on success.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_BODY", "Request body must be valid JSON.", 400);
  }
  if (typeof body !== "object" || body === null) {
    return apiError("INVALID_BODY", "Request body must be a JSON object.", 400);
  }

  const result = await joinByPin(body as Parameters<typeof joinByPin>[0], {
    supabase: createServiceClient(),
    broadcastRoomEvent: defaultBroadcastRoomEvent,
  });

  if (result.ok) {
    return NextResponse.json({ roomId: result.roomId }, { status: 200 });
  }
  return apiError(result.error.code, result.error.message, result.status, result.error.field);
}
```

- [ ] **Step 5.5: Update the existing join-by-pin route test**

In `src/app/api/rooms/join-by-pin/route.test.ts`, extend the `vi.mock("@/lib/supabase/server")` block's `from` to handle the `users` table AND add the `channel`/`removeChannel` stubs so the default broadcast doesn't blow up. Replace the mock body:

```ts
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: vi.fn((table: string) => {
      if (table === "rooms") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue(roomSelectResult),
            })),
          })),
        };
      }
      if (table === "room_memberships") {
        return { upsert: vi.fn().mockResolvedValue({ error: null }) };
      }
      if (table === "users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { display_name: "Alice", avatar_seed: "seed-abc" },
                error: null,
              }),
            })),
          })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
    channel: vi.fn(() => ({
      send: vi.fn().mockResolvedValue(undefined),
    })),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  }),
}));
```

- [ ] **Step 5.6: Run full joinByPin + route tests**

Run: `npx vitest run src/lib/rooms/joinByPin.test.ts src/app/api/rooms/join-by-pin/route.test.ts`
Expected: all green.

- [ ] **Step 5.7: Commit**

```bash
git add src/lib/rooms/joinByPin.ts src/lib/rooms/joinByPin.test.ts src/app/api/rooms/join-by-pin/route.ts src/app/api/rooms/join-by-pin/route.test.ts
git commit -m "joinByPin: broadcast user_joined after upsert (lib + route adapter)"
```

---

## Task 6: Client fetch helpers — `src/lib/room/api.ts`

**Files:**
- Create: `src/lib/room/api.ts`
- Create: `src/lib/room/api.test.ts`

Three helpers, same discriminated-union shape as `submitPinToApi`.

- [ ] **Step 6.1: Write the failing tests (RED)**

Create `src/lib/room/api.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  fetchRoomData,
  joinRoomApi,
  patchRoomStatus,
} from "@/lib/room/api";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("fetchRoomData", () => {
  it("GETs /api/rooms/{id} and returns { ok: true, data } on 200", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        room: { id: VALID_ROOM_ID, status: "lobby" },
        memberships: [],
        contestants: [],
      })
    ) as unknown as typeof globalThis.fetch;

    const result = await fetchRoomData(VALID_ROOM_ID, { fetch: fetchSpy });
    expect(result).toMatchObject({
      ok: true,
      data: {
        room: { id: VALID_ROOM_ID, status: "lobby" },
        memberships: [],
        contestants: [],
      },
    });
    const [url, init] = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`/api/rooms/${VALID_ROOM_ID}`);
    expect(init).toBeUndefined();
  });

  it("returns { ok: false, code } on 404", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(404, {
        error: { code: "ROOM_NOT_FOUND", message: "Room not found." },
      })
    ) as unknown as typeof globalThis.fetch;

    const result = await fetchRoomData(VALID_ROOM_ID, { fetch: fetchSpy });
    expect(result).toMatchObject({
      ok: false,
      code: "ROOM_NOT_FOUND",
    });
  });

  it("returns code NETWORK when fetch throws", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;
    const result = await fetchRoomData(VALID_ROOM_ID, { fetch: fetchSpy });
    expect(result).toMatchObject({ ok: false, code: "NETWORK" });
  });
});

describe("joinRoomApi", () => {
  it("POSTs /api/rooms/{id}/join with { userId }; returns { ok: true } on 200", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { joined: true })
    ) as unknown as typeof globalThis.fetch;

    const result = await joinRoomApi(VALID_ROOM_ID, VALID_USER_ID, {
      fetch: fetchSpy,
    });
    expect(result).toEqual({ ok: true });
    const [url, init] = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`/api/rooms/${VALID_ROOM_ID}/join`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ userId: VALID_USER_ID });
  });

  it("returns { ok: false, code } on 409 ROOM_NOT_JOINABLE", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(409, {
        error: { code: "ROOM_NOT_JOINABLE", message: "Not joinable" },
      })
    ) as unknown as typeof globalThis.fetch;
    const result = await joinRoomApi(VALID_ROOM_ID, VALID_USER_ID, {
      fetch: fetchSpy,
    });
    expect(result).toMatchObject({ ok: false, code: "ROOM_NOT_JOINABLE" });
  });
});

describe("patchRoomStatus", () => {
  it("PATCHes /api/rooms/{id}/status with { status, userId }; returns { ok: true } on 200", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { room: { id: VALID_ROOM_ID, status: "voting" } })
    ) as unknown as typeof globalThis.fetch;

    const result = await patchRoomStatus(
      VALID_ROOM_ID,
      "voting",
      VALID_USER_ID,
      { fetch: fetchSpy }
    );
    expect(result).toEqual({ ok: true });
    const [url, init] = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`/api/rooms/${VALID_ROOM_ID}/status`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      status: "voting",
      userId: VALID_USER_ID,
    });
  });

  it("returns { ok: false, code: FORBIDDEN } on 403", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(403, {
        error: { code: "FORBIDDEN", message: "Not the owner" },
      })
    ) as unknown as typeof globalThis.fetch;
    const result = await patchRoomStatus(VALID_ROOM_ID, "voting", VALID_USER_ID, {
      fetch: fetchSpy,
    });
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("returns { ok: false, code: INTERNAL_ERROR } on 500 with unparseable body", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    })) as unknown as typeof globalThis.fetch;
    const result = await patchRoomStatus(VALID_ROOM_ID, "voting", VALID_USER_ID, {
      fetch: fetchSpy,
    });
    expect(result).toMatchObject({ ok: false, code: "INTERNAL_ERROR" });
  });
});
```

- [ ] **Step 6.2: Run tests — verify RED**

Run: `npx vitest run src/lib/room/api.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 6.3: Implement (GREEN)**

Create `src/lib/room/api.ts`:

```ts
const GENERIC_MESSAGE = "Something went wrong. Please try again.";

interface ApiOk<T> {
  ok: true;
  data?: T;
}

interface ApiFail {
  ok: false;
  code: string;
  field?: string;
  message: string;
}

interface Deps {
  fetch: typeof globalThis.fetch;
}

async function unwrap<T>(res: Response, extract?: (body: unknown) => T): Promise<ApiOk<T> | ApiFail> {
  if (res.ok) {
    try {
      const body = await res.json();
      return extract
        ? { ok: true, data: extract(body) }
        : { ok: true };
    } catch {
      return { ok: false, code: "INTERNAL_ERROR", message: GENERIC_MESSAGE };
    }
  }
  try {
    const body = (await res.json()) as {
      error?: { code?: string; field?: string; message?: string };
    };
    const err = body.error ?? {};
    return {
      ok: false,
      code: err.code ?? "INTERNAL_ERROR",
      message: err.message ?? GENERIC_MESSAGE,
      ...(err.field ? { field: err.field } : {}),
    };
  } catch {
    return { ok: false, code: "INTERNAL_ERROR", message: GENERIC_MESSAGE };
  }
}

async function runRequest<T>(
  req: () => Promise<Response>,
  extract?: (body: unknown) => T
): Promise<ApiOk<T> | ApiFail> {
  let res: Response;
  try {
    res = await req();
  } catch {
    return { ok: false, code: "NETWORK", message: GENERIC_MESSAGE };
  }
  return unwrap(res, extract);
}

export type FetchRoomData = {
  room: unknown;
  memberships: unknown[];
  contestants: unknown[];
};

export async function fetchRoomData(
  roomId: string,
  deps: Deps
): Promise<ApiOk<FetchRoomData> | ApiFail> {
  return runRequest<FetchRoomData>(
    () => deps.fetch(`/api/rooms/${roomId}`),
    (body) => body as FetchRoomData
  );
}

export async function joinRoomApi(
  roomId: string,
  userId: string,
  deps: Deps
): Promise<ApiOk<never> | ApiFail> {
  return runRequest(() =>
    deps.fetch(`/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    })
  );
}

export async function patchRoomStatus(
  roomId: string,
  status: string,
  userId: string,
  deps: Deps
): Promise<ApiOk<never> | ApiFail> {
  return runRequest(() =>
    deps.fetch(`/api/rooms/${roomId}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, userId }),
    })
  );
}
```

- [ ] **Step 6.4: Run tests — verify GREEN**

Run: `npx vitest run src/lib/room/api.test.ts`
Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
git add src/lib/room/api.ts src/lib/room/api.test.ts
git commit -m "Add client fetch helpers: fetchRoomData, joinRoomApi, patchRoomStatus"
```

---

## Task 7: `mapRoomError` helper

**Files:**
- Create: `src/lib/room/errors.ts`
- Create: `src/lib/room/errors.test.ts`

- [ ] **Step 7.1: Write the failing test (RED)**

Create `src/lib/room/errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapRoomError } from "@/lib/room/errors";

describe("mapRoomError", () => {
  it.each([
    ["ROOM_NOT_FOUND", "This room doesn't exist or has been removed."],
    ["FORBIDDEN", "Only the host can do that."],
    ["INVALID_TRANSITION", "That action isn't available right now."],
    ["INVALID_USER_ID", "Your session is invalid. Please re-onboard."],
    ["ROOM_NOT_JOINABLE", "This room isn't accepting new members right now."],
    ["NETWORK", "We couldn't reach the server. Check your connection."],
  ])("maps %s to the expected message", (code, expected) => {
    expect(mapRoomError(code)).toBe(expected);
  });

  it("falls back for unknown codes", () => {
    expect(mapRoomError("SOMETHING_ELSE")).toBe(
      "Something went wrong. Please try again."
    );
  });

  it("falls back when code is undefined", () => {
    expect(mapRoomError(undefined)).toBe(
      "Something went wrong. Please try again."
    );
  });
});
```

- [ ] **Step 7.2: Run test — verify RED**

Run: `npx vitest run src/lib/room/errors.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 7.3: Implement (GREEN)**

Create `src/lib/room/errors.ts`:

```ts
const MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: "This room doesn't exist or has been removed.",
  FORBIDDEN: "Only the host can do that.",
  INVALID_TRANSITION: "That action isn't available right now.",
  INVALID_USER_ID: "Your session is invalid. Please re-onboard.",
  ROOM_NOT_JOINABLE: "This room isn't accepting new members right now.",
  NETWORK: "We couldn't reach the server. Check your connection.",
};

const GENERIC = "Something went wrong. Please try again.";

export function mapRoomError(code: string | undefined): string {
  if (!code) return GENERIC;
  return MESSAGES[code] ?? GENERIC;
}
```

- [ ] **Step 7.4: Run test — verify GREEN**

Run: `npx vitest run src/lib/room/errors.test.ts`
Expected: PASS (8/8).

- [ ] **Step 7.5: Commit**

```bash
git add src/lib/room/errors.ts src/lib/room/errors.test.ts
git commit -m "Add mapRoomError helper"
```

---

## Task 8: `StatusStub` + `LobbyView` presentational components

**Files:**
- Create: `src/components/room/StatusStub.tsx`
- Create: `src/components/room/LobbyView.tsx`

No automated tests (consistent with `/join` page — component wiring covered by manual smoke; RTL + jsdom out-of-scope).

- [ ] **Step 8.1: Create `StatusStub`**

Create `src/components/room/StatusStub.tsx`:

```tsx
"use client";

type Status = "voting" | "scoring" | "announcing" | "done";

const LABELS: Record<Status, string> = {
  voting: "Voting in progress",
  scoring: "Tallying results",
  announcing: "Announcement in progress",
  done: "Show's over",
};

interface StatusStubProps {
  status: string;
}

export default function StatusStub({ status }: StatusStubProps) {
  const label = LABELS[status as Status] ?? "Room active";
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="max-w-md w-full space-y-4 text-center animate-fade-in">
        <h1 className="text-2xl font-bold tracking-tight">{label}</h1>
        <p className="text-muted-foreground text-sm">
          This part of the room isn't built yet — coming soon.
        </p>
        <p className="text-muted-foreground text-xs font-mono">
          Status: {status}
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 8.2: Create `LobbyView`**

Create `src/components/room/LobbyView.tsx`:

```tsx
"use client";

import Avatar from "@/components/ui/Avatar";
import Button from "@/components/ui/Button";

export interface LobbyMember {
  userId: string;
  displayName: string;
  avatarSeed: string;
}

export type StartVotingState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

interface LobbyViewProps {
  pin: string;
  ownerUserId: string;
  memberships: LobbyMember[];
  isAdmin: boolean;
  startVotingState: StartVotingState;
  onStartVoting: () => void;
  onCopyPin: () => void;
}

export default function LobbyView({
  pin,
  ownerUserId,
  memberships,
  isAdmin,
  startVotingState,
  onStartVoting,
  onCopyPin,
}: LobbyViewProps) {
  return (
    <main className="flex min-h-screen flex-col items-center px-6 py-12">
      <div className="max-w-md w-full space-y-8 animate-fade-in">
        <section className="text-center space-y-2">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Room PIN
          </p>
          <div className="flex items-center justify-center gap-3">
            <span className="text-4xl font-mono font-bold tracking-[0.5em]">
              {pin}
            </span>
            <button
              type="button"
              onClick={onCopyPin}
              aria-label="Copy PIN"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Copy
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
            Who's here ({memberships.length})
          </h2>
          <div className="grid grid-cols-3 gap-4">
            {memberships.map((m) => (
              <div
                key={m.userId}
                className="flex flex-col items-center text-center space-y-1"
              >
                <Avatar seed={m.avatarSeed} size={64} />
                <p className="text-sm font-medium truncate w-full">
                  {m.displayName}
                  {m.userId === ownerUserId && (
                    <span className="ml-1 text-xs text-primary">★</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          {isAdmin ? (
            <>
              <Button
                onClick={onStartVoting}
                disabled={startVotingState.kind === "submitting"}
                className="w-full"
              >
                {startVotingState.kind === "submitting"
                  ? "Starting…"
                  : "Start voting"}
              </Button>
              {startVotingState.kind === "error" && (
                <p role="alert" className="text-sm text-destructive text-center">
                  {startVotingState.message}
                </p>
              )}
            </>
          ) : (
            <p className="text-center text-muted-foreground text-sm">
              Waiting for the host to start voting…
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 8.3: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 8.4: Commit**

```bash
git add src/components/room/StatusStub.tsx src/components/room/LobbyView.tsx
git commit -m "Add StatusStub + LobbyView presentational components"
```

---

## Task 9: Wire `/room/[id]` page orchestrator

**Files:**
- Modify: `src/app/room/[id]/page.tsx`

- [ ] **Step 9.1: Replace the page**

Replace the full contents of `src/app/room/[id]/page.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "@/lib/session";
import { useRoomRealtime } from "@/hooks/useRoomRealtime";
import {
  fetchRoomData,
  joinRoomApi,
  patchRoomStatus,
  type FetchRoomData,
} from "@/lib/room/api";
import { mapRoomError } from "@/lib/room/errors";
import LobbyView, {
  type LobbyMember,
  type StartVotingState,
} from "@/components/room/LobbyView";
import StatusStub from "@/components/room/StatusStub";

interface MembershipShape {
  userId: string;
  displayName: string;
  avatarSeed: string;
  joinedAt?: string;
  isReady?: boolean;
}

interface RoomShape {
  id: string;
  pin: string;
  status: string;
  ownerUserId: string;
}

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      room: RoomShape;
      memberships: MembershipShape[];
    };

export default function RoomPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [startVotingState, setStartVotingState] = useState<StartVotingState>({
    kind: "idle",
  });

  const roomId = params.id;

  // Session guard — existing behaviour.
  useEffect(() => {
    if (getSession()) return;
    router.replace(`/onboard?next=/room/${encodeURIComponent(roomId)}`);
  }, [roomId, router]);

  const loadRoom = useCallback(async () => {
    const session = getSession();
    if (!session) return;

    setPhase({ kind: "loading" });

    const fetchResult = await fetchRoomData(roomId, {
      fetch: window.fetch.bind(window),
    });
    if (!fetchResult.ok) {
      setPhase({ kind: "error", message: mapRoomError(fetchResult.code) });
      return;
    }

    const data = fetchResult.data as FetchRoomData;
    const room = data.room as RoomShape;
    const memberships = data.memberships as MembershipShape[];

    const isMember = memberships.some((m) => m.userId === session.userId);
    if (!isMember) {
      const joinResult = await joinRoomApi(roomId, session.userId, {
        fetch: window.fetch.bind(window),
      });
      if (!joinResult.ok) {
        setPhase({ kind: "error", message: mapRoomError(joinResult.code) });
        return;
      }
      // Refetch so we render with the new membership list.
      const refetch = await fetchRoomData(roomId, {
        fetch: window.fetch.bind(window),
      });
      if (!refetch.ok) {
        setPhase({ kind: "error", message: mapRoomError(refetch.code) });
        return;
      }
      const refetched = refetch.data as FetchRoomData;
      setPhase({
        kind: "ready",
        room: refetched.room as RoomShape,
        memberships: refetched.memberships as MembershipShape[],
      });
      return;
    }

    setPhase({ kind: "ready", room, memberships });
  }, [roomId]);

  useEffect(() => {
    void loadRoom();
  }, [loadRoom]);

  useRoomRealtime(roomId, (event) => {
    if (event.type === "status_changed") {
      void loadRoom();
      return;
    }
    if (event.type === "user_joined") {
      setPhase((prev) => {
        if (prev.kind !== "ready") return prev;
        if (prev.memberships.some((m) => m.userId === event.user.id)) return prev;
        return {
          ...prev,
          memberships: [
            ...prev.memberships,
            {
              userId: event.user.id,
              displayName: event.user.displayName,
              avatarSeed: event.user.avatarSeed,
            },
          ],
        };
      });
    }
  });

  const handleStartVoting = useCallback(async () => {
    const session = getSession();
    if (!session || phase.kind !== "ready") return;
    setStartVotingState({ kind: "submitting" });
    const result = await patchRoomStatus(roomId, "voting", session.userId, {
      fetch: window.fetch.bind(window),
    });
    if (result.ok) {
      // status_changed broadcast will drive a refetch; meanwhile stay as idle.
      setStartVotingState({ kind: "idle" });
      return;
    }
    setStartVotingState({
      kind: "error",
      message: mapRoomError(result.code),
    });
  }, [phase, roomId]);

  const handleCopyPin = useCallback(() => {
    if (phase.kind !== "ready") return;
    void navigator.clipboard?.writeText(phase.room.pin);
  }, [phase]);

  if (phase.kind === "loading") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
        <p className="text-muted-foreground animate-shimmer">Loading room…</p>
      </main>
    );
  }

  if (phase.kind === "error") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
        <div className="max-w-md w-full text-center space-y-3 animate-fade-in">
          <h1 className="text-2xl font-bold tracking-tight">Can't open room</h1>
          <p role="alert" className="text-sm text-destructive">
            {phase.message}
          </p>
        </div>
      </main>
    );
  }

  const session = getSession();
  const isAdmin =
    !!session && session.userId === phase.room.ownerUserId;

  if (phase.room.status === "lobby") {
    const members: LobbyMember[] = phase.memberships.map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      avatarSeed: m.avatarSeed,
    }));
    return (
      <LobbyView
        pin={phase.room.pin}
        ownerUserId={phase.room.ownerUserId}
        memberships={members}
        isAdmin={isAdmin}
        startVotingState={startVotingState}
        onStartVoting={handleStartVoting}
        onCopyPin={handleCopyPin}
      />
    );
  }

  return <StatusStub status={phase.room.status} />;
}
```

- [ ] **Step 9.2: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 9.3: Commit**

```bash
git add src/app/room/[id]/page.tsx
git commit -m "Wire /room/[id] page: fetch + auto-join + realtime + status branching"
```

---

## Task 10: Full verification + push + PR

**Files:**
- Modify: `TODO.md` (gitignored — local tick only)

- [ ] **Step 10.1: Run the full pre-push gate**

Run: `npm run pre-push`
Expected: `tsc --noEmit` exit 0; vitest full suite green. Expected growth vs. baseline ≈ +35 tests.

- [ ] **Step 10.2: Tick Phase 2 items in `TODO.md`**

Edit `TODO.md` — change `[ ]` to `[x]` on both:
- `POST /api/rooms/{id}/join — idempotent membership add`
- `/room/[id] — lobby view: participant list, room PIN, admin "Start voting" button`

`TODO.md` is gitignored; no commit.

- [ ] **Step 10.3: Push the branch**

Run: `git push -u origin feat/room-lobby`
Expected: push succeeds (pre-push hook runs tsc + vitest).

- [ ] **Step 10.4: Open the PR**

Run:

```bash
gh pr create --base main \
  --title "Add /room/[id] lobby + POST /{id}/join + user_joined broadcasts" \
  --body "$(cat <<'EOF'
## Summary
Three Phase 2 items bundled:
1. **New `POST /api/rooms/{id}/join`** — idempotent membership upsert + `user_joined` broadcast.
2. **Extend `POST /api/rooms/join-by-pin`** — also broadcasts `user_joined` after upsert.
3. **Wire `/room/[id]` lobby** — fetches room, auto-joins if not a member, subscribes to realtime, renders `<LobbyView>` in lobby status (participant list + PIN + admin Start Voting CTA) or `<StatusStub>` for non-lobby statuses.

`RoomEventPayload` union gains the `user_joined` variant. Lobby dedupes memberships by userId. Status transitions drive a refetch.

Follows the approved design + plan:
- [design](docs/superpowers/specs/2026-04-20-room-lobby-design.md)
- [plan](docs/superpowers/plans/2026-04-20-room-lobby.md)

Closes the `POST /api/rooms/{id}/join` and `/room/[id]` items of Phase 2 in TODO.md.

## Coverage
- `joinRoomByMembership` lib: happy + validation + lookup + status guard + DB errors + broadcast semantics (~15 tests).
- `/api/rooms/[id]/join` route adapter: 200/400/404/409 (5 tests).
- `joinByPin` lib & route adapter tests extended for the new broadcast.
- `src/lib/room/api.ts`: fetch + join + patch helpers, happy + 404 + 409 + 403 + 500 + network (~8 tests).
- `src/lib/room/errors.ts`: table test (8 tests).
- Page + components covered by manual browser smoke matrix (below).

## Test plan
- [x] `npm run type-check`
- [x] `npm test`
- [ ] **Manual browser smoke** (needs a human with a browser):
  - Host creates a room, lands on `/room/{id}` → lobby shows PIN + own avatar + Start Voting button.
  - Second tab (guest) joins via `/join` → arrives at lobby; host's tab sees guest appear in roster live.
  - Host clicks Start Voting → both tabs transition to `<StatusStub status="voting" />`.
  - Opening `/room/<unknown-uuid>` → "This room doesn't exist…" error.
  - Guest hitting Start Voting (shouldn't be rendered; only admin path): verify only the host sees the button.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 10.5: Done**

Report the PR URL. Await manual smoke + merge.

---

## Out of scope

- Presence / idle grey-out (Phase R2).
- Lobby countdown + contestant primer + late-joiner info card (Phase R2).
- Owner lobby-edit affordance (Phase U A2).
- `voting_ending` + 5-s undo (Phase R4).
- Copy-link "Copied!" 2-s confirmation (Phase U A12) — I implement copy-to-clipboard but no confirmation UI.
- Voting / scoring / announcing / done UIs.
- RTL + jsdom — separate tooling PR.
- i18n of copy — Phase 1.5 T9.

---

## Self-review

**Spec coverage**
- Backend `POST /api/rooms/{id}/join` contract — Tasks 2–4.
- `RoomEventPayload` extension — Task 1.
- `joinByPin` broadcast extension — Task 5.
- Client fetch helpers — Task 6.
- `mapRoomError` — Task 7.
- `StatusStub` + `LobbyView` — Task 8.
- Page orchestrator (mount flow, auto-join, realtime subscription, render branch) — Task 9.
- Manual smoke matrix — Task 10 PR body + "Test plan" checklist.

**Placeholder scan:** none. All code steps carry complete blocks; all commands have expected output.

**Type consistency:**
- `RoomEventPayload` — Task 1 definition used verbatim in Tasks 2/3/5 for `user_joined`.
- `JoinRoomInput/Deps/Result` — Task 1 stub, Task 2 happy path, Task 3 full body — same names throughout.
- `UNJOINABLE_STATUSES` — same set value as in existing `joinByPin.ts` (`scoring, announcing, done`); Task 3 uses this constant.
- `fetchRoomData / joinRoomApi / patchRoomStatus` — Task 6 signatures, Task 9 usage matches.
- `LobbyView` props (`pin, ownerUserId, memberships, isAdmin, startVotingState, onStartVoting, onCopyPin`) — Task 8 definition, Task 9 call matches.
- `StartVotingState` — Task 8 union with `idle`/`submitting`/`error` — Task 9 uses same.

**Scope:** three bundled items but tightly coupled — lobby requires the join endpoint AND the broadcasts to feel live. Single-plan territory, though longer than prior PRs.
