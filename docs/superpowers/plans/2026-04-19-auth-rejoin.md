# `POST /api/auth/rejoin` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `POST /api/auth/rejoin` — verify a returning user's identity via bcrypt-compare against `users.rejoin_token_hash`, refresh `last_seen_at`, and return the canonical user fields the client needs to hydrate `emx_session`. Identity-only: the rejoin token identifies the user, not a room (SPEC §4.3).

**Architecture:** Mirror the onboard pattern. Pure handler `rejoinUser(input, deps)` in `src/lib/auth/rejoin.ts` owns all validation, DB I/O, and branching; it takes injected dependencies (supabase client, `compareToken`, `now()`) so it is fully unit-testable with fakes. The route file at `src/app/api/auth/rejoin/route.ts` is a thin adapter that wires real deps (`createServiceClient()`, `bcrypt.compare`, `new Date().toISOString()`) and translates the result union to HTTP responses. The shared `ApiErrorCode` union in `src/lib/api-errors.ts` is extended with two new codes (`USER_NOT_FOUND`, `INVALID_TOKEN`).

**Tech Stack:** Next.js 14 App Router (Route Handlers), TypeScript strict, Vitest, Supabase service-role client, bcryptjs.

**Spec:** [docs/superpowers/specs/2026-04-19-auth-rejoin-design.md](../specs/2026-04-19-auth-rejoin-design.md)

---

## File map

| File | Purpose | Status |
|---|---|---|
| `src/lib/api-errors.ts` | Shared `apiError()` + `ApiErrorCode` union — extend with `USER_NOT_FOUND`, `INVALID_TOKEN` | **Modify** |
| `src/lib/auth/rejoin.ts` | Pure `rejoinUser(input, deps)` handler. Validation + bcrypt-compare-via-dep + supabase select/update. No Next/bcrypt imports. | **Create** |
| `src/lib/auth/rejoin.test.ts` | Vitest unit tests for `rejoinUser` using fake deps (16 tests, per spec §5) | **Create** |
| `src/app/api/auth/rejoin/route.ts` | Thin adapter — replaces existing 501 stub | **Modify (replace stub)** |
| `src/app/api/auth/rejoin/route.test.ts` | Two route-adapter smoke tests (happy path + invalid token) | **Create** |

UUID v4 regex used throughout: `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`.

---

## Task 1: Extend `ApiErrorCode` with rejoin-specific codes

**Files:**
- Modify: `src/lib/api-errors.ts`

Adding two codes to the union. Existing callers of `apiError()` keep working because the union only widens.

- [ ] **Step 1: Add `USER_NOT_FOUND` and `INVALID_TOKEN` to the union**

Edit `src/lib/api-errors.ts`. Replace the `ApiErrorCode` type with:

```ts
export type ApiErrorCode =
  | "INVALID_BODY"
  | "INVALID_DISPLAY_NAME"
  | "INVALID_AVATAR_SEED"
  | "USER_NOT_FOUND"
  | "INVALID_TOKEN"
  | "INTERNAL_ERROR";
```

Leave `apiError()` and `ApiErrorBody` unchanged.

- [ ] **Step 2: Run type-check**

Run: `npm run type-check`
Expected: clean exit, no errors. The existing onboard route should still compile because it only uses codes that already existed.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api-errors.ts
git commit -m "Extend ApiErrorCode with USER_NOT_FOUND and INVALID_TOKEN"
```

---

## Task 2: Write failing tests for the pure `rejoinUser` handler

**Files:**
- Create: `src/lib/auth/rejoin.test.ts`

Sixteen unit tests covering happy path, compare-fail side-effects, body validation, auth failures, Supabase errors, and plaintext-token leakage. All tests use fake `deps` — no real Supabase, no real bcrypt.

- [ ] **Step 1: Create the test file**

Write to `src/lib/auth/rejoin.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { rejoinUser, type RejoinDeps } from "@/lib/auth/rejoin";

// ─── Test helpers ────────────────────────────────────────────────────────────

