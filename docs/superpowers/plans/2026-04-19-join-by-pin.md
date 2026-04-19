# POST /api/rooms/join-by-pin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `POST /api/rooms/join-by-pin` — resolve a room PIN to a `roomId` and idempotently add the caller to `room_memberships` — per the design doc at `docs/superpowers/specs/2026-04-19-join-by-pin-design.md`.

**Architecture:** Pure TypeScript library function `joinByPin(input, deps)` at `src/lib/rooms/joinByPin.ts` with dependency injection over a Supabase client. Thin Next.js route adapter at `src/app/api/rooms/join-by-pin/route.ts`. Matches the pattern already established by `createRoom` and `getRoom`.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase (`@supabase/supabase-js` service-role client), Vitest.

---

## File structure

| Path | Kind | Responsibility |
|---|---|---|
| `src/lib/api-errors.ts` | modify | Add `INVALID_PIN` and `ROOM_NOT_JOINABLE` to `ApiErrorCode` union |
| `src/lib/rooms/joinByPin.ts` | **new** | Pure handler: validate input → lookup room → guard status → upsert membership → return `{ roomId }` |
| `src/lib/rooms/joinByPin.test.ts` | **new** | Unit tests over the pure handler with a mocked Supabase client |
| `src/app/api/rooms/join-by-pin/route.ts` | modify | Thin route adapter (currently a 501 stub) |
| `src/app/api/rooms/join-by-pin/route.test.ts` | **new** | Adapter tests exercising the `POST` function end-to-end with the supabase module mocked |

---

## Task 1: Bootstrap — error codes and lib stub

**Files:**
- Modify: `src/lib/api-errors.ts`
- Create: `src/lib/rooms/joinByPin.ts`

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
  | "USER_NOT_FOUND"
  | "ROOM_NOT_FOUND"
  | "ROOM_NOT_JOINABLE"
  | "CANDIDATE_NOT_FOUND"
  | "INVALID_TOKEN"
  | "INTERNAL_ERROR";
```

- [ ] **Step 1.2: Create the lib stub**

Create `src/lib/rooms/joinByPin.ts` with:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";

export interface JoinByPinInput {
  pin: unknown;
  userId: unknown;
}

export interface JoinByPinDeps {
  supabase: SupabaseClient<Database>;
}

export interface JoinByPinSuccess {
  ok: true;
  roomId: string;
}

export interface JoinByPinFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type JoinByPinResult = JoinByPinSuccess | JoinByPinFailure;

export async function joinByPin(
  _input: JoinByPinInput,
  _deps: JoinByPinDeps
): Promise<JoinByPinResult> {
  throw new Error("not implemented");
}
```

- [ ] **Step 1.3: Type-check**

Run: `npm run type-check`
Expected: passes (no changes to compiled behaviour yet).

- [ ] **Step 1.4: Commit**

```bash
git add src/lib/api-errors.ts src/lib/rooms/joinByPin.ts
git commit -m "Bootstrap joinByPin lib: error codes + stub handler"
```

---

## Task 2: Happy path — lib skeleton with first test

**Files:**
- Create: `src/lib/rooms/joinByPin.test.ts`
- Modify: `src/lib/rooms/joinByPin.ts`

- [ ] **Step 2.1: Write the happy-path test (RED)**

