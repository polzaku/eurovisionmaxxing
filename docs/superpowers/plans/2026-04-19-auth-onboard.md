# `POST /api/auth/onboard` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first real `POST` endpoint — create a user, return a server-generated rejoin token (plaintext to client, bcrypt-hashed in DB), establishing the test seam and error response shape used by every later API route.

**Architecture:** Three-file split. `src/lib/api-errors.ts` is a shared `apiError()` helper returning a typed `NextResponse`. `src/lib/auth/onboard.ts` is a pure handler `onboardUser(input, deps)` that takes injected dependencies (supabase client, hash function, id generators) and returns a discriminated result/error union — no Next or bcrypt or uuid imports, fully unit-testable. `src/app/api/auth/onboard/route.ts` is a thin adapter that wires real deps and translates the result union into HTTP responses.

**Tech Stack:** Next.js 14 App Router (Route Handlers), TypeScript strict, Vitest, Supabase service-role client, bcryptjs, uuid.

**Spec:** [docs/superpowers/specs/2026-04-19-auth-onboard-design.md](../specs/2026-04-19-auth-onboard-design.md)

---

## File map

| File | Purpose | Status |
|---|---|---|
| `src/lib/api-errors.ts` | Shared `apiError(code, message, status, field?)` + `ApiErrorCode` union + `ApiErrorBody` type | **Create** |
| `src/lib/auth/onboard.ts` | Pure `onboardUser(input, deps)` handler. Validation + bcrypt-hash-via-dep + supabase-insert. No Next/bcrypt/uuid imports. | **Create** |
| `src/lib/auth/onboard.test.ts` | Vitest unit tests for `onboardUser` using fake deps | **Create** |
| `src/app/api/auth/onboard/route.ts` | Thin adapter — replaces existing 501 stub | **Modify (replace stub)** |
| `src/app/api/auth/onboard/route.test.ts` | One integration-style smoke test for the route adapter | **Create** |

The validation regex, status codes, and response body shapes are defined in the spec §3 and §4 — do not improvise.

---

## Task 1: Add the shared `apiError` helper

**Files:**
- Create: `src/lib/api-errors.ts`

This helper is used by every API route from Phase 1 onwards. We're starting the union with the four codes the onboard route needs; later routes extend it.

- [ ] **Step 1: Create the helper file**

Write to `src/lib/api-errors.ts`:

```ts
import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "INVALID_BODY"
  | "INVALID_DISPLAY_NAME"
  | "INVALID_AVATAR_SEED"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; field?: string };
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): NextResponse<ApiErrorBody> {
  const body: ApiErrorBody = field
    ? { error: { code, message, field } }
    : { error: { code, message } };
  return NextResponse.json(body, { status });
}
```

- [ ] **Step 2: Run type-check**

Run: `npm run type-check`
Expected: clean exit, no errors. (No new tests yet — this helper is exercised through the route adapter test in Task 5.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/api-errors.ts
git commit -m "Add shared apiError helper for typed JSON error responses"
```

---

## Task 2: Write failing tests for the pure `onboardUser` handler

**Files:**
- Create: `src/lib/auth/onboard.test.ts`

Tests are written *first*. They will fail because `onboardUser` doesn't exist yet. Each test uses fake deps so we can assert behaviour without touching Supabase, bcrypt, or uuid.

- [ ] **Step 1: Write the full test file**

Write to `src/lib/auth/onboard.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { onboardUser, type OnboardDeps } from "@/lib/auth/onboard";

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<OnboardDeps> = {}): {
  deps: OnboardDeps;
  insertSpy: ReturnType<typeof vi.fn>;
  hashSpy: ReturnType<typeof vi.fn>;
} {
  const insertSpy = vi.fn().mockResolvedValue({ error: null });
  // Fake hash deliberately does NOT contain the plaintext, so we can assert
  // that the plaintext token never leaks into the inserted row or error responses.
  const hashSpy = vi.fn(async (_plaintext: string) => "BCRYPT_HASH_FIXED");
  const deps: OnboardDeps = {
    supabase: {
      from: vi.fn(() => ({ insert: insertSpy })),
    } as unknown as OnboardDeps["supabase"],
    hashToken: hashSpy,
    generateUserId: () => "user-uuid-fixed",
    generateRejoinToken: () => "token-uuid-fixed",
    ...overrides,
  };
  return { deps, insertSpy, hashSpy };
}

