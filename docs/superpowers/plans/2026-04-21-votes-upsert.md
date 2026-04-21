# POST /api/rooms/{id}/votes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `POST /api/rooms/{id}/votes` — upsert a user's vote for a contestant (partial-score merge, missed flag, hot-take), and broadcast `voting_progress` per SPEC §8 + §15. Replaces the 501 stub at [src/app/api/rooms/[id]/votes/route.ts](../../../src/app/api/rooms/[id]/votes/route.ts).

**Architecture:** Pure `upsertVote(input, deps)` library in `src/lib/votes/upsert.ts` with DI over `supabase` + `broadcastRoomEvent`, mirroring the `updateNowPerforming` / `updateStatus` shape. Thin Next.js route adapter calls it. See [the design](../specs/2026-04-21-votes-upsert-design.md) for requirements, error codes, and edge cases — don't re-derive them.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase (`@supabase/supabase-js`), Vitest.

---

## File structure

| Path | Kind | Responsibility |
|---|---|---|
| `src/types/index.ts` | modify | Extend `RoomEvent` — add `contestantId` to `voting_progress` payload |
| `src/lib/rooms/shared.ts` | modify | Extend `RoomEventPayload` to match (the two unions are kept in sync) |
| `src/lib/votes/upsert.ts` | **new** | Pure handler: validate → load room + membership + existing vote → merge → UPSERT → broadcast → return |
| `src/lib/votes/upsert.test.ts` | **new** | Unit tests over the pure handler |
| `src/app/api/rooms/[id]/votes/route.ts` | modify | Replace 501 stub with thin POST adapter using `createServiceClient` + `defaultBroadcastRoomEvent` |
| `src/app/api/rooms/[id]/votes/route.test.ts` | **new** | Adapter tests (mirror `now-performing/route.test.ts`) |
| `TODO.md` | modify | Tick the Phase 3 upsert bullet in the final verification task |

**Not touched:**
- `src/lib/api-errors.ts` — every code the design needs already exists (`INVALID_CONTESTANT_ID`, `INVALID_CATEGORY`, `ROOM_NOT_VOTING`, `FORBIDDEN`, etc.).
- `src/types/database.ts` — `votes` Row/Insert/Update already correct for this slice.
- `supabase/schema.sql` — no DDL changes; R0 migration is a separate work stream.

---

## Task 1: Extend broadcast payload unions

**Files:**
- Modify: `src/types/index.ts` (line 129)
- Modify: `src/lib/rooms/shared.ts` (lines 5–11)

SPEC §15 requires `voting_progress` to carry `contestantId`, but the current `RoomEvent` union only has `{ userId, scoredCount }`. Fix both unions before writing handler code, so the type system guides the rest of the work.

- [ ] **Step 1.1: Extend `RoomEvent` in `src/types/index.ts`**

Find the existing line:

```ts
  | { type: "voting_progress"; userId: string; scoredCount: number }
```

Replace with:

```ts
  | { type: "voting_progress"; userId: string; contestantId: string; scoredCount: number }
```

- [ ] **Step 1.2: Extend `RoomEventPayload` in `src/lib/rooms/shared.ts`**

Find the existing `RoomEventPayload` union (around lines 5–11):

```ts
export type RoomEventPayload =
  | { type: "status_changed"; status: string }
  | { type: "now_performing"; contestantId: string }
  | {
      type: "user_joined";
      user: { id: string; displayName: string; avatarSeed: string };
    };
```

Replace with:

```ts
export type RoomEventPayload =
  | { type: "status_changed"; status: string }
  | { type: "now_performing"; contestantId: string }
  | {
      type: "user_joined";
      user: { id: string; displayName: string; avatarSeed: string };
    }
  | {
      type: "voting_progress";
      userId: string;
      contestantId: string;
      scoredCount: number;
    };
```

- [ ] **Step 1.3: Verify type-check still passes**

Run: `npm run type-check`
Expected: no errors. (New variant is additive; no consumer does exhaustive switching on the union yet.)

- [ ] **Step 1.4: Commit**

```bash
git add src/types/index.ts src/lib/rooms/shared.ts
git commit -m "types: extend RoomEvent/RoomEventPayload with voting_progress.contestantId"
```

---

## Task 2: Bootstrap the `upsertVote` lib stub

**Files:**
- Create: `src/lib/votes/upsert.ts`

- [ ] **Step 2.1: Create the stub**

Create `src/lib/votes/upsert.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Vote } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface UpsertVoteInput {
  roomId: unknown;
  userId: unknown;
  contestantId: unknown;
  scores?: unknown;
  missed?: unknown;
  hotTake?: unknown;
  /**
   * True when the caller omitted `hotTake` entirely. False when they sent
   * `hotTake: null` (which clears) or a string (which overwrites). The
   * route adapter sets this by inspecting `Object.prototype.hasOwnProperty`
   * on the parsed body.
   */
  hotTakeOmitted?: boolean;
}

export interface UpsertVoteDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
}

export interface UpsertVoteSuccess {
  ok: true;
  vote: Vote;
  scoredCount: number;
}

export interface UpsertVoteFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type UpsertVoteResult = UpsertVoteSuccess | UpsertVoteFailure;

export async function upsertVote(
  _input: UpsertVoteInput,
  _deps: UpsertVoteDeps
): Promise<UpsertVoteResult> {
  throw new Error("not implemented");
}
```

- [ ] **Step 2.2: Verify type-check**

Run: `npm run type-check`
Expected: passes.

- [ ] **Step 2.3: Commit**