const VALID_USER_ID = "11111111-2222-4333-8444-555555555555";
const VALID_ROOM_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const VALID_TOKEN = "token-plaintext-fixed";
const FAKE_HASH = "BCRYPT_HASH_FIXED";
const NOW_ISO = "2026-04-19T12:00:00.000Z";

interface MakeDepsOverrides {
  row?: {
    id: string;
    display_name: string;
    avatar_seed: string;
    rejoin_token_hash: string;
  } | null;
  selectError?: { message: string } | null;
  compareResult?: boolean;
  updateError?: { message: string } | null;
}

function makeDeps(o: MakeDepsOverrides = {}) {
  const row =
    o.row === undefined
      ? {
          id: VALID_USER_ID,
          display_name: "Lia Bear",
          avatar_seed: "seed-abc",
          rejoin_token_hash: FAKE_HASH,
        }
      : o.row;
  const selectError = o.selectError ?? null;
  const compareResult = o.compareResult ?? true;
  const updateError = o.updateError ?? null;

  const maybeSingleMock = vi
    .fn()
    .mockResolvedValue({ data: row, error: selectError });
  const selectEqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
  const selectMock = vi.fn(() => ({ eq: selectEqMock }));

  const updateEqMock = vi.fn().mockResolvedValue({ error: updateError });
  const updateMock = vi.fn(() => ({ eq: updateEqMock }));

  const fromMock = vi.fn(() => ({
    select: selectMock,
    update: updateMock,
  }));

  const compareSpy = vi.fn(async () => compareResult);
  const nowSpy = vi.fn(() => NOW_ISO);

  const deps: RejoinDeps = {
    supabase: { from: fromMock } as unknown as RejoinDeps["supabase"],
    compareToken: compareSpy,
    now: nowSpy,
  };

  return {
    deps,
    fromMock,
    selectMock,
    selectEqMock,
    maybeSingleMock,
    updateMock,
    updateEqMock,
    compareSpy,
    nowSpy,
  };
}

function validInput(extra: Record<string, unknown> = {}) {
  return { userId: VALID_USER_ID, rejoinToken: VALID_TOKEN, ...extra };
}

// ─── Happy path ──────────────────────────────────────────────────────────────

describe("rejoinUser — happy path", () => {
  it("returns the three user fields on valid input + matching hash", async () => {
    const { deps } = makeDeps();
    const result = await rejoinUser(validInput(), deps);
    expect(result).toEqual({
      ok: true,
      user: {
        userId: VALID_USER_ID,
        displayName: "Lia Bear",
        avatarSeed: "seed-abc",
      },
    });
  });

  it("calls compareToken exactly once with (plaintext, stored hash)", async () => {
    const { deps, compareSpy } = makeDeps();
    await rejoinUser(validInput(), deps);
    expect(compareSpy).toHaveBeenCalledTimes(1);
    expect(compareSpy).toHaveBeenCalledWith(VALID_TOKEN, FAKE_HASH);
  });

  it("updates last_seen_at with deps.now() after successful compare", async () => {
    const { deps, updateMock, updateEqMock, nowSpy } = makeDeps();
    await rejoinUser(validInput(), deps);
    expect(nowSpy).toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith({ last_seen_at: NOW_ISO });
    expect(updateEqMock).toHaveBeenCalledWith("id", VALID_USER_ID);
  });

  it("accepts a syntactically valid roomId and does NOT query rooms or room_memberships", async () => {
    const { deps, fromMock } = makeDeps();
    const result = await rejoinUser(validInput({ roomId: VALID_ROOM_ID }), deps);
    expect(result).toMatchObject({ ok: true });
    const tablesTouched = fromMock.mock.calls.map((c) => c[0]);
    expect(tablesTouched.every((t) => t === "users")).toBe(true);
    expect(tablesTouched).not.toContain("rooms");
    expect(tablesTouched).not.toContain("room_memberships");
  });
});

// ─── Compare-fail side-effects ───────────────────────────────────────────────