Create `src/lib/rooms/joinByPin.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { joinByPin, type JoinByPinDeps } from "@/lib/rooms/joinByPin";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

interface MockOptions {
  roomSelectResult?: { data: unknown; error: { message: string } | null };
  membershipUpsertResult?: { error: { message: string } | null };
}

function makeSupabaseMock(opts: MockOptions = {}) {
  const roomSelectResult =
    opts.roomSelectResult ?? {
      data: { id: VALID_ROOM_ID, status: "lobby" },
      error: null,
    };
  const membershipUpsertResult =
    opts.membershipUpsertResult ?? { error: null };

  const roomEqArgs: Array<{ col: string; val: unknown }> = [];
  const upsertRows: Array<Record<string, unknown>> = [];
  const upsertOptions: Array<Record<string, unknown>> = [];

  const roomMaybeSingleSpy = vi.fn().mockResolvedValue(roomSelectResult);
  const membershipUpsertSpy = vi.fn((row: Record<string, unknown>, options: Record<string, unknown>) => {
    upsertRows.push(row);
    upsertOptions.push(options);
    return Promise.resolve(membershipUpsertResult);
  });

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
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as JoinByPinDeps["supabase"],
    roomEqArgs,
    upsertRows,
    upsertOptions,
    roomMaybeSingleSpy,
    membershipUpsertSpy,
  };
}

function makeDeps(mock: ReturnType<typeof makeSupabaseMock>): JoinByPinDeps {
  return { supabase: mock.supabase };
}

describe("joinByPin — happy path", () => {
  it("returns { roomId } and upserts membership for a lobby room", async () => {
    const mock = makeSupabaseMock();
    const result = await joinByPin(
      { pin: "ABCDEF", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toEqual({ ok: true, roomId: VALID_ROOM_ID });
    expect(mock.upsertRows).toEqual([
      { room_id: VALID_ROOM_ID, user_id: VALID_USER_ID },
    ]);
    expect(mock.upsertOptions[0]).toMatchObject({
      onConflict: "room_id,user_id",
      ignoreDuplicates: true,
    });
    expect(mock.roomEqArgs).toEqual([{ col: "pin", val: "ABCDEF" }]);
  });
});
```

- [ ] **Step 2.2: Run test — verify RED**

Run: `npx vitest run src/lib/rooms/joinByPin.test.ts`
Expected: FAIL — `Error: not implemented`.

- [ ] **Step 2.3: Implement minimal happy path (GREEN)**

Replace the body of `src/lib/rooms/joinByPin.ts` with:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";

export interface JoinByPinInput {
  pin: unknown;
  userId: unknown;
}

export interface JoinByPinDeps {
  supabase: SupabaseClient<Database>;
}

export interface JoinByPinSuccess {
  ok: true;
  roomId: string;
}

export interface JoinByPinFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type JoinByPinResult = JoinByPinSuccess | JoinByPinFailure;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): JoinByPinFailure {
  return { ok: false, error: field ? { code, message, field } : { code, message }, status };
}

export async function joinByPin(
  input: JoinByPinInput,
  deps: JoinByPinDeps
): Promise<JoinByPinResult> {
  const pin = input.pin as string;
  const userId = input.userId as string;

  const roomQuery = await deps.supabase
    .from("rooms")
    .select("id, status")
    .eq("pin", pin)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "No room matches that PIN.", 404);
  }
  const row = roomQuery.data as { id: string; status: string };

  const { error: upsertError } = await deps.supabase
    .from("room_memberships")
    .upsert(
      { room_id: row.id, user_id: userId },
      { onConflict: "room_id,user_id", ignoreDuplicates: true }
    );

  if (upsertError) {
    return fail("INTERNAL_ERROR", "Could not join room. Please try again.", 500);
  }
  return { ok: true, roomId: row.id };
}
```

- [ ] **Step 2.4: Run test — verify GREEN**

Run: `npx vitest run src/lib/rooms/joinByPin.test.ts`
Expected: PASS (1/1).

- [ ] **Step 2.5: Commit**

```bash
git add src/lib/rooms/joinByPin.ts src/lib/rooms/joinByPin.test.ts
git commit -m "joinByPin: happy path (returns roomId, upserts membership)"
```

---

## Task 3: PIN normalization and validation

**Files:**
- Modify: `src/lib/rooms/joinByPin.ts`
- Modify: `src/lib/rooms/joinByPin.test.ts`

- [ ] **Step 3.1: Append PIN tests (RED)**

Append to `src/lib/rooms/joinByPin.test.ts`:

```ts
describe("joinByPin — PIN normalization", () => {
  it("uppercases lowercase PIN before lookup", async () => {
    const mock = makeSupabaseMock();
    await joinByPin({ pin: "abcdef", userId: VALID_USER_ID }, makeDeps(mock));
    expect(mock.roomEqArgs).toEqual([{ col: "pin", val: "ABCDEF" }]);
  });

  it("trims whitespace around the PIN", async () => {
    const mock = makeSupabaseMock();
    await joinByPin({ pin: "  ABCDEF ", userId: VALID_USER_ID }, makeDeps(mock));
    expect(mock.roomEqArgs).toEqual([{ col: "pin", val: "ABCDEF" }]);
  });

  it("accepts a 7-char PIN (fallback range per §6.2)", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: {
        data: { id: VALID_ROOM_ID, status: "lobby" },
        error: null,
      },
    });
    const result = await joinByPin(
      { pin: "ABCDEFG", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: true });
    expect(mock.roomEqArgs).toEqual([{ col: "pin", val: "ABCDEFG" }]);
  });
});