// ─── Happy path ──────────────────────────────────────────────────────────────

describe("onboardUser — happy path", () => {
  it("returns the four user fields on valid input", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: "Lia", avatarSeed: "seed-abc" },
      deps
    );
    expect(result).toEqual({
      ok: true,
      user: {
        userId: "user-uuid-fixed",
        rejoinToken: "token-uuid-fixed",
        displayName: "Lia",
        avatarSeed: "seed-abc",
      },
    });
  });

  it("inserts the bcrypt hash, never the plaintext token", async () => {
    const { deps, insertSpy, hashSpy } = makeDeps();
    await onboardUser({ displayName: "Lia", avatarSeed: "seed-abc" }, deps);
    expect(hashSpy).toHaveBeenCalledWith("token-uuid-fixed");
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const insertedRow = insertSpy.mock.calls[0][0];
    expect(insertedRow).toMatchObject({
      id: "user-uuid-fixed",
      display_name: "Lia",
      avatar_seed: "seed-abc",
      rejoin_token_hash: "BCRYPT_HASH_FIXED",
    });
    // Crucial: the plaintext token must not appear in the DB row
    expect(JSON.stringify(insertedRow)).not.toContain("token-uuid-fixed");
  });

  it("trims leading and trailing whitespace from displayName", async () => {
    const { deps, insertSpy } = makeDeps();
    const result = await onboardUser(
      { displayName: "   Lia   ", avatarSeed: "seed-abc" },
      deps
    );
    expect(result).toMatchObject({ ok: true, user: { displayName: "Lia" } });
    expect(insertSpy.mock.calls[0][0].display_name).toBe("Lia");
  });

  it("collapses internal whitespace in displayName", async () => {
    const { deps, insertSpy } = makeDeps();
    const result = await onboardUser(
      { displayName: "Lia  Bear", avatarSeed: "seed-abc" },
      deps
    );
    expect(result).toMatchObject({ ok: true, user: { displayName: "Lia Bear" } });
    expect(insertSpy.mock.calls[0][0].display_name).toBe("Lia Bear");
  });

  it("accepts a 24-char displayName", async () => {
    const { deps } = makeDeps();
    const name = "A".repeat(24);
    const result = await onboardUser({ displayName: name, avatarSeed: "x" }, deps);
    expect(result).toMatchObject({ ok: true, user: { displayName: name } });
  });

  it("accepts a 2-char displayName", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser({ displayName: "Li", avatarSeed: "x" }, deps);
    expect(result).toMatchObject({ ok: true, user: { displayName: "Li" } });
  });

  it("accepts hyphens in displayName", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: "Mary-Jane", avatarSeed: "x" },
      deps
    );
    expect(result).toMatchObject({ ok: true, user: { displayName: "Mary-Jane" } });
  });
});

// ─── Validation failures ─────────────────────────────────────────────────────

describe("onboardUser — body validation", () => {
  it("rejects missing displayName as INVALID_BODY", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { avatarSeed: "x" } as unknown as Parameters<typeof onboardUser>[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY" },
    });
  });

  it("rejects missing avatarSeed as INVALID_BODY", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: "Lia" } as unknown as Parameters<typeof onboardUser>[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY" },
    });
  });

  it("rejects non-string displayName as INVALID_BODY", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: 42, avatarSeed: "x" } as unknown as Parameters<
        typeof onboardUser
      >[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY" },
    });
  });
});

describe("onboardUser — displayName validation", () => {
  it("rejects 1-char trimmed name as INVALID_DISPLAY_NAME", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser({ displayName: "L", avatarSeed: "x" }, deps);
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_DISPLAY_NAME", field: "displayName" },
    });
  });

  it("rejects 25-char name as INVALID_DISPLAY_NAME", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: "A".repeat(25), avatarSeed: "x" },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_DISPLAY_NAME", field: "displayName" },
    });
  });

  it("rejects whitespace-only name (trims to empty) as INVALID_DISPLAY_NAME", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: "     ", avatarSeed: "x" },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_DISPLAY_NAME", field: "displayName" },
    });
  });

  it("rejects punctuation in name", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: "Lia!", avatarSeed: "x" },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_DISPLAY_NAME", field: "displayName" },
    });
  });

  it("rejects HTML-like characters in name", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: "<script>", avatarSeed: "x" },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_DISPLAY_NAME", field: "displayName" },
    });
  });

  it("rejects emoji in name", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: "Lia🎤", avatarSeed: "x" },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_DISPLAY_NAME", field: "displayName" },
    });
  });
});