```bash
git add src/lib/votes/upsert.ts
git commit -m "Bootstrap upsertVote: types + stub handler"
```

---

## Task 3: Test harness + first red test (invalid roomId)

**Files:**
- Create: `src/lib/votes/upsert.test.ts`

Establish the supabase-mock builder we'll reuse across every subsequent test. The mock must be chainable for three read paths (rooms, room_memberships, votes) **and** one UPSERT path.

- [ ] **Step 3.1: Write the test file with harness + first failing test**

Create `src/lib/votes/upsert.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { upsertVote, type UpsertVoteDeps } from "@/lib/votes/upsert";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const VALID_CONTESTANT_ID = "2026-ua";

const defaultRoomRow = {
  id: VALID_ROOM_ID,
  status: "voting",
  categories: [
    { name: "Vocals", weight: 1 },
    { name: "Staging", weight: 1 },
  ],
};

const defaultMembership = { room_id: VALID_ROOM_ID, user_id: VALID_USER_ID };

interface MockOptions {
  roomSelectResult?: { data: unknown; error: { message: string } | null };
  membershipSelectResult?: { data: unknown; error: { message: string } | null };
  existingVoteSelectResult?: { data: unknown; error: { message: string } | null };
  voteUpsertResult?: { data: unknown; error: { message: string } | null };
}

function makeSupabaseMock(opts: MockOptions = {}) {
  const roomSelectResult =
    opts.roomSelectResult ?? { data: defaultRoomRow, error: null };
  const membershipSelectResult =
    opts.membershipSelectResult ?? { data: defaultMembership, error: null };
  const existingVoteSelectResult =
    opts.existingVoteSelectResult ?? { data: null, error: null };
  const voteUpsertResult =
    opts.voteUpsertResult ??
    {
      data: {
        id: "cccccccc-dddd-4eee-8fff-111111111111",
        room_id: VALID_ROOM_ID,
        user_id: VALID_USER_ID,
        contestant_id: VALID_CONTESTANT_ID,
        scores: null,
        missed: false,
        hot_take: null,
        updated_at: "2026-04-21T12:00:00Z",
      },
      error: null,
    };

  const upsertPayloads: Array<Record<string, unknown>> = [];
  const upsertOptions: Array<Record<string, unknown> | undefined> = [];

  const from = vi.fn((table: string) => {
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
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue(membershipSelectResult),
            })),
          })),
        })),
      };
    }
    if (table === "votes") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue(existingVoteSelectResult),
              })),
            })),
          })),
        })),
        upsert: vi.fn((payload: Record<string, unknown>, options?: Record<string, unknown>) => {
          upsertPayloads.push(payload);
          upsertOptions.push(options);
          return {
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue(voteUpsertResult),
            })),
          };
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as UpsertVoteDeps["supabase"],
    upsertPayloads,
    upsertOptions,
  };
}

function makeDeps(
  mock: ReturnType<typeof makeSupabaseMock>,
  overrides: Partial<UpsertVoteDeps> = {}
): UpsertVoteDeps {
  return {
    supabase: mock.supabase,
    broadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("upsertVote — input validation", () => {
  it("rejects non-UUID roomId with INVALID_ROOM_ID", async () => {
    const mock = makeSupabaseMock();
    const broadcast = vi.fn();
    const result = await upsertVote(
      {
        roomId: "not-a-uuid",
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock, { broadcastRoomEvent: broadcast })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
    expect(mock.upsertPayloads).toEqual([]);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3.2: Run the test — verify it fails**

Run: `npx vitest run src/lib/votes/upsert.test.ts`
Expected: FAIL with `"not implemented"` thrown from `upsertVote`.

- [ ] **Step 3.3: Implement just enough to pass — roomId validation**

Replace the entire contents of `src/lib/votes/upsert.ts` with:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Vote } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface UpsertVoteInput {
  roomId: unknown;
  userId: unknown;
  contestantId: unknown;
  scores?: unknown;
  missed?: unknown;
  hotTake?: unknown;
  hotTakeOmitted?: boolean;
}

export interface UpsertVoteDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
}

export interface UpsertVoteSuccess {
  ok: true;
  vote: Vote;
  scoredCount: number;
}

export interface UpsertVoteFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type UpsertVoteResult = UpsertVoteSuccess | UpsertVoteFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): UpsertVoteFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

export async function upsertVote(
  input: UpsertVoteInput,
  _deps: UpsertVoteDeps
): Promise<UpsertVoteResult> {
  if (typeof input.roomId !== "string" || !UUID_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID.", 400, "roomId");
  }
  throw new Error("not implemented");
}
```

- [ ] **Step 3.4: Run the test — verify it passes**

Run: `npx vitest run src/lib/votes/upsert.test.ts`
Expected: PASS (1/1).

- [ ] **Step 3.5: Commit**

```bash
git add src/lib/votes/upsert.ts src/lib/votes/upsert.test.ts
git commit -m "upsertVote: validate roomId + test harness"
```

---

## Task 4: Validate userId, contestantId

**Files:**
- Modify: `src/lib/votes/upsert.test.ts`
- Modify: `src/lib/votes/upsert.ts`

- [ ] **Step 4.1: Add failing tests for userId + contestantId**

Append inside the `describe("upsertVote — input validation", ...)` block:

```ts
  it.each([undefined, null, 42, ""])(
    "rejects missing/empty/non-string userId (%s) with INVALID_USER_ID",
    async (userId) => {
      const mock = makeSupabaseMock();
      const result = await upsertVote(
        {
          roomId: VALID_ROOM_ID,
          userId,
          contestantId: VALID_CONTESTANT_ID,
        },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_USER_ID", field: "userId" },
      });
      expect(mock.upsertPayloads).toEqual([]);
    }
  );

  it.each([
    undefined,
    null,
    42,
    "",
    "2026",
    "2026-",
    "2026-united-kingdom",
    "2026-GB",
    "26-gb",
    "2026-g",
    "2026-gbr",
  ])(
    "rejects bad contestantId (%s) with INVALID_CONTESTANT_ID",
    async (contestantId) => {
      const mock = makeSupabaseMock();
      const result = await upsertVote(
        { roomId: VALID_ROOM_ID, userId: VALID_USER_ID, contestantId },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_CONTESTANT_ID", field: "contestantId" },
      });
      expect(mock.upsertPayloads).toEqual([]);
    }
  );
```

- [ ] **Step 4.2: Run — verify new tests fail**

Run: `npx vitest run src/lib/votes/upsert.test.ts`
Expected: failures on the new tests (existing roomId test still passes).

- [ ] **Step 4.3: Implement userId + contestantId checks**

Add `CONTESTANT_ID_REGEX` constant and add the two checks into `upsertVote`, replacing the `throw new Error("not implemented")` line. The function body becomes:

```ts
const CONTESTANT_ID_REGEX = /^\d{4}-[a-z]{2}$/;

export async function upsertVote(
  input: UpsertVoteInput,
  _deps: UpsertVoteDeps
): Promise<UpsertVoteResult> {
  if (typeof input.roomId !== "string" || !UUID_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID.", 400, "roomId");
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return fail(
      "INVALID_USER_ID",
      "userId must be a non-empty string.",
      400,
      "userId"
    );
  }
  if (
    typeof input.contestantId !== "string" ||
    !CONTESTANT_ID_REGEX.test(input.contestantId)
  ) {
    return fail(
      "INVALID_CONTESTANT_ID",
      "contestantId must look like '{year}-{countryCode}' (e.g. '2026-gb').",
      400,
      "contestantId"
    );
  }
  throw new Error("not implemented");
}
```

Place `CONTESTANT_ID_REGEX` alongside `UUID_REGEX` near the top of the file, outside the function.

- [ ] **Step 4.4: Run — verify pass**

Run: `npx vitest run src/lib/votes/upsert.test.ts`
Expected: all validation tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/votes/upsert.ts src/lib/votes/upsert.test.ts
git commit -m "upsertVote: validate userId + contestantId"
```

---

## Task 5: Room lookup — ROOM_NOT_FOUND, FORBIDDEN, ROOM_NOT_VOTING

**Files:**
- Modify: `src/lib/votes/upsert.test.ts`
- Modify: `src/lib/votes/upsert.ts`

- [ ] **Step 5.1: Add failing tests for the three room/membership guards**

Append a new `describe` block at the end of `src/lib/votes/upsert.test.ts`:

```ts
describe("upsertVote — room & membership guards", () => {
  it("returns 404 ROOM_NOT_FOUND when the room does not exist", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: null },
    });
    const broadcast = vi.fn();
    const result = await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock, { broadcastRoomEvent: broadcast })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
    expect(mock.upsertPayloads).toEqual([]);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("returns 404 ROOM_NOT_FOUND when the room SELECT errors", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: { message: "db boom" } },
    });
    const result = await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
  });

  it("returns 403 FORBIDDEN when caller is not a room member", async () => {
    const mock = makeSupabaseMock({
      membershipSelectResult: { data: null, error: null },
    });
    const broadcast = vi.fn();
    const result = await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      },
      makeDeps(mock, { broadcastRoomEvent: broadcast })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 403,
      error: { code: "FORBIDDEN" },
    });
    expect(mock.upsertPayloads).toEqual([]);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it.each(["lobby", "scoring", "announcing", "done"])(
    "returns 409 ROOM_NOT_VOTING when room status is %s",
    async (status) => {
      const mock = makeSupabaseMock({
        roomSelectResult: {
          data: { ...defaultRoomRow, status },
          error: null,
        },
      });
      const result = await upsertVote(
        {
          roomId: VALID_ROOM_ID,
          userId: VALID_USER_ID,
          contestantId: VALID_CONTESTANT_ID,
        },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 409,
        error: { code: "ROOM_NOT_VOTING" },
      });
      expect(mock.upsertPayloads).toEqual([]);
    }
  );
});
```

- [ ] **Step 5.2: Run — verify new tests fail**

Run: `npx vitest run src/lib/votes/upsert.test.ts`
Expected: new guards fail (still throwing "not implemented").

- [ ] **Step 5.3: Implement room + membership loads and status guard**

Replace the function body of `upsertVote` (keeping the three validation checks at the top) with:

```ts
export async function upsertVote(
  input: UpsertVoteInput,
  deps: UpsertVoteDeps
): Promise<UpsertVoteResult> {
  if (typeof input.roomId !== "string" || !UUID_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID.", 400, "roomId");
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return fail(
      "INVALID_USER_ID",
      "userId must be a non-empty string.",
      400,
      "userId"
    );
  }
  if (
    typeof input.contestantId !== "string" ||
    !CONTESTANT_ID_REGEX.test(input.contestantId)
  ) {
    return fail(
      "INVALID_CONTESTANT_ID",
      "contestantId must look like '{year}-{countryCode}' (e.g. '2026-gb').",
      400,
      "contestantId"
    );
  }
  const roomId = input.roomId;
  const userId = input.userId;
  const contestantId = input.contestantId;

  const roomQuery = await deps.supabase
    .from("rooms")
    .select("id, status, categories")
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const roomRow = roomQuery.data as {
    id: string;
    status: string;
    categories: Array<{ name: string; weight: number; hint?: string }>;
  };

  const membershipQuery = await deps.supabase
    .from("room_memberships")
    .select("room_id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipQuery.error || !membershipQuery.data) {
    return fail(
      "FORBIDDEN",
      "You must join this room before voting.",
      403
    );
  }

  if (roomRow.status !== "voting") {
    return fail(
      "ROOM_NOT_VOTING",
      "Votes can only be cast while the room is in 'voting' status.",
      409
    );
  }

  throw new Error("not implemented");
}
```

- [ ] **Step 5.4: Run — verify pass**

Run: `npx vitest run src/lib/votes/upsert.test.ts`
Expected: all tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add src/lib/votes/upsert.ts src/lib/votes/upsert.test.ts
git commit -m "upsertVote: room + membership guards"
```

