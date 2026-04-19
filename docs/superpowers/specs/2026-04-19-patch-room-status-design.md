# Design — `PATCH /api/rooms/{id}/status`

**Status:** approved · **Date:** 2026-04-19 · **SPEC refs:** §6.3 (lifecycle), §10 (announcement), §14 (API), §15 (realtime)

## Purpose

Admin-only room-state transitions with a Supabase Realtime broadcast. The first endpoint that introduces the project's admin-authorization and room-broadcast patterns; both will be reused by `/now-performing`, `/score`, `/announce/next`, `/announce/handoff`, and the Phase R endpoints (`/refresh-contestants`, `/ownership`, `/co-admins`, `/bets`).

## Contract

**Request** — `PATCH /api/rooms/:id/status`, JSON body:

```
{ "status": "voting" | "done", "userId": string }
```

**Response 200:**

```
{ "room": Room }
```

Full updated Room, mapped through the same shape createRoom/getRoom emit.

**Error responses**

| HTTP | `error.code` | When |
|---|---|---|
| 400 | `INVALID_BODY` | Body not JSON / not an object |
| 400 | `INVALID_ROOM_ID` | URL `id` not a UUID |
| 400 | `INVALID_USER_ID` | `userId` missing / not a non-empty string |
| 400 | `INVALID_STATUS` | `status` not in `{voting, done}` |
| 403 | `FORBIDDEN` | caller `userId` ≠ `rooms.owner_user_id` |
| 404 | `ROOM_NOT_FOUND` | No such room |
| 409 | `INVALID_TRANSITION` | Current → requested status not in the allowed edge set |
| 500 | `INTERNAL_ERROR` | DB UPDATE failure |

## Behaviour decisions

### Allowed transitions (choice A — MVP-tight)

Only two edges accepted:

```ts
const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  lobby: ["voting"],
  announcing: ["done"],
};
```

- `voting → scoring → announcing` is owned by `POST /api/rooms/:id/score` (SPEC §9) and deliberately **not** accepted here — two paths to the same transition would be a divergence footgun.
- `voting_ending` (SPEC §6.3.1, Phase R) requires the Phase R0 schema migration and is out of scope until that lands.
- No-op requests (e.g. `voting → voting`) → `INVALID_TRANSITION` (409). Client should not call with the current status.
- Any backward transition (`done → *`, `announcing → lobby`, etc.) → `INVALID_TRANSITION`.

### Admin authentication

Pattern matches the three existing `/api/rooms*` endpoints:

1. Parse body → extract `userId`.
2. Load room row (SELECT `id, status, owner_user_id`).
3. If `row.owner_user_id !== body.userId` → `403 FORBIDDEN`.

Weakness of the pattern: the client is trusted to send the right `userId`. Anyone who obtains the admin's UUID could spoof admin actions. Mitigating factors for MVP:

- Room UUIDs + admin UUIDs are not publicly posted.
- Rooms are short-lived (one evening).
- `rejoin_token` (bcrypt-hashed) covers session-hijack at the identity layer.

Adding per-request token verification is deferred — it would require a middleware and affects every endpoint, not just this one. Better done as a cross-cutting concern in its own PR.

**No premature helper extraction.** The admin check is inlined here. Extracting a shared `assertRoomAdmin()` is YAGNI until a second endpoint needs it — which happens in the very next PR (`/now-performing`). That PR will refactor.

### Broadcast

On successful DB UPDATE, send one broadcast on channel `room:{roomId}`:

```ts
await supabase.channel(`room:${roomId}`).send({
  type: "broadcast",
  event: "room_event",
  payload: { type: "status_changed", status: newStatus },
});
```

Event name `room_event` and `{ type: "status_changed", status }` payload per SPEC §15.

**Broadcast is non-fatal.** State is already committed when we broadcast. A broadcast failure (network hiccup, channel disconnected) does not roll back and does not return 500 — we `console.warn` and return 200. Rationale:

- Postgres Changes (on the `supabase_realtime` publication, §13) are a redundant path — clients subscribed via `postgres_changes` will see the row UPDATE regardless of whether our broadcast reached them.
- Rolling back the status transition on broadcast failure would produce a worse user experience than a missed broadcast.

Injected as a dep (`broadcastRoomEvent`) so unit tests can mock it without opening real WebSocket connections.

## Authorization / lookup ordering

