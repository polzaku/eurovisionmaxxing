# Design — `PATCH /api/rooms/{id}/now-performing` (+ shared helpers extraction)

**Status:** approved · **Date:** 2026-04-19 · **SPEC refs:** §5.2 (contestant IDs), §6.5 (now-performing UX), §14 (API), §15 (broadcasts)

## Purpose

Admin-only endpoint that sets the currently-performing contestant on a room and broadcasts the change so all subscribed clients can optionally snap their voting UI to that card. Second caller of the admin-auth and broadcast patterns introduced by `PATCH /api/rooms/{id}/status`, which is the trigger to extract the shared helpers flagged in that PR's design doc.

## Contract

**Request** — `PATCH /api/rooms/:id/now-performing`, JSON body:

```
{ "contestantId": string, "userId": string }
```

**Response 200:**

```
{ "room": Room }
```

Full updated Room, with `nowPerformingId` set to the requested contestant id. Mapped through the same shape `createRoom` / `getRoom` / `updateStatus` emit.

**Error responses**

| HTTP | `error.code` | When |
|---|---|---|
| 400 | `INVALID_BODY` | Body not JSON / not an object |
| 400 | `INVALID_ROOM_ID` | URL `id` not a UUID |
| 400 | `INVALID_USER_ID` | `userId` missing or not a non-empty string |
| 400 | `INVALID_CONTESTANT_ID` | `contestantId` missing / non-string / length 0 or > 20 |
| 403 | `FORBIDDEN` | caller `userId` ≠ `rooms.owner_user_id` |
| 404 | `ROOM_NOT_FOUND` | No such room |
| 409 | `NOW_PERFORMING_DISABLED` | Room's `allow_now_performing` is `false` |
| 409 | `ROOM_NOT_VOTING` | Room status is not `voting` |
| 500 | `INTERNAL_ERROR` | DB UPDATE failure |

## Behaviour decisions

### Relaxed `contestantId` validation