describe("joinByPin — PIN validation", () => {
  it.each([undefined, null, 42, ""])(
    "rejects missing/empty/non-string PIN (%s) with INVALID_PIN",
    async (pin) => {
      const mock = makeSupabaseMock();
      const result = await joinByPin(
        { pin, userId: VALID_USER_ID },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_PIN", field: "pin" },
      });
      expect(mock.roomEqArgs).toEqual([]);
    }
  );

  it("rejects a 5-char PIN", async () => {
    const mock = makeSupabaseMock();
    const result = await joinByPin(
      { pin: "ABCDE", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_PIN" } });
  });

  it("rejects an 8-char PIN", async () => {
    const mock = makeSupabaseMock();
    const result = await joinByPin(
      { pin: "ABCDEFGH", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_PIN" } });
  });

  it("rejects PIN containing a char outside PIN_CHARSET (e.g. '0')", async () => {
    const mock = makeSupabaseMock();
    const result = await joinByPin(
      { pin: "AAA0AA", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_PIN" } });
    expect(mock.roomEqArgs).toEqual([]);
  });
});
```

- [ ] **Step 3.2: Run tests — verify mixed RED**

Run: `npx vitest run src/lib/rooms/joinByPin.test.ts`
Expected: the **"uppercases"** test passes only accidentally (our impl passes raw `pin`, so `"abcdef"` would be queried — but `roomEqArgs` expects `"ABCDEF"`, so this test fails). The **validation** tests fail (no validation yet). Several normalization tests fail.

- [ ] **Step 3.3: Implement PIN normalization + validation (GREEN)**

In `src/lib/rooms/joinByPin.ts`, add above the `joinByPin` function:

```ts
import { PIN_CHARSET } from "@/types";

const PIN_REGEX = new RegExp(`^[${PIN_CHARSET}]{6,7}$`);

function normalizePin(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toUpperCase();
  if (!PIN_REGEX.test(normalized)) return null;
  return normalized;
}
```

Then change the top of `joinByPin` — the part before the `supabase.from("rooms")` call — to:

```ts
  const pin = normalizePin(input.pin);
  if (pin === null) {
    return fail(
      "INVALID_PIN",
      "pin must be 6-7 characters from the Eurovision PIN charset.",
      400,
      "pin"
    );
  }
  const userId = input.userId as string;
```

- [ ] **Step 3.4: Run tests — verify GREEN**

Run: `npx vitest run src/lib/rooms/joinByPin.test.ts`
Expected: PASS (all PIN tests).

- [ ] **Step 3.5: Commit**

```bash
git add src/lib/rooms/joinByPin.ts src/lib/rooms/joinByPin.test.ts
git commit -m "joinByPin: PIN normalization (trim+upper) and charset validation"
```

---

## Task 4: userId validation + ROOM_NOT_FOUND

**Files:**
- Modify: `src/lib/rooms/joinByPin.ts`
- Modify: `src/lib/rooms/joinByPin.test.ts`

- [ ] **Step 4.1: Append userId + not-found tests (RED)**

Append to `src/lib/rooms/joinByPin.test.ts`:

```ts
describe("joinByPin — userId validation", () => {
  it.each([undefined, null, 42, ""])(
    "rejects missing/empty/non-string userId (%s) with INVALID_USER_ID",
    async (userId) => {
      const mock = makeSupabaseMock();
      const result = await joinByPin(
        { pin: "ABCDEF", userId },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "INVALID_USER_ID", field: "userId" },
      });
      expect(mock.roomEqArgs).toEqual([]);
    }
  );
});

describe("joinByPin — room not found", () => {
  it("returns 404 ROOM_NOT_FOUND when no room matches the PIN", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: null },
    });
    const result = await joinByPin(
      { pin: "ABCDEF", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
    expect(mock.membershipUpsertSpy).not.toHaveBeenCalled();
  });

  it("returns 404 ROOM_NOT_FOUND on room SELECT error (no row either way)", async () => {
    const mock = makeSupabaseMock({
      roomSelectResult: { data: null, error: { message: "boom" } },
    });
    const result = await joinByPin(
      { pin: "ABCDEF", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "ROOM_NOT_FOUND" },
    });
  });
});
```

- [ ] **Step 4.2: Run tests — verify RED**

Run: `npx vitest run src/lib/rooms/joinByPin.test.ts`
Expected: the four `userId` tests fail (no validation yet); the `room not found` tests already pass because the current impl treats error/no-data uniformly as `ROOM_NOT_FOUND`.

- [ ] **Step 4.3: Add userId validation (GREEN)**

In `src/lib/rooms/joinByPin.ts`, right after the `const pin = normalizePin(input.pin); ... ` block and before `const userId = input.userId as string;`, replace those two lines with:

```ts
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return fail(
      "INVALID_USER_ID",
      "userId must be a non-empty string.",
      400,
      "userId"
    );
  }
  const userId = input.userId;