describe("onboardUser — avatarSeed validation", () => {
  it("rejects empty avatarSeed as INVALID_AVATAR_SEED", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser({ displayName: "Lia", avatarSeed: "" }, deps);
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_AVATAR_SEED", field: "avatarSeed" },
    });
  });

  it("rejects 65-char avatarSeed as INVALID_AVATAR_SEED", async () => {
    const { deps } = makeDeps();
    const result = await onboardUser(
      { displayName: "Lia", avatarSeed: "x".repeat(65) },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_AVATAR_SEED", field: "avatarSeed" },
    });
  });

  it("accepts a 64-char avatarSeed (boundary)", async () => {
    const { deps } = makeDeps();
    const seed = "x".repeat(64);
    const result = await onboardUser({ displayName: "Lia", avatarSeed: seed }, deps);
    expect(result).toMatchObject({ ok: true, user: { avatarSeed: seed } });
  });
});

// ─── Supabase failure path ───────────────────────────────────────────────────

describe("onboardUser — supabase errors", () => {
  it("returns INTERNAL_ERROR 500 when supabase insert fails", async () => {
    const { deps } = makeDeps({});
    (deps.supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      {
        insert: vi.fn().mockResolvedValue({
          error: { message: "duplicate key value violates unique constraint" },
        }),
      }
    );
    const result = await onboardUser(
      { displayName: "Lia", avatarSeed: "x" },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("never includes the plaintext rejoin token in the error response", async () => {
    const { deps } = makeDeps();
    (deps.supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      {
        insert: vi.fn().mockResolvedValue({ error: { message: "boom" } }),
      }
    );
    const result = await onboardUser(
      { displayName: "Lia", avatarSeed: "x" },
      deps
    );
    expect(JSON.stringify(result)).not.toContain("token-uuid-fixed");
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm test -- src/lib/auth/onboard.test.ts`
Expected: All tests fail with module-resolution error like `Cannot find module '@/lib/auth/onboard'` or "Failed to load url". This is the "fails for the right reason" check — the file doesn't exist yet.

- [ ] **Step 3: Commit the failing tests**

```bash
git add src/lib/auth/onboard.test.ts
git commit -m "Add failing tests for onboardUser pure handler"
```

---

## Task 3: Implement the pure `onboardUser` handler

**Files:**
- Create: `src/lib/auth/onboard.ts`

This is where the validation, normalization, hashing, and insert happen. No `NextResponse`, no `bcrypt`, no `uuid` imports — only types and the `Database` type.

- [ ] **Step 1: Write the implementation**

Write to `src/lib/auth/onboard.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";

const DISPLAY_NAME_REGEX = /^[A-Za-z0-9 \-]{2,24}$/;
const AVATAR_SEED_MAX_LEN = 64;

export interface OnboardInput {
  displayName: unknown;
  avatarSeed: unknown;
}

export interface OnboardDeps {
  supabase: SupabaseClient<Database>;
  hashToken: (plaintext: string) => Promise<string>;
  generateUserId: () => string;
  generateRejoinToken: () => string;
}

export interface OnboardSuccess {
  ok: true;
  user: {
    userId: string;
    rejoinToken: string;
    displayName: string;
    avatarSeed: string;
  };
}

export interface OnboardFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type OnboardResult = OnboardSuccess | OnboardFailure;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): OnboardFailure {
  return { ok: false, error: field ? { code, message, field } : { code, message }, status };
}

function normalizeDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export async function onboardUser(
  input: OnboardInput,
  deps: OnboardDeps
): Promise<OnboardResult> {
  // Body shape
  if (typeof input.displayName !== "string" || typeof input.avatarSeed !== "string") {
    return fail("INVALID_BODY", "Request body must include displayName and avatarSeed strings.", 400);
  }

  // Display name validation
  const displayName = normalizeDisplayName(input.displayName);
  if (!DISPLAY_NAME_REGEX.test(displayName)) {
    return fail(
      "INVALID_DISPLAY_NAME",
      "displayName must be 2–24 characters and contain only letters, numbers, spaces, or hyphens.",
      400,
      "displayName"
    );
  }

  // Avatar seed validation
  const avatarSeed = input.avatarSeed;
  if (avatarSeed.length < 1 || avatarSeed.length > AVATAR_SEED_MAX_LEN) {
    return fail(
      "INVALID_AVATAR_SEED",
      `avatarSeed must be 1–${AVATAR_SEED_MAX_LEN} characters.`,
      400,
      "avatarSeed"
    );
  }

  // Generate ids and hash the rejoin token
  const userId = deps.generateUserId();
  const rejoinToken = deps.generateRejoinToken();
  const rejoinTokenHash = await deps.hashToken(rejoinToken);

  // Insert
  const { error } = await deps.supabase.from("users").insert({
    id: userId,
    display_name: displayName,
    avatar_seed: avatarSeed,
    rejoin_token_hash: rejoinTokenHash,
  });

  if (error) {
    // Server-side log (route adapter may want to log too — kept minimal here)
    return fail("INTERNAL_ERROR", "Could not create user. Please try again.", 500);
  }

  return {
    ok: true,
    user: { userId, rejoinToken, displayName, avatarSeed },
  };
}
```

- [ ] **Step 2: Run the tests to confirm they pass**

Run: `npm test -- src/lib/auth/onboard.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Run type-check**

Run: `npm run type-check`
Expected: clean exit.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/onboard.ts
git commit -m "Implement onboardUser pure handler with validation and bcrypt hash"
```

---

## Task 4: Replace the route stub with the thin adapter

**Files:**
- Modify: `src/app/api/auth/onboard/route.ts`

Replace the existing 501-stub with a thin adapter that wires real deps and translates the result union into HTTP responses.

- [ ] **Step 1: Replace the route file**

Overwrite `src/app/api/auth/onboard/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { onboardUser } from "@/lib/auth/onboard";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

const BCRYPT_ROUNDS = 10;

/**
 * POST /api/auth/onboard
 * Create a new user and return { userId, rejoinToken, displayName, avatarSeed }.
 * The plaintext rejoinToken is returned to the client only here; only the bcrypt
 * hash is persisted.
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

  const result = await onboardUser(body as { displayName: unknown; avatarSeed: unknown }, {
    supabase: createServiceClient(),
    hashToken: (plaintext) => bcrypt.hash(plaintext, BCRYPT_ROUNDS),
    generateUserId: uuidv4,
    generateRejoinToken: uuidv4,
  });

  if (result.ok) {
    return NextResponse.json(result.user, { status: 201 });
  }
  return apiError(result.error.code, result.error.message, result.status, result.error.field);
}
```

- [ ] **Step 2: Run type-check**

Run: `npm run type-check`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/onboard/route.ts
git commit -m "Wire POST /api/auth/onboard route adapter to onboardUser"
```

---

## Task 5: Add a route-level smoke test

**Files:**
- Create: `src/app/api/auth/onboard/route.test.ts`

One integration-style test confirming the wiring (parse body → call handler → return 201 with the right shape). All deeper logic is already covered by Task 2; this is the wiring sanity check only.

- [ ] **Step 1: Write the test**

Write to `src/app/api/auth/onboard/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase server client BEFORE importing the route
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
    })),
  }),
}));

import { POST } from "@/app/api/auth/onboard/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/onboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/onboard (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 201 with the four user fields on valid input", async () => {
    const res = await POST(
      makeRequest({ displayName: "Lia Bear", avatarSeed: "seed-xyz" })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      userId: expect.any(String),
      rejoinToken: expect.any(String),
      displayName: "Lia Bear",
      avatarSeed: "seed-xyz",
    });
    // userId and rejoinToken are real UUIDs (server-generated, not echoed from the request)
    expect(body.userId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(body.rejoinToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("returns 400 INVALID_BODY when the body is not JSON", async () => {
    const req = new NextRequest("http://localhost/api/auth/onboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json{{{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 400 INVALID_DISPLAY_NAME with field on bad name", async () => {
    const res = await POST(makeRequest({ displayName: "L", avatarSeed: "x" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; field?: string };
    };
    expect(body.error.code).toBe("INVALID_DISPLAY_NAME");
    expect(body.error.field).toBe("displayName");
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- src/app/api/auth/onboard/route.test.ts`
Expected: All three tests pass.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: All tests pass — onboard handler, route adapter, scoring smoke, and any others.

- [ ] **Step 4: Run type-check**

Run: `npm run type-check`
Expected: clean exit.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/onboard/route.test.ts
git commit -m "Add route-level smoke test for /api/auth/onboard"
```

---

## Task 6: Manual end-to-end verification

Per CLAUDE.md "verify before completing" — confirm the route works against a real Supabase instance before marking the TODO item done.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: Server boots on http://localhost:3000 with no errors.

- [ ] **Step 2: Hit the route with a valid body**

In a second terminal:

```bash
curl -i -X POST http://localhost:3000/api/auth/onboard \
  -H 'content-type: application/json' \
  -d '{"displayName":"Test User","avatarSeed":"test-seed-123"}'
```

Expected: `HTTP/1.1 201 Created` and a JSON body with `userId`, `rejoinToken`, `displayName: "Test User"`, `avatarSeed: "test-seed-123"`. Both `userId` and `rejoinToken` should be UUID v4 strings.

- [ ] **Step 3: Confirm the row in Supabase**

In the Supabase SQL Editor, run:

```sql
SELECT id, display_name, avatar_seed, rejoin_token_hash, length(rejoin_token_hash) AS hash_len
FROM users
ORDER BY created_at DESC
LIMIT 1;
```

Expected: One row matching the userId from step 2. `rejoin_token_hash` starts with `$2` (bcrypt prefix) and has length 60. `display_name` is exactly `"Test User"`. The plaintext token from step 2 must NOT appear anywhere in the row.

- [ ] **Step 4: Hit the route with a bad body — bad name**

```bash
curl -i -X POST http://localhost:3000/api/auth/onboard \
  -H 'content-type: application/json' \
  -d '{"displayName":"L","avatarSeed":"x"}'
```

Expected: `HTTP/1.1 400 Bad Request` and body
`{"error":{"code":"INVALID_DISPLAY_NAME","message":"...","field":"displayName"}}`.

- [ ] **Step 5: Hit the route with a bad body — non-JSON**

```bash
curl -i -X POST http://localhost:3000/api/auth/onboard \
  -H 'content-type: application/json' \
  -d 'not json'
```

Expected: `HTTP/1.1 400 Bad Request` and body `{"error":{"code":"INVALID_BODY","message":"..."}}` (no `field`).

- [ ] **Step 6: Hit the route with a bad body — missing field**

```bash
curl -i -X POST http://localhost:3000/api/auth/onboard \
  -H 'content-type: application/json' \
  -d '{"displayName":"Lia"}'
```

Expected: `HTTP/1.1 400 Bad Request`, code `INVALID_BODY`.

- [ ] **Step 7: Tick TODO.md**

In `TODO.md` under Phase 1, change:

```md
- [ ] `POST /api/auth/onboard` — create user, bcrypt-hash rejoin token, return `{ userId, rejoinToken, displayName, avatarSeed }`
```

to:

```md
- [x] `POST /api/auth/onboard` — create user, bcrypt-hash rejoin token, return `{ userId, rejoinToken, displayName, avatarSeed }`
```

(Recall `TODO.md` is gitignored — this is a local-only change.)

---

## Definition of done for this plan

- All Vitest tests in `src/lib/auth/onboard.test.ts` and `src/app/api/auth/onboard/route.test.ts` pass.
- `npm run type-check` is clean.
- The manual `curl` checks from Task 6 succeed against a real Supabase instance.
- A user row exists with a 60-char bcrypt `rejoin_token_hash` that does not contain the plaintext token.
- `TODO.md` Phase 1 first item is ticked.
- No new dependencies added (`bcryptjs`, `uuid`, `@supabase/supabase-js` are already in `package.json`).