describe("rejoinUser — compare-fail side-effects", () => {
  it("does NOT call the last_seen_at update when compare returns false", async () => {
    const { deps, updateMock } = makeDeps({ compareResult: false });
    await rejoinUser(validInput(), deps);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

// ─── Body validation ─────────────────────────────────────────────────────────

describe("rejoinUser — body validation", () => {
  it("rejects missing userId as INVALID_BODY 400", async () => {
    const { deps } = makeDeps();
    const result = await rejoinUser(
      { rejoinToken: VALID_TOKEN } as unknown as Parameters<typeof rejoinUser>[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY" },
    });
  });

  it("rejects missing rejoinToken as INVALID_BODY 400", async () => {
    const { deps } = makeDeps();
    const result = await rejoinUser(
      { userId: VALID_USER_ID } as unknown as Parameters<typeof rejoinUser>[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY" },
    });
  });

  it("rejects non-string userId as INVALID_BODY 400", async () => {
    const { deps } = makeDeps();
    const result = await rejoinUser(
      { userId: 42, rejoinToken: VALID_TOKEN } as unknown as Parameters<
        typeof rejoinUser
      >[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY" },
    });
  });

  it("rejects non-string rejoinToken as INVALID_BODY 400", async () => {
    const { deps } = makeDeps();
    const result = await rejoinUser(
      { userId: VALID_USER_ID, rejoinToken: null } as unknown as Parameters<
        typeof rejoinUser
      >[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY" },
    });
  });

  it("rejects non-uuid userId as INVALID_BODY 400 with field=userId", async () => {
    const { deps } = makeDeps();
    const result = await rejoinUser(
      { userId: "not-a-uuid", rejoinToken: VALID_TOKEN },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY", field: "userId" },
    });
  });

  it("rejects non-string roomId when present as INVALID_BODY 400 with field=roomId", async () => {
    const { deps } = makeDeps();
    const result = await rejoinUser(
      { userId: VALID_USER_ID, rejoinToken: VALID_TOKEN, roomId: 123 } as unknown as Parameters<
        typeof rejoinUser
      >[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY", field: "roomId" },
    });
  });
});

// ─── Auth failures ───────────────────────────────────────────────────────────

describe("rejoinUser — auth failures", () => {
  it("returns USER_NOT_FOUND 404 when no row matches; does NOT call compare or update", async () => {
    const { deps, compareSpy, updateMock } = makeDeps({ row: null });
    const result = await rejoinUser(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "USER_NOT_FOUND" },
    });
    expect(compareSpy).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_TOKEN 401 when compare returns false; does NOT call update", async () => {
    const { deps, updateMock } = makeDeps({ compareResult: false });
    const result = await rejoinUser(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 401,
      error: { code: "INVALID_TOKEN" },
    });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

// ─── Supabase errors ─────────────────────────────────────────────────────────

describe("rejoinUser — supabase errors", () => {
  it("returns INTERNAL_ERROR 500 when the select call errors", async () => {
    const { deps } = makeDeps({ selectError: { message: "db unreachable" } });
    const result = await rejoinUser(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("returns INTERNAL_ERROR 500 when the last_seen_at update errors after a successful compare", async () => {
    const { deps } = makeDeps({ updateError: { message: "update failed" } });
    const result = await rejoinUser(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});

// ─── Leakage ─────────────────────────────────────────────────────────────────

describe("rejoinUser — never leaks plaintext token", () => {
  it.each([
    ["USER_NOT_FOUND", { row: null } as MakeDepsOverrides],
    ["INVALID_TOKEN", { compareResult: false } as MakeDepsOverrides],
    ["select error", { selectError: { message: "boom" } } as MakeDepsOverrides],
    ["update error", { updateError: { message: "boom" } } as MakeDepsOverrides],
  ])(
    "never includes plaintext rejoinToken in the %s error result",
    async (_label, overrides) => {
      const { deps } = makeDeps(overrides);
      const result = await rejoinUser(validInput(), deps);
      expect(JSON.stringify(result)).not.toContain(VALID_TOKEN);
    }
  );
});
```

- [ ] **Step 2: Run the new tests to confirm they fail (no implementation yet)**

Run: `npm run test -- src/lib/auth/rejoin.test.ts`
Expected: every test fails with a module-resolution error like `Failed to load url @/lib/auth/rejoin` or similar — the file does not exist yet. That's the right kind of failure for a red TDD step.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/rejoin.test.ts
git commit -m "Add failing tests for rejoinUser pure handler"
```

---

## Task 3: Implement `rejoinUser` until the tests pass

**Files:**
- Create: `src/lib/auth/rejoin.ts`

- [ ] **Step 1: Create the handler file**

Write to `src/lib/auth/rejoin.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface RejoinInput {
  userId: unknown;
  rejoinToken: unknown;
  roomId?: unknown;
}

export interface RejoinDeps {
  supabase: SupabaseClient<Database>;
  compareToken: (plaintext: string, hash: string) => Promise<boolean>;
  now: () => string;
}

export interface RejoinSuccess {
  ok: true;
  user: { userId: string; displayName: string; avatarSeed: string };
}

export interface RejoinFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type RejoinResult = RejoinSuccess | RejoinFailure;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): RejoinFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

export async function rejoinUser(
  input: RejoinInput,
  deps: RejoinDeps
): Promise<RejoinResult> {
  if (typeof input.userId !== "string" || typeof input.rejoinToken !== "string") {
    return fail(
      "INVALID_BODY",
      "Request body must include userId and rejoinToken strings.",
      400
    );
  }
  if (input.roomId !== undefined && typeof input.roomId !== "string") {
    return fail("INVALID_BODY", "roomId must be a string when present.", 400, "roomId");
  }
  if (!UUID_V4_REGEX.test(input.userId)) {
    return fail("INVALID_BODY", "userId must be a UUID v4.", 400, "userId");
  }

  const userId = input.userId;
  const rejoinToken = input.rejoinToken;

  const { data, error: selectError } = await deps.supabase
    .from("users")
    .select("id, display_name, avatar_seed, rejoin_token_hash")
    .eq("id", userId)
    .maybeSingle();

  if (selectError) {
    return fail("INTERNAL_ERROR", "Could not verify session. Please try again.", 500);
  }
  if (!data) {
    return fail("USER_NOT_FOUND", "No user matches this session.", 404);
  }

  const tokenOk = await deps.compareToken(rejoinToken, data.rejoin_token_hash);
  if (!tokenOk) {
    return fail("INVALID_TOKEN", "Session token does not match.", 401);
  }

  const { error: updateError } = await deps.supabase
    .from("users")
    .update({ last_seen_at: deps.now() })
    .eq("id", userId);

  if (updateError) {
    return fail("INTERNAL_ERROR", "Could not refresh session. Please try again.", 500);
  }

  return {
    ok: true,
    user: {
      userId: data.id,
      displayName: data.display_name,
      avatarSeed: data.avatar_seed,
    },
  };
}
```

- [ ] **Step 2: Run the tests and confirm all 16 pass**

Run: `npm run test -- src/lib/auth/rejoin.test.ts`
Expected: 16 passing tests, 0 failing. If any fail, read the diff carefully — do not loosen an assertion; fix the implementation to match the spec.

- [ ] **Step 3: Run the full test suite to confirm nothing else broke**

Run: `npm run test`
Expected: all existing tests (scoring, onboard, onboard route) still pass.

- [ ] **Step 4: Run type-check**

Run: `npm run type-check`
Expected: clean exit.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/rejoin.ts
git commit -m "Implement rejoinUser pure handler"
```

---

## Task 4: Replace the route stub with the real adapter

**Files:**
- Modify: `src/app/api/auth/rejoin/route.ts` (replace 501 stub)

- [ ] **Step 1: Replace the stub file contents**

Overwrite `src/app/api/auth/rejoin/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { rejoinUser } from "@/lib/auth/rejoin";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/auth/rejoin
 * Validate a returning user's rejoin token and refresh last_seen_at.
 * Body: { userId: string, rejoinToken: string, roomId?: string }
 * Returns: 200 { userId, displayName, avatarSeed } on success.
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

  const result = await rejoinUser(
    body as { userId: unknown; rejoinToken: unknown; roomId?: unknown },
    {
      supabase: createServiceClient(),
      compareToken: (plaintext, hash) => bcrypt.compare(plaintext, hash),
      now: () => new Date().toISOString(),
    }
  );

  if (result.ok) {
    return NextResponse.json(result.user, { status: 200 });
  }
  return apiError(result.error.code, result.error.message, result.status, result.error.field);
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/rejoin/route.ts
git commit -m "Wire POST /api/auth/rejoin route adapter"
```

---

## Task 5: Write route-adapter smoke tests

**Files:**
- Create: `src/app/api/auth/rejoin/route.test.ts`

Two smoke tests: happy path (bcrypt returns true → 200) and invalid-token path (bcrypt returns false → 401). These don't re-test handler logic; they verify wiring (JSON parse, createServiceClient mock, bcrypt mock, status mapping).

- [ ] **Step 1: Create the route test file**

Write to `src/app/api/auth/rejoin/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks ────────────────────────────────────────────────────────────

const maybeSingleMock = vi.fn();
const updateEqMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }),
      update: () => ({ eq: updateEqMock }),
    }),
  }),
}));

const bcryptCompareMock = vi.fn();
vi.mock("bcryptjs", () => ({
  default: { compare: (p: string, h: string) => bcryptCompareMock(p, h) },
}));

import { POST } from "@/app/api/auth/rejoin/route";
import { NextRequest } from "next/server";

const VALID_USER_ID = "11111111-2222-4333-8444-555555555555";
const USER_ROW = {
  id: VALID_USER_ID,
  display_name: "Lia Bear",
  avatar_seed: "seed-abc",
  rejoin_token_hash: "$2a$10$fakefakefakefakefakefakefakefakefakefakefakefakefakefak",
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/rejoin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/rejoin (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maybeSingleMock.mockResolvedValue({ data: USER_ROW, error: null });
    updateEqMock.mockResolvedValue({ error: null });
  });

  it("returns 200 with { userId, displayName, avatarSeed } when bcrypt.compare resolves truthy", async () => {
    bcryptCompareMock.mockResolvedValue(true);
    const res = await POST(
      makeRequest({ userId: VALID_USER_ID, rejoinToken: "plaintext-token" })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      userId: VALID_USER_ID,
      displayName: "Lia Bear",
      avatarSeed: "seed-abc",
    });
  });

  it("returns 401 INVALID_TOKEN when bcrypt.compare resolves falsy", async () => {
    bcryptCompareMock.mockResolvedValue(false);
    const res = await POST(
      makeRequest({ userId: VALID_USER_ID, rejoinToken: "wrong-token" })
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_TOKEN");
  });
});
```

- [ ] **Step 2: Run the route tests**

Run: `npm run test -- src/app/api/auth/rejoin/route.test.ts`
Expected: both tests pass.

- [ ] **Step 3: Run the full suite**

Run: `npm run test`
Expected: all tests green (onboard handler + onboard route + scoring + rejoin handler + rejoin route).

- [ ] **Step 4: Type-check**

Run: `npm run type-check`
Expected: clean exit.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/rejoin/route.test.ts
git commit -m "Add route-adapter smoke tests for /api/auth/rejoin"
```