---

## Task 6: Validate scores + missed + hotTake shapes

**Files:**
- Modify: `src/lib/votes/upsert.test.ts`
- Modify: `src/lib/votes/upsert.ts`

- [ ] **Step 6.1: Add failing tests for body-shape validation**

Append a new `describe` block:

```ts
describe("upsertVote — body shape validation", () => {
  const baseInput = {
    roomId: VALID_ROOM_ID,
    userId: VALID_USER_ID,
    contestantId: VALID_CONTESTANT_ID,
  };

  it("rejects non-object scores with INVALID_BODY", async () => {
    const mock = makeSupabaseMock();
    const result = await upsertVote(
      { ...baseInput, scores: "not-an-object" },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY", field: "scores" },
    });
    expect(mock.upsertPayloads).toEqual([]);
  });

  it.each([0, 11, 5.5, -1, "7", null, NaN])(
    "rejects score value %s with INVALID_BODY",
    async (bad) => {
      const mock = makeSupabaseMock();
      const result = await upsertVote(
        { ...baseInput, scores: { Vocals: bad } },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_BODY", field: "scores.Vocals" },
      });
      expect(mock.upsertPayloads).toEqual([]);
    }
  );

  it("rejects score key not present in rooms.categories with INVALID_CATEGORY", async () => {
    const mock = makeSupabaseMock();
    const result = await upsertVote(
      { ...baseInput, scores: { NotACategory: 7 } },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_CATEGORY", field: "scores.NotACategory" },
    });
    expect(mock.upsertPayloads).toEqual([]);
  });

  it.each(["yes", 1, []])(
    "rejects non-boolean missed (%s) with INVALID_BODY",
    async (bad) => {
      const mock = makeSupabaseMock();
      const result = await upsertVote(
        { ...baseInput, missed: bad },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_BODY", field: "missed" },
      });
    }
  );

  it("rejects non-string, non-null hotTake with INVALID_BODY", async () => {
    const mock = makeSupabaseMock();
    const result = await upsertVote(
      { ...baseInput, hotTake: 42 },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY", field: "hotTake" },
    });
  });

  it("rejects hotTake longer than 140 chars with INVALID_BODY", async () => {
    const mock = makeSupabaseMock();
    const result = await upsertVote(
      { ...baseInput, hotTake: "x".repeat(141) },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY", field: "hotTake" },
    });
  });
});
```

- [ ] **Step 6.2: Run — verify new tests fail**

Run: `npx vitest run src/lib/votes/upsert.test.ts`
Expected: new body-shape tests fail.

- [ ] **Step 6.3: Implement body-shape validation after the room loads**

Scores validation depends on `roomRow.categories` (category-name check), so it runs after the room load. The `missed` + `hotTake` checks can run earlier, but for symmetry and a single validation block we'll put all three together after the status guard.

Insert the following block **between** the `if (roomRow.status !== "voting")` check and the existing `throw new Error("not implemented")`:

```ts
  // Body-shape validation (runs after room load so we can check category names)
  let scoresIn: Record<string, number> | undefined;
  if (input.scores !== undefined) {
    if (
      typeof input.scores !== "object" ||
      input.scores === null ||
      Array.isArray(input.scores)
    ) {
      return fail(
        "INVALID_BODY",
        "scores must be an object mapping category names to integers 1-10.",
        400,
        "scores"
      );
    }
    const categoryNames = new Set(roomRow.categories.map((c) => c.name));
    const parsed: Record<string, number> = {};
    for (const [key, value] of Object.entries(
      input.scores as Record<string, unknown>
    )) {
      if (!categoryNames.has(key)) {
        return fail(
          "INVALID_CATEGORY",
          `'${key}' is not a voting category for this room.`,
          400,
          `scores.${key}`
        );
      }
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 10
      ) {
        return fail(
          "INVALID_BODY",
          `Score for '${key}' must be an integer between 1 and 10.`,
          400,
          `scores.${key}`
        );
      }
      parsed[key] = value;
    }
    scoresIn = parsed;
  }

  if (input.missed !== undefined && typeof input.missed !== "boolean") {
    return fail("INVALID_BODY", "missed must be a boolean.", 400, "missed");
  }

  if (input.hotTake !== undefined) {
    if (input.hotTake !== null && typeof input.hotTake !== "string") {
      return fail(
        "INVALID_BODY",
        "hotTake must be a string, null, or omitted.",
        400,
        "hotTake"
      );
    }
    if (typeof input.hotTake === "string" && input.hotTake.length > 140) {
      return fail(
        "INVALID_BODY",
        "hotTake must be at most 140 characters.",
        400,
        "hotTake"
      );
    }
  }
```

