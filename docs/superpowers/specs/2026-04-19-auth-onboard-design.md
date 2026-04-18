# `POST /api/auth/onboard` — design

**Date:** 2026-04-19
**SPEC reference:** §4 (User identity & session management), §13 (`users` table), §14 (API routes)
**TODO.md item:** Phase 1 — first bullet

---

## 1. Goal

Implement the first real `POST` endpoint in the codebase: create a new user, return a server-generated rejoin token (plaintext to the client, bcrypt-hashed in the DB), and return the canonical user fields the client will store in `localStorage` as `emx_session`.

This ticket also establishes two patterns reused by every subsequent API route:

- **Test seam:** route logic lives in a pure handler with injected dependencies; route file is a thin adapter.
- **Error response shape:** `{ error: { code, message, field? } }` returned via a shared `apiError()` helper.

## 2. Architecture

Three files (two new, one replacing a stub):

### `src/lib/api-errors.ts` *(new, shared across all routes)*

Exports:

```ts
export type ApiErrorCode =
  | "INVALID_BODY"
  | "INVALID_DISPLAY_NAME"
  | "INVALID_AVATAR_SEED"
  | "INTERNAL_ERROR";
// future routes extend this union

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; field?: string };
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): NextResponse<ApiErrorBody>;
```

`status` is required because callers must consciously pick the HTTP code per RFC 9110 — the helper does not infer it from the code.

### `src/lib/auth/onboard.ts` *(new, pure handler)*

```ts
export interface OnboardInput {
  displayName: unknown; // validated inside; declared `unknown` to force the check
  avatarSeed: unknown;
}

export interface OnboardDeps {
  supabase: SupabaseClient<Database>;
  hashToken: (plaintext: string) => Promise<string>;
  generateUserId: () => string;
  generateRejoinToken: () => string;
}

export type OnboardResult =
  | { ok: true; user: { userId: string; rejoinToken: string; displayName: string; avatarSeed: string } }
  | { ok: false; error: { code: ApiErrorCode; message: string; field?: string }; status: number };

export async function onboardUser(input: OnboardInput, deps: OnboardDeps): Promise<OnboardResult>;
```

No `NextRequest`, no `NextResponse`, no `bcrypt` import, no `uuid` import — fully testable by passing fakes for `deps`.

### `src/app/api/auth/onboard/route.ts` *(replaces the existing stub)*

Thin adapter. Responsibilities only:

1. `await request.json()` inside a `try` — catch parse failure → `apiError("INVALID_BODY", ...)`.
2. Call `onboardUser(body, { supabase: createServiceClient(), hashToken: (t) => bcrypt.hash(t, 10), generateUserId: uuidv4, generateRejoinToken: uuidv4 })`.
3. If `result.ok` → `NextResponse.json(result.user, { status: 201 })`.
4. Else → `apiError(result.error.code, result.error.message, result.status, result.error.field)`.

No business logic in this file.

## 3. Validation

Per SPEC §4.1. All checks happen in `onboardUser`; client validation is never trusted.

| Field | Rule | Failure |
|---|---|---|
| Body shape | Object with string `displayName` and string `avatarSeed`. JSON parse failure handled in route adapter. | `INVALID_BODY`, 400, no `field` |
| `displayName` | Trim leading/trailing whitespace. Collapse internal whitespace runs to a single space. Then must match `/^[A-Za-z0-9 \-]{2,24}$/`. | `INVALID_DISPLAY_NAME`, 400, `field: "displayName"` |
| `avatarSeed` | String, length 1–64 (matches `users.avatar_seed VARCHAR(64)`). No charset restriction — DiceBear accepts any string and we URL-encode at render time. | `INVALID_AVATAR_SEED`, 400, `field: "avatarSeed"` |

**Display-name uniqueness is NOT checked here.** SPEC §4.3's same-name resolver is a *rejoin-into-room* concern, not an onboarding concern; it's a separate Phase 1 ticket.

**Regex interpretation:** SPEC §4.1 says "2–24 chars, trimmed, no special chars except spaces/hyphens". I'm reading the implicit base as alphanumerics (`[A-Za-z0-9]`); the SPEC's wording is slightly underspecified but the intent is clear from context.

## 4. Behaviour (happy path)

