# `POST /api/auth/rejoin` — design

**Date:** 2026-04-19
**SPEC reference:** §4.2 (Session storage), §4.3 (Rejoin logic), §13 (`users` table), §14 (API routes)
**TODO.md item:** Phase 1 — second bullet

---

## 1. Goal

Verify a returning user's identity from the rejoin token they kept in `localStorage`, bump `users.last_seen_at`, and hand back the canonical user fields the client needs to hydrate `emx_session`. This is **identity-only**: the rejoin token identifies the user, not a room (SPEC §4.3). Joining a room remains `/api/rooms/{id}/join`.

This is the second real API route in the codebase; it reuses the patterns established by `POST /api/auth/onboard` (pure handler + thin route adapter + shared `apiError`).

## 2. Architecture

Three files — two new, one replacing a stub:

### `src/lib/auth/rejoin.ts` *(new, pure handler)*

No `NextRequest`/`NextResponse`/`bcrypt`/`uuid` imports. All I/O injected via `deps` so tests use fakes.

```ts
export interface RejoinInput {
  userId: unknown;
  rejoinToken: unknown;
  roomId?: unknown; // optional, validated if present, otherwise ignored (see §3)
}

export interface RejoinDeps {
  supabase: SupabaseClient<Database>;
  compareToken: (plaintext: string, hash: string) => Promise<boolean>;
  now: () => string; // ISO 8601 timestamp; injected for test determinism
}

export type RejoinResult =
  | { ok: true; user: { userId: string; displayName: string; avatarSeed: string } }
  | { ok: false; error: { code: ApiErrorCode; message: string; field?: string }; status: number };

export async function rejoinUser(input: RejoinInput, deps: RejoinDeps): Promise<RejoinResult>;
```

### `src/app/api/auth/rejoin/route.ts` *(replaces the existing 501 stub)*

Thin adapter:

1. `await request.json()` inside a `try` — catch parse failure → `apiError("INVALID_BODY", ...)`.
2. Call `rejoinUser(body, { supabase: createServiceClient(), compareToken: (t, h) => bcrypt.compare(t, h), now: () => new Date().toISOString() })`.
3. `result.ok` → `NextResponse.json(result.user, { status: 200 })`. (200 OK — we are **not** creating a resource, so 201 would be incorrect.)
4. Else → `apiError(result.error.code, result.error.message, result.status, result.error.field)`.

### `src/lib/api-errors.ts` *(extended)*

Add two codes to the `ApiErrorCode` union:

```ts
export type ApiErrorCode =
  | "INVALID_BODY"
  | "INVALID_DISPLAY_NAME"
  | "INVALID_AVATAR_SEED"
  | "USER_NOT_FOUND"   // new
  | "INVALID_TOKEN"    // new
  | "INTERNAL_ERROR";
```

## 3. Validation, behaviour, errors

SPEC §4.3 states clearly that the rejoin token identifies the user, not a room. We therefore **accept but ignore** `roomId` (validated as a string only if present). Any membership resolution belongs to `/api/rooms/{id}` or `/api/rooms/{id}/join`.

**How the `roomId` is supplied (context only — not a room picker).** Users always enter a specific room via URL: a shared link from the admin (`/room/{id}`), a PIN entered at `/join`, or a QR-code scan that encodes the same link. The client reads that URL-derived `roomId` and passes it into the rejoin call as a hint. There is no server-side "list my rooms" lookup and no cross-room enumeration by rejoin token.

Error decision was made consciously: **split codes** (`USER_NOT_FOUND` 404 vs. `INVALID_TOKEN` 401). This provides an enumeration oracle in theory, but the client needs the distinction for UX (prompt to create a new identity vs. warn about tampering) and the practical risk of ID enumeration is low (UUIDs are unguessable and this is a volunteer-guest app, not a regulated-auth surface). If we later harden, we can collapse both to a single `INVALID_CREDENTIALS` 401 without a client break.

| Case | Code | HTTP | Field |
|---|---|---|---|
| Request body is not valid JSON | `INVALID_BODY` | 400 | — |
| Body is not an object | `INVALID_BODY` | 400 | — |
| `userId` missing or not a string | `INVALID_BODY` | 400 | — |
| `rejoinToken` missing or not a string | `INVALID_BODY` | 400 | — |
| `roomId` present but not a string | `INVALID_BODY` | 400 | `roomId` |
| `userId` is a string but not a UUID v4 | `INVALID_BODY` | 400 | `userId` |
| No user row with that id | `USER_NOT_FOUND` | 404 | — |
| Row exists, bcrypt compare returns false | `INVALID_TOKEN` | 401 | — |
| Supabase select or update throws an error | `INTERNAL_ERROR` | 500 | — |
| Success | — | 200 | — (body: `{ userId, displayName, avatarSeed }`) |

`rejoinToken` itself is not regex-validated — bcrypt compare is the source of truth. Validating its format separately just adds a second oracle with no benefit.

UUID v4 regex (matches the one already used in `route.test.ts`): `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`.

## 4. Happy-path behaviour

1. Body validation (shape, string types, `userId` UUID v4).
2. `supabase.from('users').select('id, display_name, avatar_seed, rejoin_token_hash').eq('id', userId).maybeSingle()`.
   - Supabase error → `INTERNAL_ERROR` 500.
   - `data === null` → `USER_NOT_FOUND` 404.