---

## Task 6: Manual verification against a live Supabase project

This is the `verification-before-completion` gate required by CLAUDE.md — run it before ticking TODO.md. If `.env.local` is not configured, skip this task with a note, but keep the TODO item open.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (keep it running in a second terminal)

- [ ] **Step 2: Mint a user via onboard**

In a second terminal, run:

```bash
curl -s -X POST http://localhost:3000/api/auth/onboard \
  -H 'content-type: application/json' \
  -d '{"displayName":"Rejoin Test","avatarSeed":"rejoin-seed-1"}'
```

Expected: HTTP 201 with JSON `{ userId, rejoinToken, displayName: "Rejoin Test", avatarSeed: "rejoin-seed-1" }`. Save the `userId` and `rejoinToken` values from the response.

- [ ] **Step 3: Rejoin with the saved credentials (happy path)**

```bash
curl -s -i -X POST http://localhost:3000/api/auth/rejoin \
  -H 'content-type: application/json' \
  -d '{"userId":"<SAVED_USER_ID>","rejoinToken":"<SAVED_REJOIN_TOKEN>"}'
```

Expected: `HTTP/1.1 200 OK` and body `{"userId":"<SAVED_USER_ID>","displayName":"Rejoin Test","avatarSeed":"rejoin-seed-1"}`.

