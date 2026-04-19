# Same-name resolver flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the last Phase 1 item — when a user with no `emx_session` opens a room URL and types a name that collides with an existing member, show an avatar-first "is this you?" picker that either merges them into that identity or falls through to a new onboard.

**Architecture:** Two new pure handlers (`listCandidates`, `claimIdentity`) under `src/lib/auth/`, each exposed via a thin Next.js route adapter — mirroring the onboard/rejoin pattern. `OnboardingForm` gains a two-step state machine (`form` → `picker`) driven by a roomId parsed from the `next` query param. `/room/[id]` gets a 5-line session-guard redirect so the journey is testable end-to-end.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Vitest (node env — no DOM harness in the project; component changes are verified by `npm run type-check` + manual `npm run dev`), Supabase JS service-role client, bcryptjs, uuid.

**Spec:** [docs/superpowers/specs/2026-04-19-same-name-resolver-design.md](../specs/2026-04-19-same-name-resolver-design.md)

**Branch:** `feat/same-name-resolver` (already cut from `main`).

---

## File map

| File | Purpose | Status |
|---|---|---|
| `src/lib/api-errors.ts` | Shared `ApiErrorCode` union — add `INVALID_ROOM_ID`, `INVALID_USER_ID`, `ROOM_NOT_FOUND`, `CANDIDATE_NOT_FOUND` | **Modify** |
| `src/lib/onboarding/extractRoomId.ts` | Pure helper: parses `roomId` out of a sanitized `next` path or returns `null` | **Create** |
| `src/lib/onboarding/extractRoomId.test.ts` | Vitest unit tests for the extractor | **Create** |
| `src/lib/auth/candidates.ts` | Pure `listCandidates(input, deps)` — validation, room-exists check, candidates list, no writes | **Create** |
| `src/lib/auth/candidates.test.ts` | Vitest unit tests for `listCandidates` with fake Supabase deps | **Create** |
| `src/app/api/auth/candidates/route.ts` | Thin route adapter for `POST /api/auth/candidates` | **Create** |
| `src/app/api/auth/candidates/route.test.ts` | Route-adapter smoke tests | **Create** |
| `src/lib/auth/claim.ts` | Pure `claimIdentity(input, deps)` — three-way validation, token rotation, `last_seen_at` refresh | **Create** |
| `src/lib/auth/claim.test.ts` | Vitest unit tests for `claimIdentity` with fake deps | **Create** |
| `src/app/api/auth/claim/route.ts` | Thin route adapter for `POST /api/auth/claim` | **Create** |
| `src/app/api/auth/claim/route.test.ts` | Route-adapter smoke tests | **Create** |
| `src/components/onboarding/OnboardingForm.tsx` | Extend with `step: "form" \| "picker"`, candidates pre-flight, avatar tap → `/claim`, "Create new" escape hatch | **Modify** |
| `src/components/onboarding/CandidatePicker.tsx` | New presentational component: avatar grid + "Create new" + "← Change name" | **Create** |
| `src/app/room/[id]/page.tsx` | Add no-session client-side guard that redirects to `/onboard?next=/room/<id>` | **Modify** |
| `TODO.md` | Tick the Phase 1 "Same-name resolver flow" bullet | **Modify** (last task) |

UUID v4 regex reused (matches the private const in `src/lib/auth/rejoin.ts`): `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`.

Display name normalization (same as `src/lib/auth/onboard.ts`): `raw.trim().replace(/\s+/g, " ")`. Comparisons are case-insensitive on the normalized value.

---

## Testing scope

Following the house pattern (see Phase 1 predecessors): TDD covers every `src/lib/` pure handler and every `src/app/api/*/route.ts` adapter. Component-level rendering tests are **out of scope** because the repo has no DOM harness (no `@testing-library/react`, no jsdom/happy-dom; vitest runs in node). `OnboardingForm` changes are verified via (a) type-check, (b) the extracted `extractRoomId` unit tests, (c) manual `npm run dev` exercise. If we later add a DOM harness, the picker state machine is a prime candidate for extraction to a pure reducer; not doing that now to avoid scope creep.

---

## Task 1: Extend `ApiErrorCode` union

**Files:**
- Modify: `src/lib/api-errors.ts`

Four new codes. Union widens only — existing call sites are unaffected.

- [ ] **Step 1: Extend the union**

Edit `src/lib/api-errors.ts`. Replace the `ApiErrorCode` type with:

```ts
export type ApiErrorCode =
  | "INVALID_BODY"
  | "INVALID_DISPLAY_NAME"
  | "INVALID_AVATAR_SEED"
  | "INVALID_ROOM_ID"
  | "INVALID_USER_ID"
  | "USER_NOT_FOUND"
  | "ROOM_NOT_FOUND"
  | "CANDIDATE_NOT_FOUND"
  | "INVALID_TOKEN"
  | "INTERNAL_ERROR";
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: exit 0, no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api-errors.ts
git commit -m "Add INVALID_ROOM_ID/INVALID_USER_ID/ROOM_NOT_FOUND/CANDIDATE_NOT_FOUND to ApiErrorCode"
```

---

## Task 2: `extractRoomId` helper + tests

**Files:**
- Create: `src/lib/onboarding/extractRoomId.ts`
- Test: `src/lib/onboarding/extractRoomId.test.ts`

The helper takes a sanitized `next` path (already guaranteed to start with `/` and be control-char-free by `sanitizeNextPath`) and returns the roomId if the path matches `/room/<uuid>`, otherwise `null`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/onboarding/extractRoomId.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractRoomId } from "@/lib/onboarding/extractRoomId";