```

- [ ] **Step 4.4: Run tests — verify GREEN**

Run: `npx vitest run src/lib/rooms/joinByPin.test.ts`
Expected: PASS (all userId + not-found tests).

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/rooms/joinByPin.ts src/lib/rooms/joinByPin.test.ts
git commit -m "joinByPin: userId validation + surface ROOM_NOT_FOUND"
```

---

## Task 5: ROOM_NOT_JOINABLE — status guard

**Files:**
- Modify: `src/lib/rooms/joinByPin.ts`
- Modify: `src/lib/rooms/joinByPin.test.ts`

- [ ] **Step 5.1: Append status-guard tests (RED)**

Append to `src/lib/rooms/joinByPin.test.ts`:

```ts
describe("joinByPin — status guard", () => {
  it.each(["scoring", "announcing", "done"] as const)(
    "rejects status=%s with 409 ROOM_NOT_JOINABLE",
    async (status) => {
      const mock = makeSupabaseMock({
        roomSelectResult: {
          data: { id: VALID_ROOM_ID, status },
          error: null,
        },
      });
      const result = await joinByPin(
        { pin: "ABCDEF", userId: VALID_USER_ID },
        makeDeps(mock)
      );
      expect(result).toMatchObject({
        ok: false,
        status: 409,
        error: { code: "ROOM_NOT_JOINABLE" },
      });
      expect(mock.membershipUpsertSpy).not.toHaveBeenCalled();
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
      const result = await joinByPin(
        { pin: "ABCDEF", userId: VALID_USER_ID },
        makeDeps(mock)
      );
      expect(result).toMatchObject({ ok: true, roomId: VALID_ROOM_ID });
    }
  );
});
```

- [ ] **Step 5.2: Run tests — verify RED**

Run: `npx vitest run src/lib/rooms/joinByPin.test.ts`
Expected: the three `ROOM_NOT_JOINABLE` tests fail (current impl lets any status through).

- [ ] **Step 5.3: Add the status guard (GREEN)**

In `src/lib/rooms/joinByPin.ts`, add near the top of the file:

```ts
const UNJOINABLE_STATUSES: ReadonlySet<string> = new Set([
  "scoring",
  "announcing",
  "done",
]);
```

Then, inside `joinByPin`, between the `const row = roomQuery.data as ...` line and the `supabase.from("room_memberships")...` upsert, insert:

```ts
  if (UNJOINABLE_STATUSES.has(row.status)) {
    return fail(
      "ROOM_NOT_JOINABLE",
      "This room is no longer accepting new members.",
      409
    );
  }
```

- [ ] **Step 5.4: Run tests — verify GREEN**

Run: `npx vitest run src/lib/rooms/joinByPin.test.ts`
Expected: PASS (all status-guard tests).