`contestantId` is validated as a non-empty string of length ≤ 20 (matches the DB column `VARCHAR(20)`). **No strict `{year}-{countryCode}` regex** — the format is a convention documented in §5.2, not a DB constraint. Fallback IDs produced by `getCountryCode` can deviate from the standard 2-letter code (first-two-letters-lowercased of the country name). Rejecting convention-weird-but-valid IDs is worse than accepting them; a garbage ID round-trips as a no-op on the client side (the UI just won't match any card).

### Rejection ordering

1. Body shape / type validation (400 family).
2. Load room (`SELECT id, status, owner_user_id, allow_now_performing`).
3. Not found → `404 ROOM_NOT_FOUND`.
4. `row.owner_user_id !== userId` → `403 FORBIDDEN`.
5. `allow_now_performing === false` → `409 NOW_PERFORMING_DISABLED`.
6. `status !== 'voting'` → `409 ROOM_NOT_VOTING`.
7. UPDATE, broadcast, return.

**Admin check runs before state checks** so a non-admin probing for feature enablement or room status always receives the same 403 regardless of the room's configuration.

### Two distinct state-rejection codes

| Code | Meaning | Client remediation |
|---|---|---|
| `NOW_PERFORMING_DISABLED` | Creation-time opt-out (`allow_now_performing: false`) | None — the room didn't enable this feature. Hide/disable the control. |
| `ROOM_NOT_VOTING` | Transient room state (`status` is `lobby` / `scoring` / `announcing` / `done`) | Wait / start voting / accept show is over. |

Folding these into a single `ROOM_STATE_INVALID` loses information the UI actually uses.

### Broadcast

Same contract as `status_changed`: fire-and-await, non-fatal on failure. State is already committed when we broadcast, and Postgres Changes (via the `supabase_realtime` publication, §13) are a redundant delivery path. Broadcast failure logs a warning and returns 200.

Payload per §15:

```ts
{ type: "now_performing"; contestantId: string }
```

## Library shape

- `src/lib/rooms/updateNowPerforming.ts` exporting `updateRoomNowPerforming(input, deps)`.
- DI: `{ supabase: SupabaseClient<Database>; broadcastRoomEvent: (roomId, event) => Promise<void> }`.
- Return: `{ ok: true; room: Room } | { ok: false; error: {code, message, field?}; status: number }`.
- Route adapter at `src/app/api/rooms/[id]/now-performing/route.ts` (currently 501 stub) — thin, wires `createServiceClient` and the extracted `defaultBroadcastRoomEvent`.

## Data model impact

None. Uses existing `rooms.now_performing_id` column. No migration.

## Refactor: shared helpers extraction (bundled — Option A)

Create `src/lib/rooms/shared.ts` exporting three primitives currently duplicated across two or three files:

### 1. `mapRoom`

Maps a `Database["public"]["Tables"]["rooms"]["Row"]` to the domain `Room`. Currently duplicated identically in `create.ts`, `get.ts`, `updateStatus.ts`. Move to `shared.ts`; the three call sites import it.

### 2. `RoomEventPayload`

Discriminated union of realtime broadcast payloads. Currently has one variant in `updateStatus.ts`; this PR adds a second.

```ts
export type RoomEventPayload =
  | { type: "status_changed"; status: string }
  | { type: "now_performing"; contestantId: string };
```

Export from `shared.ts`. `updateStatus.ts` and `updateNowPerforming.ts` import.

### 3. `defaultBroadcastRoomEvent`

The `supabase.channel(...).send(...)` default currently inlined in `status/route.ts`. Move verbatim to `shared.ts`. Both route adapters import it.

### Regression guarantee

The refactor must produce **zero behavioural change** for the three existing endpoints. Verification: `create.test.ts`, `get.test.ts`, `updateStatus.test.ts`, their matching route-adapter tests, and `status/route.test.ts` all remain green with no test-code changes of their own.

### Why bundle (not a separate refactor PR)

- The refactor is tiny (~40 lines extracted, three files lose ~15 lines each).
- Doing it alongside the new endpoint means the new endpoint imports from `shared.ts` from day one, instead of being written with fresh local copies that a follow-up refactor has to sweep.
- Every future `/api/rooms/{id}/*` endpoint lands cheaper.

## Additions to `api-errors.ts`

Three new codes on `ApiErrorCode`:

- `INVALID_CONTESTANT_ID`
- `NOW_PERFORMING_DISABLED`
- `ROOM_NOT_VOTING`

(Phase 1.5 T9 will later wire these into `errors.*` translation keys.)

## Test plan

### Unit tests — `src/lib/rooms/updateNowPerforming.test.ts`

- **Happy path:** status=`voting` + `allow_now_performing=true` → returns `{ room }`, UPDATEs DB with `{ now_performing_id: contestantId }`, broadcasts `{ type: 'now_performing', contestantId }` exactly once.
- **Input validation**
  - Non-UUID `roomId` → 400 `INVALID_ROOM_ID`.
  - Non-string / empty `userId` → 400 `INVALID_USER_ID`.
  - `contestantId` non-string / empty / > 20 chars → 400 `INVALID_CONTESTANT_ID`.
- **Not found:** room SELECT returns null → 404 `ROOM_NOT_FOUND` (no UPDATE, no broadcast).
- **Admin auth:** non-owner → 403 `FORBIDDEN` (no UPDATE, no broadcast).
- **`NOW_PERFORMING_DISABLED`:** `allow_now_performing=false`, status=`voting` → 409 (no UPDATE, no broadcast).
- **`ROOM_NOT_VOTING`:** parameterised over `{lobby, scoring, announcing, done}` with `allow_now_performing=true` — each → 409.
- **Broadcast failure non-fatal:** broadcast throws → 200 + `console.warn`.
- **DB UPDATE error:** → 500 `INTERNAL_ERROR`, no broadcast.

### Route-adapter tests — `src/app/api/rooms/[id]/now-performing/route.test.ts`

- 200 + `{ room }` on happy path.
- 400 `INVALID_BODY` on non-JSON body.
- 403 `FORBIDDEN` when mocked owner differs from request userId.
- 404 `ROOM_NOT_FOUND` on unknown room.
- 409 `ROOM_NOT_VOTING` when mocked room status is `lobby`.

### Regression tests (pre-existing, must remain green)

- `src/lib/rooms/create.test.ts` (34 tests).
- `src/lib/rooms/get.test.ts` (12 tests).
- `src/lib/rooms/updateStatus.test.ts` (30 tests).
- All three route-adapter test files.

### Verification

- `npm run pre-push` (tsc + vitest) clean before each commit in the plan.
- Expected final count: +~25 tests over the current 281 baseline.

## Files touched

| Path | Kind |
|---|---|
| `src/lib/api-errors.ts` | modify — add 3 codes |
| `src/lib/rooms/shared.ts` | **new** — `mapRoom`, `RoomEventPayload`, `defaultBroadcastRoomEvent` |
| `src/lib/rooms/create.ts` | modify — delete local `mapRoom`, import from `shared.ts` |
| `src/lib/rooms/get.ts` | modify — delete local `mapRoom`, import from `shared.ts` |
| `src/lib/rooms/updateStatus.ts` | modify — delete local `mapRoom` + `RoomEventPayload`, import |
| `src/app/api/rooms/[id]/status/route.ts` | modify — delete local `defaultBroadcastRoomEvent`, import |
| `src/lib/rooms/updateNowPerforming.ts` | **new** — pure handler |
| `src/lib/rooms/updateNowPerforming.test.ts` | **new** — unit tests |
| `src/app/api/rooms/[id]/now-performing/route.ts` | modify — wire adapter |
| `src/app/api/rooms/[id]/now-performing/route.test.ts` | **new** — adapter tests |

## Non-goals / out of scope

- **Validating `contestantId` against the room's actual contestant list.** Requires `fetchContestants` dependency + latency; not required by SPEC.
- **Clearing `now_performing_id` (set to null).** SPEC §6.5 describes the admin tapping contestants, not a clear control. Adding a nullable mode is easy later if needed.
- **`assertRoomAdmin` helper extraction.** The admin check is 2 lines; cross-endpoint shape varies (some need extra fields in the SELECT). Keep inline for now.
- **i18n of error messages.** Phase 1.5 T9.
- **UI consumption** (admin "now performing" control panel, non-admin snap indicator). Phase 2 UI tasks, Phase U item V12/A10.