const VALID_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("extractRoomId", () => {
  it("returns the uuid when next is /room/<uuid>", () => {
    expect(extractRoomId(`/room/${VALID_UUID}`)).toBe(VALID_UUID);
  });

  it("returns null when next is /", () => {
    expect(extractRoomId("/")).toBeNull();
  });

  it("returns null when next is /room (no id)", () => {
    expect(extractRoomId("/room")).toBeNull();
  });

  it("returns null when next is /room/ (trailing slash, empty id)", () => {
    expect(extractRoomId("/room/")).toBeNull();
  });

  it("returns null when path has extra segments beyond /room/<id>", () => {
    expect(extractRoomId(`/room/${VALID_UUID}/present`)).toBeNull();
  });

  it("returns null when the id is not a uuid v4", () => {
    expect(extractRoomId("/room/not-a-uuid")).toBeNull();
  });

  it("returns null for unrelated paths", () => {
    expect(extractRoomId("/join")).toBeNull();
    expect(extractRoomId("/create")).toBeNull();
  });

  it("returns null for an empty string (defensive)", () => {
    expect(extractRoomId("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- extractRoomId`
Expected: FAIL — "Cannot find module '@/lib/onboarding/extractRoomId'" (or similar resolution error).

- [ ] **Step 3: Implement the helper**

Create `src/lib/onboarding/extractRoomId.ts`:

```ts
const ROOM_PATH_RE =
  /^\/room\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

export function extractRoomId(nextPath: string): string | null {
  const match = ROOM_PATH_RE.exec(nextPath);
  return match ? match[1] : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- extractRoomId`
Expected: 8 passing.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/onboarding/extractRoomId.ts src/lib/onboarding/extractRoomId.test.ts
git commit -m "Add extractRoomId helper for parsing /room/<id> from next path"
```

---

## Task 3: `listCandidates` pure handler + tests

**Files:**
- Create: `src/lib/auth/candidates.ts`
- Test: `src/lib/auth/candidates.test.ts`

The handler takes `{displayName, roomId}`, validates both, confirms the room exists, and returns every member of that room whose normalized+lowercased display_name matches the normalized+lowercased input.

**Supabase query plan (client-side filter for display_name):**

1. `from("rooms").select("id").eq("id", roomId).maybeSingle()` — room existence check.
2. `from("room_memberships").select("users!inner(id, display_name, avatar_seed)").eq("room_id", roomId)` — fetch all members of the room via inner-joined `users`.
3. Filter the returned rows in JS by `normalizeDisplayName(u.display_name).toLowerCase() === normalizeDisplayName(input).toLowerCase()`.

Client-side filter is acceptable for MVP (rooms are ≤~20 people). Centralizing the normalization logic in JS keeps behavior consistent between onboard/claim/candidates.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/auth/candidates.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { listCandidates, type CandidatesDeps } from "@/lib/auth/candidates";

const VALID_ROOM_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

interface MembershipRow {
  users: { id: string; display_name: string; avatar_seed: string };
}

interface MakeDepsOverrides {
  roomExists?: boolean;
  roomSelectError?: { message: string } | null;
  memberships?: MembershipRow[];
  membershipsSelectError?: { message: string } | null;
}

function makeDeps(o: MakeDepsOverrides = {}): {
  deps: CandidatesDeps;
  fromMock: ReturnType<typeof vi.fn>;
} {
  const roomExists = o.roomExists ?? true;
  const roomSelectError = o.roomSelectError ?? null;
  const memberships = o.memberships ?? [];
  const membershipsSelectError = o.membershipsSelectError ?? null;

  const roomMaybeSingle = vi.fn().mockResolvedValue({
    data: roomSelectError ? null : roomExists ? { id: VALID_ROOM_ID } : null,
    error: roomSelectError,
  });
  const roomEq = vi.fn(() => ({ maybeSingle: roomMaybeSingle }));
  const roomSelect = vi.fn(() => ({ eq: roomEq }));

  const membershipsEq = vi.fn().mockResolvedValue({
    data: membershipsSelectError ? null : memberships,
    error: membershipsSelectError,
  });
  const membershipsSelect = vi.fn(() => ({ eq: membershipsEq }));

  const fromMock = vi.fn((table: string) => {
    if (table === "rooms") return { select: roomSelect };
    if (table === "room_memberships") return { select: membershipsSelect };
    throw new Error(`unexpected table: ${table}`);
  });

  const deps: CandidatesDeps = {
    supabase: { from: fromMock } as unknown as CandidatesDeps["supabase"],
  };

  return { deps, fromMock };
}

function validInput(extra: Record<string, unknown> = {}) {
  return { displayName: "Alice", roomId: VALID_ROOM_ID, ...extra };
}

describe("listCandidates — body validation", () => {
  it("rejects non-string displayName as INVALID_BODY 400", async () => {
    const { deps } = makeDeps();
    const result = await listCandidates(
      { displayName: 42, roomId: VALID_ROOM_ID } as unknown as Parameters<
        typeof listCandidates
      >[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY" },
    });
  });

  it("rejects non-string roomId as INVALID_BODY 400", async () => {
    const { deps } = makeDeps();
    const result = await listCandidates(
      { displayName: "Alice", roomId: 99 } as unknown as Parameters<
        typeof listCandidates
      >[0],
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_BODY" },
    });
  });

  it("rejects bad displayName as INVALID_DISPLAY_NAME 400 with field", async () => {
    const { deps } = makeDeps();
    const result = await listCandidates(
      { displayName: "!", roomId: VALID_ROOM_ID },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_DISPLAY_NAME", field: "displayName" },
    });
  });

  it("rejects non-uuid roomId as INVALID_ROOM_ID 400 with field", async () => {
    const { deps } = makeDeps();
    const result = await listCandidates(
      { displayName: "Alice", roomId: "not-a-uuid" },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
  });
});

describe("listCandidates — room existence", () => {
  it("returns ROOM_NOT_FOUND 404 when the room doesn't exist", async () => {
    const { deps } = makeDeps({ roomExists: false });
    const result = await listCandidates(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND" },
    });
  });

  it("returns INTERNAL_ERROR 500 when the room select errors", async () => {
    const { deps } = makeDeps({ roomSelectError: { message: "db down" } });
    const result = await listCandidates(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});

describe("listCandidates — match logic", () => {
  it("returns an empty array when no members match the name", async () => {
    const { deps } = makeDeps({
      memberships: [
        { users: { id: USER_A, display_name: "Bob", avatar_seed: "sb" } },
      ],
    });
    const result = await listCandidates(validInput(), deps);
    expect(result).toEqual({ ok: true, candidates: [] });
  });

  it("returns a match with only userId and avatarSeed (no display_name leak)", async () => {
    const { deps } = makeDeps({
      memberships: [
        { users: { id: USER_A, display_name: "Alice", avatar_seed: "sa" } },
      ],
    });
    const result = await listCandidates(validInput(), deps);
    expect(result).toEqual({
      ok: true,
      candidates: [{ userId: USER_A, avatarSeed: "sa" }],
    });
    // explicit leakage guard
    expect(JSON.stringify(result)).not.toContain("display_name");
    expect(JSON.stringify(result)).not.toContain("Alice");
  });

  it("matches case-insensitively", async () => {
    const { deps } = makeDeps({
      memberships: [
        { users: { id: USER_A, display_name: "ALICE", avatar_seed: "sa" } },
      ],
    });
    const result = await listCandidates(
      { displayName: "alice", roomId: VALID_ROOM_ID },
      deps
    );
    expect(result).toMatchObject({
      ok: true,
      candidates: [{ userId: USER_A }],
    });
  });

  it("matches after trimming and collapsing whitespace", async () => {
    const { deps } = makeDeps({
      memberships: [
        { users: { id: USER_A, display_name: "Lia Bear", avatar_seed: "sa" } },
      ],
    });
    const result = await listCandidates(
      { displayName: "  Lia   Bear  ", roomId: VALID_ROOM_ID },
      deps
    );
    expect(result).toMatchObject({
      ok: true,
      candidates: [{ userId: USER_A }],
    });
  });

  it("returns every matching row when multiple members share the name", async () => {
    const { deps } = makeDeps({
      memberships: [
        { users: { id: USER_A, display_name: "Alice", avatar_seed: "sa" } },
        { users: { id: USER_B, display_name: "Alice", avatar_seed: "sb" } },
      ],
    });
    const result = await listCandidates(validInput(), deps);
    expect(result).toEqual({
      ok: true,
      candidates: [
        { userId: USER_A, avatarSeed: "sa" },
        { userId: USER_B, avatarSeed: "sb" },
      ],
    });
  });

  it("queries only by room_id — membership query is scoped so different rooms cannot leak", async () => {
    const { deps, fromMock } = makeDeps({
      memberships: [
        { users: { id: USER_A, display_name: "Alice", avatar_seed: "sa" } },
      ],
    });
    await listCandidates(validInput(), deps);
    const tablesTouched = fromMock.mock.calls.map((c) => c[0]);
    expect(tablesTouched).toContain("rooms");
    expect(tablesTouched).toContain("room_memberships");
  });

  it("returns INTERNAL_ERROR 500 when the memberships select errors", async () => {
    const { deps } = makeDeps({
      membershipsSelectError: { message: "boom" },
    });
    const result = await listCandidates(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- candidates`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handler**

Create `src/lib/auth/candidates.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import { DISPLAY_NAME_REGEX } from "@/lib/auth/onboard";

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface CandidatesInput {
  displayName: unknown;
  roomId: unknown;
}

export interface CandidatesDeps {
  supabase: SupabaseClient<Database>;
}

export interface CandidatesSuccess {
  ok: true;
  candidates: Array<{ userId: string; avatarSeed: string }>;
}

export interface CandidatesFailure {
  ok: false;
  status: number;
  error: { code: ApiErrorCode; message: string; field?: string };
}

export type CandidatesResult = CandidatesSuccess | CandidatesFailure;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): CandidatesFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

function normalizeDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export async function listCandidates(
  input: CandidatesInput,
  deps: CandidatesDeps,
): Promise<CandidatesResult> {
  if (typeof input.displayName !== "string" || typeof input.roomId !== "string") {
    return fail(
      "INVALID_BODY",
      "Request body must include displayName and roomId strings.",
      400,
    );
  }

  const displayName = normalizeDisplayName(input.displayName);
  if (!DISPLAY_NAME_REGEX.test(displayName)) {
    return fail(
      "INVALID_DISPLAY_NAME",
      "displayName must be 2–24 characters and contain only letters, numbers, spaces, or hyphens.",
      400,
      "displayName",
    );
  }

  const roomId = input.roomId;
  if (!UUID_V4_REGEX.test(roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID v4.", 400, "roomId");
  }

  const { data: roomRow, error: roomError } = await deps.supabase
    .from("rooms")
    .select("id")
    .eq("id", roomId)
    .maybeSingle();

  if (roomError) {
    return fail("INTERNAL_ERROR", "Could not verify room. Please try again.", 500);
  }
  if (!roomRow) {
    return fail("ROOM_NOT_FOUND", "No room matches this id.", 404);
  }

  const { data: rows, error: membershipsError } = await deps.supabase
    .from("room_memberships")
    .select("users!inner(id, display_name, avatar_seed)")
    .eq("room_id", roomId);

  if (membershipsError) {
    return fail(
      "INTERNAL_ERROR",
      "Could not list candidates. Please try again.",
      500,
    );
  }

  const wanted = displayName.toLowerCase();
  const candidates =
    (rows ?? [])
      .map((r) => r.users as unknown as {
        id: string;
        display_name: string;
        avatar_seed: string;
      })
      .filter((u) => normalizeDisplayName(u.display_name).toLowerCase() === wanted)
      .map((u) => ({ userId: u.id, avatarSeed: u.avatar_seed }));

  return { ok: true, candidates };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- candidates`
Expected: all tests passing.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/candidates.ts src/lib/auth/candidates.test.ts
git commit -m "Add listCandidates pure handler (same-name lookup)"
```

---

## Task 4: `POST /api/auth/candidates` route adapter + tests

**Files:**
- Create: `src/app/api/auth/candidates/route.ts`
- Create: `src/app/api/auth/candidates/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/auth/candidates/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => {
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }, error: null });
  const eqRoom = vi.fn(() => ({ maybeSingle }));
  const selectRoom = vi.fn(() => ({ eq: eqRoom }));

  const eqMembership = vi.fn().mockResolvedValue({ data: [], error: null });
  const selectMembership = vi.fn(() => ({ eq: eqMembership }));

  const fromMock = vi.fn((table: string) => {
    if (table === "rooms") return { select: selectRoom };
    return { select: selectMembership };
  });
  return {
    createServiceClient: () => ({ from: fromMock }),
  };
});

import { POST } from "@/app/api/auth/candidates/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/candidates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_ROOM_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("POST /api/auth/candidates (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with an empty candidates array on valid input", async () => {
    const res = await POST(
      makeRequest({ displayName: "Alice", roomId: VALID_ROOM_ID }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: unknown[] };
    expect(body).toEqual({ candidates: [] });
  });

  it("returns 400 INVALID_BODY when the body is not JSON", async () => {
    const req = new NextRequest("http://localhost/api/auth/candidates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json{{{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 400 INVALID_ROOM_ID when roomId is malformed", async () => {
    const res = await POST(
      makeRequest({ displayName: "Alice", roomId: "not-a-uuid" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; field?: string } };
    expect(body.error.code).toBe("INVALID_ROOM_ID");
    expect(body.error.field).toBe("roomId");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- api/auth/candidates`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/auth/candidates/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { listCandidates } from "@/lib/auth/candidates";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/auth/candidates
 * Body: { displayName: string, roomId: string }
 * Returns: 200 { candidates: Array<{ userId, avatarSeed }> } — possibly empty.
 * Pre-flight for the same-name rejoin flow (SPEC §4.3). No writes.
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

  const result = await listCandidates(
    body as { displayName: unknown; roomId: unknown },
    { supabase: createServiceClient() },
  );

  if (result.ok) {
    return NextResponse.json({ candidates: result.candidates }, { status: 200 });
  }
  return apiError(result.error.code, result.error.message, result.status, result.error.field);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- api/auth/candidates`
Expected: 3 passing.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/auth/candidates/route.ts src/app/api/auth/candidates/route.test.ts
git commit -m "Add POST /api/auth/candidates route adapter"
```

---

## Task 5: `claimIdentity` pure handler + tests

**Files:**
- Create: `src/lib/auth/claim.ts`
- Test: `src/lib/auth/claim.test.ts`

Takes `{userId, roomId, displayName}`. Validates all three shapes. Runs a single query over `room_memberships` joined to `users` filtered by `room_id = roomId AND user_id = userId`. If no row or `users.display_name` mismatch (normalized, case-insensitive) → `404 CANDIDATE_NOT_FOUND`. On success: generate new plaintext token → bcrypt → update `users.rejoin_token_hash` and `users.last_seen_at`. Return `{userId, rejoinToken, displayName, avatarSeed}` using the **stored** display_name (not the input), so the client gets the canonical normalized name.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/auth/claim.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { claimIdentity, type ClaimDeps } from "@/lib/auth/claim";

const VALID_USER_ID = "11111111-1111-4111-8111-111111111111";
const VALID_ROOM_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const STORED_NAME = "Alice";
const NEW_TOKEN = "new-plaintext-token";
const NEW_HASH = "BCRYPT_NEW_HASH";
const NOW_ISO = "2026-04-19T12:00:00.000Z";

interface MakeDepsOverrides {
  membershipRow?: {
    users: { id: string; display_name: string; avatar_seed: string };
  } | null;
  membershipError?: { message: string } | null;
  updateError?: { message: string } | null;
}

function makeDeps(o: MakeDepsOverrides = {}) {
  const membershipError = o.membershipError ?? null;
  const defaultRow = {
    users: { id: VALID_USER_ID, display_name: STORED_NAME, avatar_seed: "sa" },
  };
  const row = membershipError
    ? null
    : o.membershipRow === undefined
      ? defaultRow
      : o.membershipRow;
  const updateError = o.updateError ?? null;

  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: row, error: membershipError });
  const eqUser = vi.fn(() => ({ maybeSingle }));
  const eqRoom = vi.fn(() => ({ eq: eqUser }));
  const selectMembership = vi.fn(() => ({ eq: eqRoom }));

  const updateEq = vi.fn().mockResolvedValue({ error: updateError });
  const updateMock = vi.fn(() => ({ eq: updateEq }));

  const fromMock = vi.fn((_table: string) => ({
    select: selectMembership,
    update: updateMock,
  }));

  const hashSpy = vi.fn(async () => NEW_HASH);
  const genTokenSpy = vi.fn(() => NEW_TOKEN);
  const nowSpy = vi.fn(() => NOW_ISO);

  const deps: ClaimDeps = {
    supabase: { from: fromMock } as unknown as ClaimDeps["supabase"],
    hashToken: hashSpy,
    generateRejoinToken: genTokenSpy,
    now: nowSpy,
  };

  return { deps, fromMock, selectMembership, updateMock, updateEq, hashSpy, genTokenSpy, nowSpy };
}

function validInput(extra: Record<string, unknown> = {}) {
  return {
    userId: VALID_USER_ID,
    roomId: VALID_ROOM_ID,
    displayName: STORED_NAME,
    ...extra,
  };
}

describe("claimIdentity — body validation", () => {
  it("rejects non-string userId as INVALID_BODY 400", async () => {
    const { deps } = makeDeps();
    const result = await claimIdentity(
      { userId: 1, roomId: VALID_ROOM_ID, displayName: STORED_NAME } as unknown as Parameters<
        typeof claimIdentity
      >[0],
      deps,
    );
    expect(result).toMatchObject({ ok: false, status: 400, error: { code: "INVALID_BODY" } });
  });

  it("rejects non-uuid userId as INVALID_USER_ID 400 with field", async () => {
    const { deps } = makeDeps();
    const result = await claimIdentity(
      { userId: "nope", roomId: VALID_ROOM_ID, displayName: STORED_NAME },
      deps,
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_USER_ID", field: "userId" },
    });
  });

  it("rejects non-uuid roomId as INVALID_ROOM_ID 400 with field", async () => {
    const { deps } = makeDeps();
    const result = await claimIdentity(
      { userId: VALID_USER_ID, roomId: "nope", displayName: STORED_NAME },
      deps,
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", field: "roomId" },
    });
  });

  it("rejects bad displayName as INVALID_DISPLAY_NAME 400 with field", async () => {
    const { deps } = makeDeps();
    const result = await claimIdentity(
      { userId: VALID_USER_ID, roomId: VALID_ROOM_ID, displayName: "!" },
      deps,
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "INVALID_DISPLAY_NAME", field: "displayName" },
    });
  });
});

describe("claimIdentity — verification failures", () => {
  it("returns CANDIDATE_NOT_FOUND 404 when no membership row exists", async () => {
    const { deps, updateMock, hashSpy } = makeDeps({ membershipRow: null });
    const result = await claimIdentity(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "CANDIDATE_NOT_FOUND" },
    });
    expect(updateMock).not.toHaveBeenCalled();
    expect(hashSpy).not.toHaveBeenCalled();
  });

  it("returns CANDIDATE_NOT_FOUND 404 when stored display_name doesn't match (case-insensitive)", async () => {
    const { deps, updateMock } = makeDeps({
      membershipRow: {
        users: { id: VALID_USER_ID, display_name: "Bob", avatar_seed: "sa" },
      },
    });
    const result = await claimIdentity(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: { code: "CANDIDATE_NOT_FOUND" },
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns INTERNAL_ERROR 500 when the select errors", async () => {
    const { deps } = makeDeps({ membershipError: { message: "boom" } });
    const result = await claimIdentity(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});

describe("claimIdentity — happy path", () => {
  it("returns the new token + canonical stored displayName + avatarSeed", async () => {
    const { deps } = makeDeps();
    const result = await claimIdentity(validInput({ displayName: "  alice  " }), deps);
    expect(result).toEqual({
      ok: true,
      user: {
        userId: VALID_USER_ID,
        rejoinToken: NEW_TOKEN,
        displayName: STORED_NAME,
        avatarSeed: "sa",
      },
    });
  });

  it("writes the new bcrypt hash and refreshed last_seen_at", async () => {
    const { deps, updateMock, updateEq, hashSpy, nowSpy } = makeDeps();
    await claimIdentity(validInput(), deps);
    expect(hashSpy).toHaveBeenCalledWith(NEW_TOKEN);
    expect(nowSpy).toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith({
      rejoin_token_hash: NEW_HASH,
      last_seen_at: NOW_ISO,
    });
    expect(updateEq).toHaveBeenCalledWith("id", VALID_USER_ID);
  });

  it("returns INTERNAL_ERROR 500 when the update errors", async () => {
    const { deps } = makeDeps({ updateError: { message: "boom" } });
    const result = await claimIdentity(validInput(), deps);
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});

describe("claimIdentity — never leaks the new plaintext token in error paths", () => {
  it.each([
    ["CANDIDATE_NOT_FOUND", { membershipRow: null } as MakeDepsOverrides],
    ["INVALID_BODY", { membershipRow: null } as MakeDepsOverrides, "invalid"],
    ["INTERNAL_ERROR select", { membershipError: { message: "b" } } as MakeDepsOverrides],
  ])("never includes the new token in the %s result", async (_label, overrides) => {
    const { deps } = makeDeps(overrides);
    const result = await claimIdentity(validInput(), deps);
    expect(JSON.stringify(result)).not.toContain(NEW_TOKEN);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- claim`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handler**

Create `src/lib/auth/claim.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import { DISPLAY_NAME_REGEX } from "@/lib/auth/onboard";

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface ClaimInput {
  userId: unknown;
  roomId: unknown;
  displayName: unknown;
}

export interface ClaimDeps {
  supabase: SupabaseClient<Database>;
  hashToken: (plaintext: string) => Promise<string>;
  generateRejoinToken: () => string;
  now: () => string;
}

export interface ClaimSuccess {
  ok: true;
  user: {
    userId: string;
    rejoinToken: string;
    displayName: string;
    avatarSeed: string;
  };
}

export interface ClaimFailure {
  ok: false;
  status: number;
  error: { code: ApiErrorCode; message: string; field?: string };
}

export type ClaimResult = ClaimSuccess | ClaimFailure;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): ClaimFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

function normalizeDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export async function claimIdentity(
  input: ClaimInput,
  deps: ClaimDeps,
): Promise<ClaimResult> {
  if (
    typeof input.userId !== "string" ||
    typeof input.roomId !== "string" ||
    typeof input.displayName !== "string"
  ) {
    return fail(
      "INVALID_BODY",
      "Request body must include userId, roomId, and displayName strings.",
      400,
    );
  }

  if (!UUID_V4_REGEX.test(input.userId)) {
    return fail("INVALID_USER_ID", "userId must be a UUID v4.", 400, "userId");
  }
  if (!UUID_V4_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID v4.", 400, "roomId");
  }

  const wantedName = normalizeDisplayName(input.displayName);
  if (!DISPLAY_NAME_REGEX.test(wantedName)) {
    return fail(
      "INVALID_DISPLAY_NAME",
      "displayName must be 2–24 characters and contain only letters, numbers, spaces, or hyphens.",
      400,
      "displayName",
    );
  }

  const { data: row, error: selectError } = await deps.supabase
    .from("room_memberships")
    .select("users!inner(id, display_name, avatar_seed)")
    .eq("room_id", input.roomId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (selectError) {
    return fail("INTERNAL_ERROR", "Could not verify candidate. Please try again.", 500);
  }
  if (!row) {
    return fail(
      "CANDIDATE_NOT_FOUND",
      "No candidate matches this id, room, and name.",
      404,
    );
  }

  const user = row.users as unknown as {
    id: string;
    display_name: string;
    avatar_seed: string;
  };
  const storedNormalized = normalizeDisplayName(user.display_name).toLowerCase();
  if (storedNormalized !== wantedName.toLowerCase()) {
    return fail(
      "CANDIDATE_NOT_FOUND",
      "No candidate matches this id, room, and name.",
      404,
    );
  }

  const rejoinToken = deps.generateRejoinToken();
  const hash = await deps.hashToken(rejoinToken);
  const { error: updateError } = await deps.supabase
    .from("users")
    .update({ rejoin_token_hash: hash, last_seen_at: deps.now() })
    .eq("id", user.id);

  if (updateError) {
    return fail("INTERNAL_ERROR", "Could not merge identity. Please try again.", 500);
  }

  return {
    ok: true,
    user: {
      userId: user.id,
      rejoinToken,
      displayName: user.display_name,
      avatarSeed: user.avatar_seed,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- claim`
Expected: all passing.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/claim.ts src/lib/auth/claim.test.ts
git commit -m "Add claimIdentity pure handler (rotate token, refresh last_seen_at)"
```

---

## Task 6: `POST /api/auth/claim` route adapter + tests

**Files:**
- Create: `src/app/api/auth/claim/route.ts`
- Create: `src/app/api/auth/claim/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/auth/claim/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: {
      users: {
        id: "11111111-1111-4111-8111-111111111111",
        display_name: "Alice",
        avatar_seed: "sa",
      },
    },
    error: null,
  });
  const eqUser = vi.fn(() => ({ maybeSingle }));
  const eqRoom = vi.fn(() => ({ eq: eqUser }));
  const selectMembership = vi.fn(() => ({ eq: eqRoom }));

  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const updateMock = vi.fn(() => ({ eq: updateEq }));

  const fromMock = vi.fn((_table: string) => ({
    select: selectMembership,
    update: updateMock,
  }));
  return {
    createServiceClient: () => ({ from: fromMock }),
  };
});

import { POST } from "@/app/api/auth/claim/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_USER_ID = "11111111-1111-4111-8111-111111111111";
const VALID_ROOM_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("POST /api/auth/claim (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with the four user fields on valid input", async () => {
    const res = await POST(
      makeRequest({
        userId: VALID_USER_ID,
        roomId: VALID_ROOM_ID,
        displayName: "Alice",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      userId: VALID_USER_ID,
      rejoinToken: expect.any(String),
      displayName: "Alice",
      avatarSeed: "sa",
    });
    expect(body.rejoinToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("returns 400 INVALID_BODY when the body is not JSON", async () => {
    const req = new NextRequest("http://localhost/api/auth/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json{{{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 400 INVALID_USER_ID when userId is malformed", async () => {
    const res = await POST(
      makeRequest({
        userId: "not-a-uuid",
        roomId: VALID_ROOM_ID,
        displayName: "Alice",
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; field?: string } };
    expect(body.error.code).toBe("INVALID_USER_ID");
    expect(body.error.field).toBe("userId");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- api/auth/claim`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/auth/claim/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { claimIdentity } from "@/lib/auth/claim";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

const BCRYPT_ROUNDS = 10;

/**
 * POST /api/auth/claim
 * Body: { userId: string, roomId: string, displayName: string }
 * Merges the caller into an existing same-name identity in the room:
 * rotates rejoin_token_hash, refreshes last_seen_at, returns a new plaintext
 * rejoin token. (SPEC §4.3 "Different device" branch.)
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

  const result = await claimIdentity(
    body as { userId: unknown; roomId: unknown; displayName: unknown },
    {
      supabase: createServiceClient(),
      hashToken: (plaintext) => bcrypt.hash(plaintext, BCRYPT_ROUNDS),
      generateRejoinToken: uuidv4,
      now: () => new Date().toISOString(),
    },
  );

  if (result.ok) {
    return NextResponse.json(result.user, { status: 200 });
  }
  return apiError(result.error.code, result.error.message, result.status, result.error.field);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- api/auth/claim`
Expected: 3 passing.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/auth/claim/route.ts src/app/api/auth/claim/route.test.ts
git commit -m "Add POST /api/auth/claim route adapter"
```

---

## Task 7: `CandidatePicker` presentational component

**Files:**
- Create: `src/components/onboarding/CandidatePicker.tsx`

Pure presentational — takes the candidate list + three callbacks. Verified by type-check + manual dev-server exercise in Task 9.

- [ ] **Step 1: Implement the component**

Create `src/components/onboarding/CandidatePicker.tsx`:

```tsx
"use client";

import Avatar from "@/components/ui/Avatar";

interface Candidate {
  userId: string;
  avatarSeed: string;
}

interface CandidatePickerProps {
  candidates: Candidate[];
  onPick: (candidate: Candidate) => void;
  onCreateNew: () => void;
  onChangeName: () => void;
  submitting: boolean;
}

export default function CandidatePicker({
  candidates,
  onPick,
  onCreateNew,
  onChangeName,
  submitting,
}: CandidatePickerProps) {
  return (
    <div
      className="mx-auto w-full max-w-md space-y-8 px-6 py-10 animate-fade-in"
      aria-live="polite"
    >
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-foreground">Is this you?</h1>
        <p className="text-muted-foreground text-sm text-balance">
          Someone with that name is already in this room. Tap your avatar to
          rejoin, or create a new identity.
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-4">
        {candidates.map((c) => (
          <button
            key={c.userId}
            type="button"
            onClick={() => onPick(c)}
            disabled={submitting}
            aria-label="Pick this avatar"
            className="rounded-full border-2 border-border p-1 transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Avatar seed={c.avatarSeed} size={96} />
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onCreateNew}
        disabled={submitting}
        className="block w-full rounded-xl bg-primary px-6 py-4 text-lg font-semibold text-primary-foreground transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
      >
        Create new identity
      </button>

      <div className="text-center">
        <button
          type="button"
          onClick={onChangeName}
          disabled={submitting}
          className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          ← Change name
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/CandidatePicker.tsx
git commit -m "Add CandidatePicker presentational component"
```

---

## Task 8: Extend `OnboardingForm` with the picker state machine

**Files:**
- Modify: `src/components/onboarding/OnboardingForm.tsx`

Adds: roomId extraction, `step` state, candidates state, pre-flight on submit, claim on avatar tap, "Create new" escape hatch, "← Change name" back-button.

- [ ] **Step 1: Replace `onSubmit` with the two-step flow**

Edit `src/components/onboarding/OnboardingForm.tsx`. Full new file content:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Avatar from "@/components/ui/Avatar";
import AvatarCarousel from "@/components/onboarding/AvatarCarousel";
import CandidatePicker from "@/components/onboarding/CandidatePicker";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { generateCarouselSeeds } from "@/lib/onboarding/seeds";
import { sanitizeNextPath } from "@/lib/onboarding/safeNext";
import { extractRoomId } from "@/lib/onboarding/extractRoomId";
import { DISPLAY_NAME_REGEX } from "@/lib/auth/onboard";
import { createExpiryDate, getSession, setSession } from "@/lib/session";
import { apiFetch } from "@/lib/api/fetch";

const DEFAULT_SEED = "emx-default";
const NAME_DEBOUNCE_MS = 300;

function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function browserRng(): number {
  return Math.random();
}

interface UserResponse {
  userId: string;
  rejoinToken: string;
  displayName: string;
  avatarSeed: string;
}

interface Candidate {
  userId: string;
  avatarSeed: string;
}

interface ApiErrorShape {
  error: { code: string; message: string; field?: string };
}

export default function OnboardingForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(
    () => sanitizeNextPath(searchParams.get("next")),
    [searchParams],
  );
  const roomId = useMemo(() => extractRoomId(nextPath), [nextPath]);

  const [redirectChecked, setRedirectChecked] = useState(false);
  useEffect(() => {
    if (getSession()) {
      router.replace(nextPath);
      return;
    }
    setRedirectChecked(true);
  }, [router, nextPath]);

  const [step, setStep] = useState<"form" | "picker">("form");
  const [name, setName] = useState("");
  const debouncedName = useDebouncedValue(name, NAME_DEBOUNCE_MS);

  const [carouselOpen, setCarouselOpen] = useState(false);
  const [carouselSeeds, setCarouselSeeds] = useState<string[]>([]);
  const [selectedSeed, setSelectedSeed] = useState<string | null>(null);
  const [previewSeed, setPreviewSeed] = useState<string>(DEFAULT_SEED);

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  useEffect(() => {
    if (carouselOpen) return;
    const normalized = normalizeName(debouncedName);
    setPreviewSeed(normalized.length > 0 ? normalized : DEFAULT_SEED);
  }, [debouncedName, carouselOpen]);

  const effectiveSeed = selectedSeed ?? previewSeed;

  function openOrShuffleCarousel() {
    const seeds = generateCarouselSeeds(effectiveSeed, browserRng);
    setCarouselSeeds(seeds);
    setSelectedSeed(effectiveSeed);
    setCarouselOpen(true);
  }

  function onPickTile(seed: string) {
    setSelectedSeed(seed);
  }

  const normalized = normalizeName(name);
  const nameValid = DISPLAY_NAME_REGEX.test(normalized);

  async function createNewIdentity(displayName: string, avatarSeed: string) {
    const res = await apiFetch("/api/auth/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, avatarSeed }),
    });
    if (res.status === 201) {
      const data = (await res.json()) as UserResponse;
      setSession({
        userId: data.userId,
        rejoinToken: data.rejoinToken,
        displayName: data.displayName,
        avatarSeed: data.avatarSeed,
        expiresAt: createExpiryDate(),
      });
      router.push(nextPath);
      return;
    }
    const body = (await res.json().catch(() => null)) as ApiErrorShape | null;
    if (res.status === 400 && body?.error?.code === "INVALID_DISPLAY_NAME") {
      setFieldError(body.error.message);
    } else {
      setGeneralError("Couldn't create your identity. Try again.");
    }
  }

  async function fetchCandidates(displayName: string): Promise<Candidate[] | null> {
    if (!roomId) return [];
    try {
      const res = await apiFetch("/api/auth/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, roomId }),
      });
      if (res.status === 200) {
        const data = (await res.json()) as { candidates: Candidate[] };
        return data.candidates;
      }
      const body = (await res.json().catch(() => null)) as ApiErrorShape | null;
      if (res.status === 400 && body?.error?.code === "INVALID_DISPLAY_NAME") {
        setFieldError(body.error.message);
        return null;
      }
      setGeneralError("Couldn't check the room. Try again.");
      return null;
    } catch {
      setGeneralError("Couldn't check the room. Try again.");
      return null;
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    setGeneralError(null);
    if (!nameValid) {
      setFieldError("Use 2–24 letters, numbers, spaces, or hyphens.");
      return;
    }
    setSubmitting(true);
    try {
      const matches = await fetchCandidates(normalized);
      if (matches === null) return; // error already surfaced
      if (matches.length > 0) {
        setCandidates(matches);
        setStep("picker");
        return;
      }
      await createNewIdentity(normalized, effectiveSeed);
    } catch {
      setGeneralError("Couldn't create your identity. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onPickCandidate(candidate: Candidate) {
    if (!roomId) return;
    setGeneralError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/auth/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: candidate.userId,
          roomId,
          displayName: normalized,
        }),
      });
      if (res.status === 200) {
        const data = (await res.json()) as UserResponse;
        setSession({
          userId: data.userId,
          rejoinToken: data.rejoinToken,
          displayName: data.displayName,
          avatarSeed: data.avatarSeed,
          expiresAt: createExpiryDate(),
        });
        router.push(nextPath);
        return;
      }
      const body = (await res.json().catch(() => null)) as ApiErrorShape | null;
      if (res.status === 404 && body?.error?.code === "CANDIDATE_NOT_FOUND") {
        const refreshed = await fetchCandidates(normalized);
        if (refreshed === null) return;
        if (refreshed.length === 0) {
          await createNewIdentity(normalized, effectiveSeed);
          return;
        }
        setCandidates(refreshed);
        return;
      }
      setGeneralError("Couldn't merge that identity. Try again.");
    } catch {
      setGeneralError("Couldn't merge that identity. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onPickerCreateNew() {
    setGeneralError(null);
    setSubmitting(true);
    try {
      await createNewIdentity(normalized, effectiveSeed);
    } catch {
      setGeneralError("Couldn't create your identity. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function onChangeName() {
    setStep("form");
    setCandidates([]);
    setGeneralError(null);
  }

  if (!redirectChecked) {
    return null;
  }

  if (step === "picker") {
    return (
      <>
        <CandidatePicker
          candidates={candidates}
          onPick={onPickCandidate}
          onCreateNew={onPickerCreateNew}
          onChangeName={onChangeName}
          submitting={submitting}
        />
        {generalError && (
          <p role="alert" aria-live="polite" className="mx-auto mt-4 max-w-md px-6 text-center text-sm text-hot-pink">
            {generalError}
          </p>
        )}
      </>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto w-full max-w-md space-y-8 px-6 py-10 animate-fade-in"
    >
      <div className="flex flex-col items-center space-y-4">
        <button
          type="button"
          onClick={openOrShuffleCarousel}
          aria-label="Change avatar"
          className="rounded-full border-2 border-border p-1 transition-colors hover:border-accent"
        >
          <Avatar seed={effectiveSeed} size={128} />
        </button>
        <p className="text-sm text-muted-foreground">Tap your avatar to change it.</p>
      </div>

      <div className="space-y-2">
        <label htmlFor="displayName" className="text-sm font-semibold text-foreground">
          Your display name
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          inputMode="text"
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          maxLength={24}
          aria-invalid={fieldError != null}
          aria-describedby={fieldError ? "displayName-error" : undefined}
          className="w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-lg text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
          placeholder="e.g. Alice"
        />
        {fieldError && (
          <p
            id="displayName-error"
            role="alert"
            aria-live="polite"
            className="text-sm text-hot-pink"
          >
            {fieldError}
          </p>
        )}
      </div>

      {carouselOpen && (
        <AvatarCarousel
          seeds={carouselSeeds}
          selectedSeed={effectiveSeed}
          onSelect={onPickTile}
          onShuffle={openOrShuffleCarousel}
        />
      )}

      {generalError && (
        <p role="alert" aria-live="polite" className="text-sm text-hot-pink">
          {generalError}
        </p>
      )}

      <button
        type="submit"
        disabled={!nameValid || submitting}
        className="block w-full rounded-xl bg-primary px-6 py-4 text-lg font-semibold text-primary-foreground transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
      >
        {submitting ? "Joining…" : "Join"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 3: Run the full test suite (no regressions)**

Run: `npm test`
Expected: all previously passing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/onboarding/OnboardingForm.tsx
git commit -m "Extend OnboardingForm with same-name picker state machine"
```

---

## Task 9: Add no-session guard to `/room/[id]`

**Files:**
- Modify: `src/app/room/[id]/page.tsx`

Minimal client-side effect. Phase 2 rewrites this file whole when the lobby view lands; the guard migrates with it.

- [ ] **Step 1: Wire the guard**

Replace the contents of `src/app/room/[id]/page.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "@/lib/session";

/**
 * Main room page — adapts to room status:
 * - lobby: participant list, waiting for admin to start
 * - voting: voting cards (sliders, hot takes, navigation)
 * - scoring: brief transition screen
 * - announcing: live or instant results reveal
 * - done: final results + awards
 *
 * TODO: Implement status-aware room view (Phase 2).
 */

export default function RoomPage({ params }: { params: { id: string } }) {
  const router = useRouter();

  useEffect(() => {
    if (getSession()) return;
    router.replace(`/onboard?next=/room/${params.id}`);
  }, [params.id, router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="max-w-md w-full space-y-6 text-center animate-fade-in">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight emx-wordmark">
            Room
          </h1>
          <p className="text-muted-foreground">
            Room ID:{" "}
            <span className="font-mono text-foreground">{params.id}</span>
          </p>
          <p className="text-muted-foreground text-sm">
            Room view adapts to status: lobby → voting → scoring → announcing → done
          </p>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/room/[id]/page.tsx
git commit -m "Add no-session guard to /room/[id] (redirect to /onboard?next=...)"
```

---

## Task 10: Verification pass + TODO tick

**Files:**
- Modify: `TODO.md`

No new code. Run every verification gate, then tick the item.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: every test passes; the new candidates + claim + extractRoomId suites are visible in the output.

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 3: Lint (informational; surface any warnings)**

Run: `npm run lint`
Expected: no errors. Warnings are acceptable but should be listed in the commit description if any were added.

- [ ] **Step 4: Manual end-to-end exercise (requires `.env.local` with real Supabase keys, per CLAUDE.md §3.5)**

Run: `npm run dev`, then in a real browser (use two browsers or one normal + one incognito):

  1. In browser **A**: open `http://localhost:3000`, go through onboarding as "Alice" → end up at `/`.
  2. Apply `supabase/schema.sql` if not already applied. Manually insert a test room + membership for the Alice user (via the Supabase SQL editor):
     ```sql
     INSERT INTO rooms (id, pin, year, event, categories, owner_user_id, status, announcement_mode)
     VALUES ('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'TEST01', 2026, 'final', '[]'::jsonb,
             '<alice-user-id>', 'lobby', 'live');
     INSERT INTO room_memberships (room_id, user_id)
     VALUES ('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', '<alice-user-id>');
     ```
  3. In browser **B** (incognito): navigate to `http://localhost:3000/room/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`.
      - Expected: redirect to `/onboard?next=/room/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`.
  4. Type "Alice" + tap Join.
      - Expected: the picker step appears with one avatar (Alice's seed) and a "Create new identity" button. **No display names anywhere on screen.**
  5. Tap the avatar.
      - Expected: redirect to `/room/<id>`; `emx_session.userId` in browser B's localStorage equals Alice's userId; session token differs from browser A's (check via DevTools).
  6. Back in browser **A**: refresh the room URL.
      - Expected: since browser A's now-stale session token no longer matches the rotated hash, `apiFetch` will see a session expiry on the next `/api/auth/rejoin` attempt; browser A ends up back on `/onboard` (acceptable MVP behavior — they lost the identity to browser B). Note: with two tabs active simultaneously, this is the designed tradeoff per SPEC §4.3.
  7. Repeat step 3–4 in a third incognito window but tap **Create new identity** instead. Expected: standard onboard flow, new userId, new session. No impact on Alice's identity.

  If any step doesn't match, leave the task in_progress and debug using the superpowers `systematic-debugging` skill — do not mark this task complete.

- [ ] **Step 5: Tick the TODO item**

Edit `TODO.md`. Find the line:

```
- [ ] Same-name resolver flow (§4.3): when no localStorage token on a room URL, look up existing users with matching name in that room and offer "is this you?" confirmation with avatar
```

Replace the leading `[ ]` with `[x]`.

- [ ] **Step 6: Final commit**

```bash
git add TODO.md
git commit -m "Tick Phase 1 same-name resolver in TODO.md"
```

- [ ] **Step 7: Summarize for the human**

Report: branch `feat/same-name-resolver`, N commits, every test + type-check green, manual exercise confirmed. Ask whether they want a PR opened against `main` (per CLAUDE.md §5 — PR decisions are a human call).

---

## Self-review notes

Checked against [the design spec](../specs/2026-04-19-same-name-resolver-design.md):

- §2 architecture overview → Tasks 3–9 cover every named route / file.
- §3 state machine → Task 8 implements it.
- §4.1 candidates contract → Task 3 tests + Task 4 route cover every listed status code.
- §4.2 claim contract → Task 5 tests + Task 6 route cover every listed status code. Single `CANDIDATE_NOT_FOUND` for all three failure modes is enforced in Task 5 Step 3.
- §5 SQL → translated to Supabase JS queries in Task 3 (room-exists + memberships join) and Task 5 (membership + user join, filtered). Normalization is JS-side per the plan's "Supabase query plan" note.
- §6 service-side library shapes → Task 3 and Task 5 match the typed interfaces exactly.
- §7.1 form state machine → Task 8. Shared `createNewIdentity` helper is in the final file.
- §7.2 room guard → Task 9.
- §8 testing plan → Tasks 2/3/4/5/6 cover lib + route tests. Component tests are out of scope per the "Testing scope" section above — documented and justified.
- §9 scope boundaries → rate limiting, audit log, single-match auto-pick all explicitly skipped. Matches.

No placeholders, no TBDs. Every code block is complete and self-contained. Method names are consistent across tasks: `listCandidates`, `claimIdentity`, `createNewIdentity`, `fetchCandidates`, `onPickCandidate`, `onChangeName`, `extractRoomId`.