(We assign to `scoresIn` for use in Task 7. TypeScript will warn "unused local" for now — that's fine, it's resolved next task. If the linter blocks the commit, add `// eslint-disable-next-line @typescript-eslint/no-unused-vars` above the `let scoresIn` line and remove it in Task 7.)

- [ ] **Step 6.4: Run — verify pass**

Run: `npx vitest run src/lib/votes/upsert.test.ts`
Expected: all tests pass.

- [ ] **Step 6.5: Commit**

```bash
git add src/lib/votes/upsert.ts src/lib/votes/upsert.test.ts
git commit -m "upsertVote: validate scores/missed/hotTake shapes"
```

---

## Task 7: Happy-path insert (no existing row)

**Files:**
- Modify: `src/lib/votes/upsert.test.ts`
- Modify: `src/lib/votes/upsert.ts`

- [ ] **Step 7.1: Add failing happy-path tests**

Append:

```ts
describe("upsertVote — happy path", () => {
  const baseInput = {
    roomId: VALID_ROOM_ID,
    userId: VALID_USER_ID,
    contestantId: VALID_CONTESTANT_ID,
  };

  it("first write (no existing row): UPSERTs with scores, returns vote + scoredCount", async () => {
    const persisted = {
      id: "dddddddd-eeee-4fff-8000-111111111111",
      room_id: VALID_ROOM_ID,
      user_id: VALID_USER_ID,
      contestant_id: VALID_CONTESTANT_ID,
      scores: { Vocals: 7, Staging: 9 },
      missed: false,
      hot_take: null,
      updated_at: "2026-04-21T12:00:00Z",
    };
    const mock = makeSupabaseMock({
      voteUpsertResult: { data: persisted, error: null },
    });
    const broadcast = vi.fn().mockResolvedValue(undefined);
    const result = await upsertVote(
      {
        ...baseInput,
        scores: { Vocals: 7, Staging: 9 },
      },
      makeDeps(mock, { broadcastRoomEvent: broadcast })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vote).toMatchObject({
      roomId: VALID_ROOM_ID,
      userId: VALID_USER_ID,
      contestantId: VALID_CONTESTANT_ID,
      scores: { Vocals: 7, Staging: 9 },
      missed: false,
      hotTake: null,
    });
    expect(result.scoredCount).toBe(2);

    expect(mock.upsertPayloads).toHaveLength(1);
    expect(mock.upsertPayloads[0]).toMatchObject({
      room_id: VALID_ROOM_ID,
      user_id: VALID_USER_ID,
      contestant_id: VALID_CONTESTANT_ID,
      scores: { Vocals: 7, Staging: 9 },
      missed: false,
      hot_take: null,
    });
    expect(mock.upsertOptions[0]).toMatchObject({
      onConflict: "room_id,user_id,contestant_id",
    });

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "voting_progress",
      userId: VALID_USER_ID,
      contestantId: VALID_CONTESTANT_ID,
      scoredCount: 2,
    });
  });

  it("empty body (just identity fields): upserts empty row, broadcasts scoredCount=0", async () => {
    const persisted = {
      id: "eeeeeeee-ffff-4000-8111-222222222222",
      room_id: VALID_ROOM_ID,
      user_id: VALID_USER_ID,
      contestant_id: VALID_CONTESTANT_ID,
      scores: {},
      missed: false,
      hot_take: null,
      updated_at: "2026-04-21T12:00:00Z",
    };
    const mock = makeSupabaseMock({
      voteUpsertResult: { data: persisted, error: null },
    });
    const broadcast = vi.fn().mockResolvedValue(undefined);
    const result = await upsertVote(baseInput, makeDeps(mock, { broadcastRoomEvent: broadcast }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scoredCount).toBe(0);
    expect(broadcast).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "voting_progress",
      userId: VALID_USER_ID,
      contestantId: VALID_CONTESTANT_ID,
      scoredCount: 0,
    });
  });

  it("returns 500 INTERNAL_ERROR when the UPSERT errors", async () => {
    const mock = makeSupabaseMock({
      voteUpsertResult: { data: null, error: { message: "boom" } },
    });
    const result = await upsertVote(baseInput, makeDeps(mock));
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});
```

- [ ] **Step 7.2: Run — verify fail**

Run: `npx vitest run src/lib/votes/upsert.test.ts`
Expected: happy-path tests fail.

- [ ] **Step 7.3: Implement the merge + upsert + broadcast**

Replace the trailing `throw new Error("not implemented");` in `upsertVote` with:

```ts
  // Read existing row (may be null) for partial-merge semantics
  const existingQuery = await deps.supabase
    .from("votes")
    .select("scores, missed, hot_take")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .eq("contestant_id", contestantId)
    .maybeSingle();

  const existing = (existingQuery.data ?? null) as {
    scores: Record<string, number> | null;
    missed: boolean;
    hot_take: string | null;
  } | null;

  // Merge per design §4
  const mergedScores: Record<string, number> = {
    ...(existing?.scores ?? {}),
    ...(scoresIn ?? {}),
  };
  const mergedMissed =
    typeof input.missed === "boolean" ? input.missed : (existing?.missed ?? false);

  let mergedHotTake: string | null;
  if (input.hotTake !== undefined) {
    mergedHotTake = input.hotTake === null ? null : (input.hotTake as string);
  } else {
    mergedHotTake = existing?.hot_take ?? null;
  }

  const upsertPayload: Database["public"]["Tables"]["votes"]["Insert"] = {
    room_id: roomId,
    user_id: userId,
    contestant_id: contestantId,
    scores: mergedScores,
    missed: mergedMissed,
    hot_take: mergedHotTake,
  };

  const upsertResult = await deps.supabase
    .from("votes")
    .upsert(upsertPayload, { onConflict: "room_id,user_id,contestant_id" })
    .select()
    .single();

  if (upsertResult.error || !upsertResult.data) {
    return fail("INTERNAL_ERROR", "Could not save vote. Please try again.", 500);
  }

  const row = upsertResult.data as Database["public"]["Tables"]["votes"]["Row"];
  const vote: Vote = {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id,
    contestantId: row.contestant_id,
    scores: row.scores,
    missed: row.missed,
    hotTake: row.hot_take,
    updatedAt: row.updated_at,
  };

  // §5 of design: missed row → broadcast 0 regardless of scores object
  const scoredCount = vote.missed
    ? 0
    : Object.keys(vote.scores ?? {}).length;

  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "voting_progress",
      userId,
      contestantId,
      scoredCount,
    });
  } catch (err) {
    console.warn(
      `broadcast 'voting_progress' failed for room ${roomId}; state committed regardless:`,
      err
    );
  }

  return { ok: true, vote, scoredCount };
}
```

- [ ] **Step 7.4: Run — verify pass**

Run: `npx vitest run src/lib/votes/upsert.test.ts`
Expected: all tests pass.

- [ ] **Step 7.5: Commit**

```bash
git add src/lib/votes/upsert.ts src/lib/votes/upsert.test.ts
git commit -m "upsertVote: happy-path insert + broadcast"
```

---

## Task 8: Merge on existing row + missed semantics + hotTake clearing

**Files:**
- Modify: `src/lib/votes/upsert.test.ts`

The implementation from Task 7 already covers merge and missed. This task is purely adding assertions.

- [ ] **Step 8.1: Add the merge/missed/hot-take tests**

Append inside the `describe("upsertVote — happy path", ...)` block (add after the existing cases, before its closing `});`):

```ts
  it("merges partial scores into existing row (preserves untouched categories)", async () => {
    const existing = {
      scores: { Vocals: 5, Staging: 5 },
      missed: false,
      hot_take: "ok",
    };
    const persisted = {
      id: "ffffffff-0000-4111-8222-333333333333",
      room_id: VALID_ROOM_ID,
      user_id: VALID_USER_ID,
      contestant_id: VALID_CONTESTANT_ID,
      scores: { Vocals: 9, Staging: 5 },
      missed: false,
      hot_take: "ok",
      updated_at: "2026-04-21T12:00:00Z",
    };
    const mock = makeSupabaseMock({
      existingVoteSelectResult: { data: existing, error: null },
      voteUpsertResult: { data: persisted, error: null },
    });
    const result = await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
        scores: { Vocals: 9 }, // only Vocals this time
      },
      makeDeps(mock)
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mock.upsertPayloads[0]).toMatchObject({
      scores: { Vocals: 9, Staging: 5 },
      missed: false,
      hot_take: "ok",
    });
    expect(result.scoredCount).toBe(2);
  });

  it("missed: true → broadcasts scoredCount=0 even with scores present", async () => {
    const persisted = {
      id: "11111111-aaaa-4bbb-8ccc-222222222222",
      room_id: VALID_ROOM_ID,
      user_id: VALID_USER_ID,
      contestant_id: VALID_CONTESTANT_ID,
      scores: { Vocals: 7, Staging: 8 },
      missed: true,
      hot_take: null,
      updated_at: "2026-04-21T12:00:00Z",
    };
    const mock = makeSupabaseMock({
      voteUpsertResult: { data: persisted, error: null },
    });
    const broadcast = vi.fn().mockResolvedValue(undefined);
    const result = await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
        missed: true,
        scores: { Vocals: 7, Staging: 8 },
      },
      makeDeps(mock, { broadcastRoomEvent: broadcast })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scoredCount).toBe(0);
    expect(broadcast).toHaveBeenCalledWith(VALID_ROOM_ID, {
      type: "voting_progress",
      userId: VALID_USER_ID,
      contestantId: VALID_CONTESTANT_ID,
      scoredCount: 0,
    });
  });

  it("omitting hotTake preserves existing hot_take", async () => {
    const existing = {
      scores: { Vocals: 5 },
      missed: false,
      hot_take: "keep me",
    };
    const persisted = {
      id: "22222222-bbbb-4ccc-8ddd-333333333333",
      room_id: VALID_ROOM_ID,
      user_id: VALID_USER_ID,
      contestant_id: VALID_CONTESTANT_ID,
      scores: { Vocals: 9 },
      missed: false,
      hot_take: "keep me",
      updated_at: "2026-04-21T12:00:00Z",
    };
    const mock = makeSupabaseMock({
      existingVoteSelectResult: { data: existing, error: null },
      voteUpsertResult: { data: persisted, error: null },
    });
    const result = await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
        scores: { Vocals: 9 },
      },
      makeDeps(mock)
    );
    expect(result.ok).toBe(true);
    expect(mock.upsertPayloads[0]).toMatchObject({ hot_take: "keep me" });
  });

  it("hotTake: null clears existing hot_take", async () => {
    const existing = {
      scores: {},
      missed: false,
      hot_take: "gone soon",
    };
    const persisted = {
      id: "33333333-cccc-4ddd-8eee-444444444444",
      room_id: VALID_ROOM_ID,
      user_id: VALID_USER_ID,
      contestant_id: VALID_CONTESTANT_ID,
      scores: {},
      missed: false,
      hot_take: null,
      updated_at: "2026-04-21T12:00:00Z",
    };
    const mock = makeSupabaseMock({
      existingVoteSelectResult: { data: existing, error: null },
      voteUpsertResult: { data: persisted, error: null },
    });
    const result = await upsertVote(
      {
        roomId: VALID_ROOM_ID,
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
        hotTake: null,
      },
      makeDeps(mock)
    );
    expect(result.ok).toBe(true);
    expect(mock.upsertPayloads[0]).toMatchObject({ hot_take: null });
  });
```