- [ ] **Step 5.5: Commit**

```bash
git add src/lib/rooms/joinByPin.ts src/lib/rooms/joinByPin.test.ts
git commit -m "joinByPin: guard status (scoring/announcing/done => 409)"
```

---

## Task 6: Idempotency + DB error on membership upsert

**Files:**
- Modify: `src/lib/rooms/joinByPin.test.ts`

The production code already does `upsert(..., { ignoreDuplicates: true })` and already returns `INTERNAL_ERROR` on upsert failure. This task adds explicit coverage so regressions can't silently remove either.

- [ ] **Step 6.1: Append idempotency + DB-error tests**

Append to `src/lib/rooms/joinByPin.test.ts`:

```ts
describe("joinByPin — idempotency", () => {
  it("calling twice in a row both succeed with the same roomId", async () => {
    const mock = makeSupabaseMock();
    const first = await joinByPin(
      { pin: "ABCDEF", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    const second = await joinByPin(
      { pin: "ABCDEF", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(first).toEqual({ ok: true, roomId: VALID_ROOM_ID });
    expect(second).toEqual({ ok: true, roomId: VALID_ROOM_ID });
    // Both calls use ignoreDuplicates; the mock records both call attempts.
    expect(mock.upsertOptions).toEqual([
      { onConflict: "room_id,user_id", ignoreDuplicates: true },
      { onConflict: "room_id,user_id", ignoreDuplicates: true },
    ]);
  });
});

describe("joinByPin — DB error", () => {
  it("returns 500 INTERNAL_ERROR when the membership upsert fails", async () => {
    const mock = makeSupabaseMock({
      membershipUpsertResult: { error: { message: "FK violation: user does not exist" } },
    });
    const result = await joinByPin(
      { pin: "ABCDEF", userId: VALID_USER_ID },
      makeDeps(mock)
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});
```

- [ ] **Step 6.2: Run tests — verify GREEN (regression coverage)**

Run: `npx vitest run src/lib/rooms/joinByPin.test.ts`
Expected: PASS. If any fail, stop and investigate before editing production code.

- [ ] **Step 6.3: Commit**

```bash
git add src/lib/rooms/joinByPin.test.ts
git commit -m "joinByPin: lock in idempotency and upsert-error regression tests"
```

---

## Task 7: Route adapter

**Files:**
- Modify: `src/app/api/rooms/join-by-pin/route.ts`
- Create: `src/app/api/rooms/join-by-pin/route.test.ts`

- [ ] **Step 7.1: Write the route-adapter tests (RED)**

Create `src/app/api/rooms/join-by-pin/route.test.ts`:

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
      throw new Error(`unexpected table: ${table}`);
    }),
  }),
}));