3. `const ok = await deps.compareToken(rejoinToken, row.rejoin_token_hash)`.
   - Falsy → `INVALID_TOKEN` 401. **No** `last_seen_at` update.
4. `supabase.from('users').update({ last_seen_at: deps.now() }).eq('id', userId)`.
   - Error → `INTERNAL_ERROR` 500 (we do not want to report stale success when a side-effect the client expects has silently failed).
5. Return `{ ok: true, user: { userId, displayName: row.display_name, avatarSeed: row.avatar_seed } }`.

The route adapter wraps this as **HTTP 200 OK** with body `{ userId, displayName, avatarSeed }`. No `rejoinToken` echo — the client already has it in `localStorage`, and refreshes its own `expiresAt` on success.

## 5. Test plan (TDD — tests written before implementation)

### `src/lib/auth/rejoin.test.ts` (Vitest, fakes via `deps`)

**Happy path:**

1. Valid input + matching hash → `{ ok: true, user: { userId, displayName, avatarSeed } }`.
2. `compareToken` is called exactly once with `(rejoinToken, row.rejoin_token_hash)`.
3. `users` update is called with `{ last_seen_at: deps.now() }` after successful compare.
4. A syntactically valid `roomId` is accepted and does **not** cause any query to `rooms` or `room_memberships`.

**Compare-fail side-effects:**

5. When `compareToken` returns `false`, the `last_seen_at` update is **not** called (spy assertion).

**Body validation:**

6. Missing `userId` → `INVALID_BODY` 400.
7. Missing `rejoinToken` → `INVALID_BODY` 400.
8. `userId` not a string (e.g. number, null) → `INVALID_BODY` 400.
9. `rejoinToken` not a string → `INVALID_BODY` 400.
10. `userId` is a string but not uuid-v4 → `INVALID_BODY` 400, `field: "userId"`.
11. `roomId` present but not a string (e.g. number) → `INVALID_BODY` 400, `field: "roomId"`.

**Auth failures:**

12. Supabase `select` returns no row → `USER_NOT_FOUND` 404. `compareToken` is not called; update is not called.
13. Row exists but compare returns `false` → `INVALID_TOKEN` 401. Update is not called.

**Supabase errors:**

14. Supabase select returns `{ error }` → `INTERNAL_ERROR` 500.
15. Supabase update returns `{ error }` after successful compare → `INTERNAL_ERROR` 500.

**Leakage:**

16. Across all error paths, `JSON.stringify(result)` does **not** contain the plaintext `rejoinToken` that was passed in (defence against accidental echo in messages).

### `src/app/api/auth/rejoin/route.test.ts` (route-adapter smoke tests)

Mirrors the shape of the onboard route test. Mocks `createServiceClient` and `bcrypt.compare`. Two tests only — we don't re-test the logic, just the wiring:

17. `POST` with valid body and bcrypt-compare truthy → `status === 200`, body `{ userId, displayName, avatarSeed }`.
18. `POST` with valid body and bcrypt-compare falsy → `status === 401`, `error.code === "INVALID_TOKEN"`.

## 6. Manual verification (per CLAUDE.md)

Before marking the TODO item done:

- `npm run test` — all green.
- `npm run type-check` — clean.
- `npm run dev`, then:
  - `curl -X POST localhost:3000/api/auth/onboard -H 'content-type: application/json' -d '{"displayName":"Test User","avatarSeed":"test-seed-123"}'` — capture the returned `userId` and `rejoinToken`.
  - `curl -X POST localhost:3000/api/auth/rejoin -H 'content-type: application/json' -d '{"userId":"<captured>","rejoinToken":"<captured>"}'` → expect HTTP 200 with `{ userId, displayName: "Test User", avatarSeed: "test-seed-123" }`.
  - Repeat with a tampered last character of `rejoinToken` → HTTP 401 `INVALID_TOKEN`.
  - Repeat with a random-but-well-formed UUID as `userId` → HTTP 404 `USER_NOT_FOUND`.
  - Repeat with malformed body (missing field, non-uuid `userId`, numeric `roomId`) → HTTP 400 with the expected `error.field` where applicable.
- Inspect the Supabase `users` row for the captured `userId`: `last_seen_at` advanced on the success case, unchanged after the 401 and 404 calls.

## 7. Out of scope

- `PATCH /api/auth/preferences` — Phase L0 work.
- `preferred_locale` in the response payload — that column is added by the Phase L0 schema migration, not here.
- The onboarding / rejoin UI at `/` — separate Phase 1 ticket.
- Same-name resolver flow (SPEC §4.3 "Different device" path) — separate Phase 1 ticket.
- Client-side fetch wrapper that refreshes `expiresAt` on every API call — separate Phase 1 ticket; this endpoint only handles the server-side `last_seen_at` bump.
- Room-membership side-effects or auto-join — SPEC §4.3 keeps rejoin identity-only.
- Updating `TODO.md` checkbox — verification bookkeeping, not part of the implementation plan.

## 8. Open questions

None. The SPEC is sufficient on every axis (body shape, token storage, token-identifies-user semantics, schema). Error-disambiguation policy was explicitly decided (split codes, §3).