- [ ] **Step 4: Rejoin with a tampered token**

```bash
curl -s -i -X POST http://localhost:3000/api/auth/rejoin \
  -H 'content-type: application/json' \
  -d '{"userId":"<SAVED_USER_ID>","rejoinToken":"<SAVED_REJOIN_TOKEN_WITH_LAST_CHAR_FLIPPED>"}'
```

Expected: `HTTP/1.1 401 Unauthorized` and body `{"error":{"code":"INVALID_TOKEN",...}}`.

- [ ] **Step 5: Rejoin with a random-but-well-formed UUID**

```bash
curl -s -i -X POST http://localhost:3000/api/auth/rejoin \
  -H 'content-type: application/json' \
  -d '{"userId":"00000000-0000-4000-8000-000000000000","rejoinToken":"anything"}'
```

Expected: `HTTP/1.1 404 Not Found` and body `{"error":{"code":"USER_NOT_FOUND",...}}`.

- [ ] **Step 6: Malformed-body cases**

```bash
# Missing rejoinToken
curl -s -i -X POST http://localhost:3000/api/auth/rejoin \
  -H 'content-type: application/json' \
  -d '{"userId":"<SAVED_USER_ID>"}'

# userId not a uuid
curl -s -i -X POST http://localhost:3000/api/auth/rejoin \
  -H 'content-type: application/json' \
  -d '{"userId":"not-a-uuid","rejoinToken":"x"}'

# roomId is a number
curl -s -i -X POST http://localhost:3000/api/auth/rejoin \
  -H 'content-type: application/json' \
  -d '{"userId":"<SAVED_USER_ID>","rejoinToken":"<SAVED_REJOIN_TOKEN>","roomId":123}'
```