import { POST } from "@/app/api/rooms/join-by-pin/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/rooms/join-by-pin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/rooms/join-by-pin (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roomSelectResult = {
      data: { id: VALID_ROOM_ID, status: "lobby" },
      error: null,
    };
  });

  it("returns 200 with { roomId } on a known PIN", async () => {
    const res = await POST(makeRequest({ pin: "ABCDEF", userId: VALID_USER_ID }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roomId: string };
    expect(body).toEqual({ roomId: VALID_ROOM_ID });
  });

  it("returns 400 INVALID_BODY on non-JSON body", async () => {
    const req = new NextRequest("http://localhost/api/rooms/join-by-pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json{{{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 404 ROOM_NOT_FOUND on unknown PIN", async () => {
    roomSelectResult = { data: null, error: null };
    const res = await POST(makeRequest({ pin: "ABCDEF", userId: VALID_USER_ID }));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("returns 409 ROOM_NOT_JOINABLE on announcing", async () => {
    roomSelectResult = {
      data: { id: VALID_ROOM_ID, status: "announcing" },
      error: null,
    };
    const res = await POST(makeRequest({ pin: "ABCDEF", userId: VALID_USER_ID }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_JOINABLE");
  });
});
```

- [ ] **Step 7.2: Run tests — verify RED**

Run: `npx vitest run src/app/api/rooms/join-by-pin/route.test.ts`
Expected: FAIL — route currently returns 501. All four tests fail.

- [ ] **Step 7.3: Wire the route (GREEN)**

Replace the entire contents of `src/app/api/rooms/join-by-pin/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { joinByPin } from "@/lib/rooms/joinByPin";
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
  });

  if (result.ok) {
    return NextResponse.json({ roomId: result.roomId }, { status: 200 });
  }
  return apiError(result.error.code, result.error.message, result.status, result.error.field);
}
```

- [ ] **Step 7.4: Run tests — verify GREEN**

Run: `npx vitest run src/app/api/rooms/join-by-pin/route.test.ts`
Expected: PASS (4/4).

- [ ] **Step 7.5: Commit**

```bash
git add src/app/api/rooms/join-by-pin/route.ts src/app/api/rooms/join-by-pin/route.test.ts
git commit -m "joinByPin: wire POST /api/rooms/join-by-pin route adapter"
```

---

## Task 8: Full verification + push + PR

**Files:**
- Modify: `TODO.md` (gitignored — local tick only)

- [ ] **Step 8.1: Run the full pre-push gate**

Run: `npm run pre-push`
Expected: `tsc --noEmit` clean; `vitest` full suite passes. Test count grows by ~18–22 versus the pre-branch baseline.

- [ ] **Step 8.2: Tick the Phase 2 item in `TODO.md`**

Edit `TODO.md` — find the Phase 2 line `- [ ] POST /api/rooms/join-by-pin` and change `[ ]` to `[x]`. `TODO.md` is gitignored — no commit needed.

- [ ] **Step 8.3: Push the branch**

Run: `git push -u origin feat/join-by-pin`
Expected: push succeeds (pre-push hook re-runs `npm run pre-push`).

- [ ] **Step 8.4: Open the PR**

Run:

```bash
gh pr create --base main \
  --title "Add POST /api/rooms/join-by-pin (join-by-pin lib + route adapter)" \
  --body "$(cat <<'EOF'
## Summary
- Pure `joinByPin()` lib under `src/lib/rooms/joinByPin.ts` with DI over supabase. Resolves PIN (trim + uppercase + charset-validated, length 6-7) → roomId, guards status (`scoring` / `announcing` / `done` → 409 `ROOM_NOT_JOINABLE`), idempotently upserts membership via `ignoreDuplicates: true`.
- Thin route adapter at `src/app/api/rooms/join-by-pin/route.ts`.
- New error codes: `INVALID_PIN`, `ROOM_NOT_JOINABLE`.
- Follows design doc `docs/superpowers/specs/2026-04-19-join-by-pin-design.md`.

Closes the third item of Phase 2 in TODO.md.

## Test plan
- [x] `npm run type-check`
- [x] `npm test` (all green)
- [ ] Manual smoke once the `/join` PIN-input page lands

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 8.5: Done**

Report the PR URL and await merge.

---

## Out of scope

- Realtime `user_joined` broadcast (§15) — separate Phase 2/3 concern.
- PIN rate-limiting / abuse detection — deferred; 32⁶ space + short-lived rooms make it low-risk for MVP.
- Same-name resolver (§4.3) — orthogonal; callers already have a `userId` from onboarding.

---

## Self-review

**Spec coverage:**
- Contract (§Contract of spec) — covered by Task 2 (200 shape) + Task 7 (route adapter 200/404/409).
- PIN normalization (§PIN) — Task 3.
- Status guard B (§Reject `scoring`) — Task 5.
- Idempotency (§Idempotency) — Task 6.
- userId rule (§User existence) — Task 4.
- Error codes additions — Task 1.
- Test plan (§Test plan) — covered across Tasks 2–7.

**Placeholder scan:** none. Every step includes concrete code or a concrete command with expected output.

**Type consistency:** `JoinByPinInput`, `JoinByPinDeps`, `JoinByPinResult`, and the `ok: true/false` discriminator are defined in Task 1 and reused verbatim in Tasks 2–6. `normalizePin`, `PIN_REGEX`, `UNJOINABLE_STATUSES`, and `fail()` are introduced once and referenced consistently thereafter.

**Scope:** one endpoint, one library file, one route adapter, one test file per. Appropriate for a single plan — no decomposition needed.
