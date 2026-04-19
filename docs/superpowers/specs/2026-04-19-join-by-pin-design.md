# Design — `POST /api/rooms/join-by-pin`

**Status:** approved · **Date:** 2026-04-19 · **SPEC refs:** §6.2 (PIN), §6.4 (join flow), §14 (API)

## Purpose

Resolve a 6–7 char room PIN to a `roomId` and idempotently add the caller to `room_memberships`. Entry point for the `/join` guest flow (SPEC §6.4).

## Contract

**Request** — `POST /api/rooms/join-by-pin` with JSON body:

```
{ "pin": string, "userId": string }
```

**Response 200**

```
{ "roomId": string }
```

Returned both for first-time joins and repeat joins (idempotent).

**Error responses**

| HTTP | `error.code` | When |
|---|---|---|
| 400 | `INVALID_BODY` | Body is not JSON / not an object |
| 400 | `INVALID_PIN` | `pin` missing, wrong length (outside 6–7), or contains chars outside `PIN_CHARSET` after normalization |
| 400 | `INVALID_USER_ID` | `userId` missing / not a non-empty string |
| 404 | `ROOM_NOT_FOUND` | No room matches the (normalized) PIN |
| 409 | `ROOM_NOT_JOINABLE` | Room status ∈ `{scoring, announcing, done}` |
| 500 | `INTERNAL_ERROR` | DB failure, including user-FK violation on a bad `userId` |

## Behaviour decisions

### Reject `scoring` (choice B)

SPEC §6.4 only names `announcing` and `done`, but `scoring` is a transient state between `voting` and `announcing` where voting is already closed. Joining there would create an orphan participant for the announcement flow. We treat `scoring` the same as `announcing`/`done` → `ROOM_NOT_JOINABLE` (409).

Joinable statuses: `lobby`, `voting`.

### PIN normalization

Server normalizes defensively, even though the UI (SMS-slot input, §6.4) already uppercases client-side:

1. `pin.trim().toUpperCase()`
2. Length must be exactly 6 or 7 (§6.2 allows a 7-char fallback when the 6-char space exhausts).
3. Every char must be in `PIN_CHARSET` (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — no `O/0/I/1`).

Any violation → `INVALID_PIN` (400).

### Idempotency

`room_memberships` PK is `(room_id, user_id)`. We use:

```
supabase.from('room_memberships')
  .upsert({ room_id, user_id }, { onConflict: 'room_id,user_id', ignoreDuplicates: true })
```

Repeat joins are a silent no-op returning the same `{ roomId }`. The response does not differentiate first-join from rejoin — the UI only needs `roomId` for the redirect.

### User existence check

We do **not** pre-validate that `userId` exists. The FK on `room_memberships.user_id → users.id` enforces it; a bad id manifests as `INTERNAL_ERROR` (500) rather than a dedicated `USER_NOT_FOUND`. Worth the simpler shape — a non-existent userId arriving here is a client bug, not a user-facing error to disambiguate.

## Authorization / lookup ordering

1. Parse/validate body → `INVALID_BODY` / `INVALID_PIN` / `INVALID_USER_ID`.
2. `SELECT id, status FROM rooms WHERE pin = $normalizedPin` → `ROOM_NOT_FOUND` if no row.
3. Guard `room.status` → `ROOM_NOT_JOINABLE` if in `{scoring, announcing, done}`.
4. `UPSERT room_memberships` (ignoreDuplicates).
5. Return `{ roomId }`.

## Library shape

Mirrors `createRoom` / `getRoom`:

- `src/lib/rooms/joinByPin.ts` exporting `joinByPin(input, deps)`.
- DI: `{ supabase: SupabaseClient<Database> }`.
- Return: `{ ok: true; roomId: string } | { ok: false; error: {code, message, field?}; status: number }`.
- Route adapter at `src/app/api/rooms/join-by-pin/route.ts` — thin, identical pattern to the two landed adapters.

## Data model impact

None. No schema migration required. Uses existing `rooms.pin`, `rooms.status`, and `room_memberships` tables.

## Additions to `api-errors.ts`

Two new codes on `ApiErrorCode`:

- `INVALID_PIN`
- `ROOM_NOT_JOINABLE`

## Test plan

### Unit tests — `src/lib/rooms/joinByPin.test.ts`

- **Happy path:** `lobby` room → returns `{ roomId }`; membership upsert called with the right shape.
- **PIN normalization:** lowercase (`"abcdef"`) accepted; whitespace-padded (`" ABCDEF "`) accepted; 7-char PIN accepted.
- **PIN validation:** rejects missing, empty, 5-char, 8-char, and `"AAA0AA"` (contains excluded `0`). All → `INVALID_PIN` (400).
- **userId validation:** non-string → `INVALID_USER_ID`; empty string → `INVALID_USER_ID`. Both 400.
- **Not found:** room SELECT returns null → 404 `ROOM_NOT_FOUND`. Membership upsert not called.
- **Not joinable:** one test per status in `{scoring, announcing, done}` → 409 `ROOM_NOT_JOINABLE`. Membership upsert not called.
- **Joinable:** statuses `lobby` and `voting` both succeed.
- **Idempotency:** successive calls for the same `(roomId, userId)` both succeed (mock upsert configured with `ignoreDuplicates: true`).
- **DB error:** upsert error → 500 `INTERNAL_ERROR`.

### Route-adapter tests — `src/app/api/rooms/join-by-pin/route.test.ts`

- 200 + `{ roomId }` on happy path.
- 400 `INVALID_BODY` on non-JSON body.
- 404 `ROOM_NOT_FOUND` on unknown PIN.
- 409 `ROOM_NOT_JOINABLE` on `announcing`.

### Verification

- `npm run pre-push` (tsc + vitest) clean before commit.
- Full suite expected to grow by ~15–18 tests and remain green.

## Non-goals / out of scope

- **Presence/realtime broadcast** — §15 `user_joined` event emission is a separate Phase 2/3 concern; not landed here.
- **Rate limiting on PIN guessing** — deferred. The PIN space (32⁶ ≈ 1.1B) plus short-lived rooms make it low-risk for MVP.
- **Telemetry / analytics** — no joins-count metric yet.
- **Conflict UX for rejoin** — same-name resolver (SPEC §4.3) is orthogonal; this endpoint assumes the caller already has a `userId` from onboarding.