- [ ] **Step 8.2: Run — all should pass immediately (Task 7 already implemented this)**

Run: `npx vitest run src/lib/votes/upsert.test.ts`
Expected: PASS.

If any test fails, the failure exposes a real bug in the Task 7 implementation — fix the implementation (not the test) until green.

- [ ] **Step 8.3: Commit**

```bash
git add src/lib/votes/upsert.test.ts
git commit -m "upsertVote: cover merge, missed, hot-take clear"
```

---

## Task 9: Broadcast failure is non-fatal

**Files:**
- Modify: `src/lib/votes/upsert.test.ts`

- [ ] **Step 9.1: Add failing test**

Append inside the happy-path `describe` block:

```ts
  it("commits the DB write even when the broadcast throws (logs warning)", async () => {
    const persisted = {
      id: "44444444-dddd-4eee-8fff-555555555555",
      room_id: VALID_ROOM_ID,
      user_id: VALID_USER_ID,
      contestant_id: VALID_CONTESTANT_ID,
      scores: { Vocals: 4 },
      missed: false,
      hot_take: null,
      updated_at: "2026-04-21T12:00:00Z",
    };
    const mock = makeSupabaseMock({
      voteUpsertResult: { data: persisted, error: null },
    });
    const broadcast = vi
      .fn()
      .mockRejectedValue(new Error("ws closed"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await upsertVote(
        {
          roomId: VALID_ROOM_ID,
          userId: VALID_USER_ID,
          contestantId: VALID_CONTESTANT_ID,
          scores: { Vocals: 4 },
        },
        makeDeps(mock, { broadcastRoomEvent: broadcast })
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.scoredCount).toBe(1);
      expect(mock.upsertPayloads).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
```

- [ ] **Step 9.2: Run — should already pass (Task 7 wrapped broadcast in try/catch)**

Run: `npx vitest run src/lib/votes/upsert.test.ts`
Expected: PASS.

- [ ] **Step 9.3: Commit**

```bash
git add src/lib/votes/upsert.test.ts
git commit -m "upsertVote: pin broadcast-failure non-fatal behaviour"
```

---

## Task 10: Route adapter

**Files:**
- Modify: `src/app/api/rooms/[id]/votes/route.ts`
- Create: `src/app/api/rooms/[id]/votes/route.test.ts`

- [ ] **Step 10.1: Write the adapter test first**

Create `src/app/api/rooms/[id]/votes/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const VALID_CONTESTANT_ID = "2026-ua";

let roomSelectResult: { data: unknown; error: { message: string } | null } = {
  data: {
    id: VALID_ROOM_ID,
    status: "voting",
    categories: [{ name: "Vocals", weight: 1 }],
  },
  error: null,
};

let membershipSelectResult: { data: unknown; error: { message: string } | null } = {
  data: { room_id: VALID_ROOM_ID, user_id: VALID_USER_ID },
  error: null,
};

const persistedVote = {
  id: "cccccccc-dddd-4eee-8fff-000000000000",
  room_id: VALID_ROOM_ID,
  user_id: VALID_USER_ID,
  contestant_id: VALID_CONTESTANT_ID,
  scores: { Vocals: 7 },
  missed: false,
  hot_take: null,
  updated_at: "2026-04-21T12:00:00Z",
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
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue(membershipSelectResult),
              })),
            })),
          })),
        };
      }
      if (table === "votes") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: null, error: null }),
                })),
              })),
            })),
          })),
          upsert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi
                .fn()
                .mockResolvedValue({ data: persistedVote, error: null }),
            })),
          })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  }),
}));

import { POST } from "@/app/api/rooms/[id]/votes/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown, bodyOverride?: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/rooms/${VALID_ROOM_ID}/votes`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: bodyOverride ?? JSON.stringify(body),
    }
  );
}