1. Validate body.
2. `userId = deps.generateUserId()` — server-side. Never trust a client-supplied id.
3. `rejoinToken = deps.generateRejoinToken()`.
4. `rejoinTokenHash = await deps.hashToken(rejoinToken)` — bcrypt cost factor 10 in production.
5. `supabase.from('users').insert({ id: userId, display_name, avatar_seed, rejoin_token_hash })`. Let DB defaults populate `created_at` and `last_seen_at`.
6. On Supabase error → log server-side, return `INTERNAL_ERROR` 500 with a generic message. Never leak the plaintext rejoin token in the error path.
7. On success → `{ ok: true, user: { userId, rejoinToken, displayName: <normalized>, avatarSeed } }`.

The route adapter wraps this as **HTTP 201 Created** with body `{ userId, rejoinToken, displayName, avatarSeed }`.

UUID v4 collisions are astronomically unlikely; we don't retry on duplicate-key errors.

## 5. Test plan (TDD — write before implementation)

### `src/lib/auth/onboard.test.ts` (Vitest, fakes via `deps`)

Happy path:

1. Valid input → returns `{ ok: true, user: { userId, rejoinToken, displayName, avatarSeed } }`.
2. The Supabase insert is called once with `rejoin_token_hash` set to the hash function's output (not the plaintext token), and `display_name` set to the normalized value.
3. `displayName` with leading/trailing whitespace → trimmed before storage and in response.
4. `displayName` with internal double-space → collapsed to single space.
5. The `hashToken` fake is invoked with the plaintext rejoin token returned by `generateRejoinToken`.

Validation failures:

6. Missing `displayName` field → `INVALID_BODY`, 400.
7. Missing `avatarSeed` field → `INVALID_BODY`, 400.
8. `displayName` not a string (e.g. number, array) → `INVALID_BODY`, 400.
9. `displayName` length 1 after trim → `INVALID_DISPLAY_NAME`, 400, `field: "displayName"`.
10. `displayName` length 25 after trim → `INVALID_DISPLAY_NAME`, 400, `field: "displayName"`.
11. `displayName` with disallowed character (e.g. `"Lia!"`, `"<script>"`, emoji) → `INVALID_DISPLAY_NAME`.
12. `avatarSeed` empty string → `INVALID_AVATAR_SEED`, 400, `field: "avatarSeed"`.
13. `avatarSeed` 65 chars → `INVALID_AVATAR_SEED`, 400, `field: "avatarSeed"`.

Error path:

14. Supabase `insert(...).then(...)` returns `{ error: { ... } }` → `INTERNAL_ERROR`, 500. Response must not contain the plaintext rejoin token.

### `src/app/api/auth/onboard/route.test.ts` (single integration-style smoke test)

15. `POST` with valid body via `route.POST(new NextRequest(...))` returns `status === 201` and the four expected fields. Uses a mocked `createServiceClient`. One test only — not re-testing the logic, just the wiring.

## 6. Manual verification (per CLAUDE.md)

Before marking the TODO item done:

- `npm run test` — all green.
- `npm run type-check` — clean.
- `npm run dev`, then `curl -X POST localhost:3000/api/auth/onboard -H 'content-type: application/json' -d '{"displayName":"Test User","avatarSeed":"test-seed-123"}'` → expect HTTP 201 with `{ userId, rejoinToken, displayName, avatarSeed }`.
- Inspect the Supabase `users` table: row exists, `rejoin_token_hash` is a 60-char bcrypt string starting with `$2`, `display_name` is `"Test User"` (normalized).
- Repeat with an invalid body (missing field, oversized name, special char) and confirm 400 + structured error shape.

## 7. Out of scope

- The onboarding screen UI at `/` (separate Phase 1 ticket).
- Same-name resolver flow (separate Phase 1 ticket — applies to rejoin-into-room).
- `POST /api/auth/rejoin` (separate Phase 1 ticket).
- Session-refresh fetch wrapper (separate Phase 1 ticket).
- Updating the `TODO.md` checkbox — verification-step bookkeeping, not part of the implementation plan.
- Adding the `apiError` helper to existing routes (`/api/health`, `/api/contestants`, etc.) — they'll adopt it organically as they're touched.

## 8. Open questions

None. The SPEC is sufficient on every other axis (charset for PIN-style fields, bcrypt cost, body shape, return shape).