Expected: all three return `HTTP/1.1 400 Bad Request`. The second has `error.field: "userId"`; the third has `error.field: "roomId"`.

- [ ] **Step 7: Confirm `last_seen_at` advanced on success only**

In Supabase SQL editor, run:

```sql
SELECT id, display_name, last_seen_at
FROM users
WHERE id = '<SAVED_USER_ID>';
```

Expected: `last_seen_at` is close to the time of the step-3 request and is **later** than `created_at`. Re-run after step 4 and step 5 — the value should be unchanged from the step-3 baseline (failed rejoins must not bump the timestamp).

- [ ] **Step 8: Pre-push check**

Run: `npm run pre-push`
Expected: type-check passes, all tests pass.

- [ ] **Step 9: Tick the TODO item**

Edit `TODO.md` — change the Phase 1 rejoin line from `- [ ]` to `- [x]`:

```markdown
- [x] `POST /api/auth/rejoin` — validate `{ userId, rejoinToken, roomId? }` via bcrypt compare, refresh `last_seen_at`, return session
```

Note: `TODO.md` is gitignored (per CLAUDE.md §1) — do not commit this edit.

- [ ] **Step 10: Stop the dev server**

Send SIGINT (Ctrl+C) to the `npm run dev` process from step 1.

---

## Definition of done

- All 16 `rejoinUser` unit tests pass.
- Both route-adapter smoke tests pass.
- `npm run pre-push` (type-check + full test suite) passes.
- Manual curl verification demonstrates 200 / 401 / 404 / 400 branches and confirms `last_seen_at` is bumped only on success.
- The Phase 1 rejoin item in `TODO.md` is ticked.
- No `.env*` or secrets are staged. The plaintext `rejoinToken` used in manual testing does not appear in any committed file.

---

## Out of scope (from spec §7 — do NOT do in this plan)

- `PATCH /api/auth/preferences` (Phase L0).
- Adding `preferred_locale` to the response (requires schema migration — Phase L0).
- The onboarding / rejoin UI at `/` (separate Phase 1 ticket).
- Same-name resolver flow (separate Phase 1 ticket).
- Client-side fetch wrapper that refreshes `expiresAt` on every API call.
- Auto-join the room identified by `roomId` — explicitly kept out per SPEC §4.3.