describe("POST /api/rooms/[id]/votes (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 })
    );
    roomSelectResult = {
      data: {
        id: VALID_ROOM_ID,
        status: "voting",
        categories: [{ name: "Vocals", weight: 1 }],
      },
      error: null,
    };
    membershipSelectResult = {
      data: { room_id: VALID_ROOM_ID, user_id: VALID_USER_ID },
      error: null,
    };
  });

  it("returns 200 with { vote, scoredCount } on happy path", async () => {
    const res = await POST(
      makeRequest({
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
        scores: { Vocals: 7 },
      }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      vote: { contestantId: string; scores: Record<string, number> };
      scoredCount: number;
    };
    expect(body.vote).toMatchObject({
      contestantId: VALID_CONTESTANT_ID,
      scores: { Vocals: 7 },
    });
    expect(body.scoredCount).toBe(1);
  });

  it("returns 400 INVALID_BODY on non-JSON body", async () => {
    const res = await POST(
      makeRequest(null, "not json{{{"),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 404 ROOM_NOT_FOUND on unknown room", async () => {
    roomSelectResult = { data: null, error: null };
    const res = await POST(
      makeRequest({
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("returns 403 FORBIDDEN when caller is not a member", async () => {
    membershipSelectResult = { data: null, error: null };
    const res = await POST(
      makeRequest({
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 409 ROOM_NOT_VOTING when room status is lobby", async () => {
    roomSelectResult = {
      data: {
        id: VALID_ROOM_ID,
        status: "lobby",
        categories: [{ name: "Vocals", weight: 1 }],
      },
      error: null,
    };
    const res = await POST(
      makeRequest({
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_VOTING");
  });
});
```

- [ ] **Step 10.2: Run — verify fail**

Run: `npx vitest run src/app/api/rooms/[id]/votes/route.test.ts`
Expected: FAIL — the stub returns 501 for every case.

- [ ] **Step 10.3: Replace the route handler**

Rewrite `src/app/api/rooms/[id]/votes/route.ts` completely:

```ts
import { NextRequest, NextResponse } from "next/server";
import { upsertVote } from "@/lib/votes/upsert";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/rooms/{id}/votes
 * Body: {
 *   userId: string,
 *   contestantId: string,
 *   scores?: { [categoryName: string]: number },
 *   missed?: boolean,
 *   hotTake?: string | null
 * }
 * Returns 200 { vote, scoredCount } on success. See
 * docs/superpowers/specs/2026-04-21-votes-upsert-design.md for semantics.
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

  const input = body as {
    userId?: unknown;
    contestantId?: unknown;
    scores?: unknown;
    missed?: unknown;
    hotTake?: unknown;
  };

  const result = await upsertVote(
    {
      roomId: params.id,
      userId: input.userId,
      contestantId: input.contestantId,
      scores: input.scores,
      missed: input.missed,
      hotTake: input.hotTake,
    },
    {
      supabase: createServiceClient(),
      broadcastRoomEvent: defaultBroadcastRoomEvent,
    }
  );

  if (result.ok) {
    return NextResponse.json(
      { vote: result.vote, scoredCount: result.scoredCount },
      { status: 200 }
    );
  }
  return apiError(
    result.error.code,
    result.error.message,
    result.status,
    result.error.field
  );
}
```

- [ ] **Step 10.4: Run — verify pass**

Run: `npx vitest run src/app/api/rooms/[id]/votes/route.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 10.5: Commit**

```bash
git add src/app/api/rooms/[id]/votes/route.ts src/app/api/rooms/[id]/votes/route.test.ts
git commit -m "POST /api/rooms/[id]/votes: wire route adapter"
```

---

## Task 11: Verification + TODO sync

**Files:**
- Modify: `TODO.md`

- [ ] **Step 11.1: Run the full test suite**

Run: `npm test -- --run`
Expected: all suites green, including the two new files.

If any pre-existing test broke (e.g. a subscriber of `RoomEvent` unexpectedly cares about exhaustive pattern match), fix the consumer — not by reverting the union extension.

- [ ] **Step 11.2: Type-check**

Run: `npm run type-check`
Expected: zero errors.

- [ ] **Step 11.3: Lint**

Run: `npm run lint`
Expected: zero warnings in files changed by this plan. Fix any that appear.

- [ ] **Step 11.4: Tick the TODO bullet**

In `TODO.md`, under `## Phase 3 — Voting (SPEC §7, §8)`, change:

```md
- [ ] `POST /api/rooms/{id}/votes` — upsert `(room_id, user_id, contestant_id)`; accept partial score updates, `missed` toggle, `hotTake`; broadcast `voting_progress` (count only)
```

to:

```md
- [x] `POST /api/rooms/{id}/votes` — upsert `(room_id, user_id, contestant_id)`; accept partial score updates, `missed` toggle, `hotTake`; broadcast `voting_progress` (count only)
```

- [ ] **Step 11.5: Commit**

TODO.md is gitignored (per CLAUDE.md §1.1), so only the code commits need a final verification commit if any lint/type fixes arose. If nothing changed, skip this step.

```bash
git status  # confirm clean
```

- [ ] **Step 11.6: Report back to the human**

Summarize:
- Endpoint landed: `POST /api/rooms/[id]/votes`
- Test counts: `upsert.test.ts` (~25 cases), `route.test.ts` (5 cases)
- `type-check`, `lint`, `test` all green
- Broadcast carries `voting_progress { userId, contestantId, scoredCount }`
- Follow-ups:
  - `voting_ending` acceptance (blocked on R0 migration)
  - Rejoin-token auth as defence-in-depth (separate ticket across all write endpoints)
  - Voting UI is the next Phase 3 bullet

---

## Self-review notes

**Spec coverage (design doc §1–§10):**
- §3 error table → Tasks 3, 4, 5, 6 (every code covered)
- §4 merge semantics → Task 7 + Task 8
- §5 scoredCount semantics → Task 7 (happy-path insert test + empty-body test), Task 8 (missed case)
- §6 broadcast payload → Task 1 (union), Task 7 (assertion), Task 9 (failure mode)
- §7 file layout → all tasks
- §8 testing plan → Tasks 3–9 cover every listed case; Task 10 covers route-level errors

**Placeholder scan:** no TBDs, TODOs, or hand-wavy "add validation" steps. Every code block is complete.

**Type consistency:** `UpsertVoteInput`, `UpsertVoteDeps`, `UpsertVoteSuccess`, `UpsertVoteFailure`, `UpsertVoteResult` defined in Task 2 and used verbatim in Tasks 3–7. `upsertVote` signature is stable from Task 2. `RoomEventPayload.voting_progress` fields `{ type, userId, contestantId, scoredCount }` consistent in Task 1, 7, 8.