1. Validate URL `id` as UUID → `INVALID_ROOM_ID` (400).
2. Parse/validate body → `INVALID_BODY` / `INVALID_USER_ID` / `INVALID_STATUS` (400).
3. Load room (SELECT `id, status, owner_user_id`).
4. If not found → `ROOM_NOT_FOUND` (404).
5. If `row.owner_user_id !== userId` → `FORBIDDEN` (403).
6. If `requested ∉ ALLOWED_TRANSITIONS[row.status]` → `INVALID_TRANSITION` (409).
7. UPDATE status, SELECT the updated row (`.update(...).select().single()`).
8. If UPDATE errored → `INTERNAL_ERROR` (500).
9. Broadcast `room_event` with `{ type: "status_changed", status }`.
10. Return `{ room: mapRoom(updatedRow) }`.

Order matters: admin check runs **before** transition validity so a non-admin guessing status values can't probe state.

## Library shape

- `src/lib/rooms/updateStatus.ts` exporting `updateRoomStatus(input, deps)`.
- DI: `{ supabase: SupabaseClient<Database>; broadcastRoomEvent: (roomId, event) => Promise<void> }`.
- Return: `{ ok: true; room: Room } | { ok: false; error: {code, message, field?}; status: number }`.
- Route adapter: `src/app/api/rooms/[id]/status/route.ts` (currently a 501 stub). Thin PATCH handler that wires `createServiceClient()` and a default `broadcastRoomEvent` implementation.

## Data model impact

None. Uses existing `rooms.status` column with its existing CHECK. No schema migration.

## Additions to `api-errors.ts`

Three new codes on `ApiErrorCode`:

- `FORBIDDEN`
- `INVALID_STATUS`
- `INVALID_TRANSITION`

(These will need English messages added to `errors.*` in `en.json` when Phase 1.5 T9 lands; out of scope for this PR.)

## Test plan

### Unit tests — `src/lib/rooms/updateStatus.test.ts`

- **Happy paths**
  - `lobby → voting` returns `{ room }`, updates DB, broadcasts once.
  - `announcing → done` same shape.
- **Input validation**
  - Non-UUID `roomId` → 400 `INVALID_ROOM_ID` (no DB call).
  - Non-string / empty `userId` → 400 `INVALID_USER_ID`.
  - `status` outside `{voting, done}` (including `"scoring"`, `"announcing"`, `"lobby"`, `""`) → 400 `INVALID_STATUS`.
- **Not found:** room SELECT returns null → 404 `ROOM_NOT_FOUND` (no UPDATE, no broadcast).
- **Admin auth:** non-owner `userId` → 403 `FORBIDDEN` (no UPDATE, no broadcast).
- **Transition matrix** (parameterised over the 5×2 matrix of `currentStatus` × `requestedStatus`):
  - Allowed: `lobby→voting`, `announcing→done` — 200.
  - Rejected: all other 8 combinations → 409 `INVALID_TRANSITION`.
  - No-op: `voting→voting` — 409 (covered by the matrix).
- **Broadcast behaviour**
  - Called with `(roomId, { type: "status_changed", status: "voting" })` on happy path.
  - Called zero times on any rejection path (roomNotFound, forbidden, invalidTransition).
  - Broadcast rejection (`broadcastRoomEvent` throws) → returns 200 (not 500); `console.warn` fires with the error.
- **DB errors:** UPDATE returns `{ error }` → 500 `INTERNAL_ERROR`. (Broadcast NOT called.)

### Route-adapter tests — `src/app/api/rooms/[id]/status/route.test.ts`

- 200 + `{ room }` on happy path (`lobby → voting`).
- 400 `INVALID_BODY` on non-JSON body.
- 403 `FORBIDDEN` when the mocked owner differs from the request's userId.
- 404 `ROOM_NOT_FOUND` on unknown room.
- 409 `INVALID_TRANSITION` on `lobby → done`.

### Verification

- `npm run pre-push` clean before each commit inside the plan; full suite green at the end.
- Test count expected to grow by ~25–30 (unit + adapter).

## Non-goals / out of scope

- `voting_ending` intermediate state (§6.3.1) — requires Phase R0 schema migration.
- Shared `assertRoomAdmin` / `broadcastRoomEvent` helper modules — extract when the second caller (`/now-performing`) lands.
- Per-request session token verification — cross-cutting, deserves its own PR.
- `i18n` translation of error messages — Phase 1.5 T9 concern.
- UI consumption (lobby "Start voting" button) — Phase 2 UI tasks.
