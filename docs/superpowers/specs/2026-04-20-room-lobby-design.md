# Design — `/room/[id]` lobby view + `POST /api/rooms/{id}/join` + `user_joined` broadcasts

**Status:** approved · **Date:** 2026-04-20 · **SPEC refs:** §6 (rooms), §6.3 (lifecycle), §6.4 (join), §15 (realtime)

## Purpose

Upgrade the `/room/[id]` stub into a functional lobby: PIN display, live participant list, admin "Start voting" CTA. Wires the pending `POST /api/rooms/{id}/join` backend endpoint (idempotent membership upsert + new `user_joined` broadcast), and adds the same `user_joined` broadcast to the existing `/join-by-pin` endpoint so the lobby's participant list updates live as guests arrive.

Closes three Phase 2 items in one PR:
- `/room/[id]` lobby view.
- `POST /api/rooms/{id}/join`.
- Real-time "who's here" list (groundwork for §6.6.2).

Non-lobby room statuses render a `StatusStub` placeholder — this PR deliberately does not build the voting / scoring / announcing / done UI.

## Backend

### `POST /api/rooms/{id}/join`

Idempotent membership upsert + `user_joined` broadcast. Mirrors `joinByPin` minus the PIN resolution.

**Request:** `POST /api/rooms/:id/join`, body `{ userId: string }`.

**Response 200:** `{ joined: true }`. (No room body; clients already have or are about to GET it.)

**Error responses**

| HTTP | `error.code` | When |
|---|---|---|
| 400 | `INVALID_BODY` | Body not JSON / not an object |
| 400 | `INVALID_ROOM_ID` | URL `id` not a UUID |
| 400 | `INVALID_USER_ID` | `userId` missing / not a non-empty string |
| 404 | `ROOM_NOT_FOUND` | No room matches the URL id |
| 409 | `ROOM_NOT_JOINABLE` | Room status ∈ `{scoring, announcing, done}` (same guard as `/join-by-pin`) |
| 500 | `INTERNAL_ERROR` | DB failure on upsert or user SELECT |

### Lib shape: `src/lib/rooms/joinRoom.ts`

```ts
export interface JoinRoomInput {
  roomId: unknown;
  userId: unknown;
}

export interface JoinRoomDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
}

export type JoinRoomResult =
  | { ok: true }
  | { ok: false; error: {code, message, field?}; status };

export async function joinRoomByMembership(
  input: JoinRoomInput,
  deps: JoinRoomDeps
): Promise<JoinRoomResult>;
```

**Ordering:**
1. Validate `roomId` (UUID), `userId` (non-empty string).
2. Load room: `SELECT id, status`. If not found → 404 `ROOM_NOT_FOUND`.
3. Status guard: same set as `joinByPin` — `{scoring, announcing, done}` → 409 `ROOM_NOT_JOINABLE`.
4. Upsert membership with `ignoreDuplicates: true`.
5. If upsert errors → 500 `INTERNAL_ERROR`.
6. SELECT `display_name, avatar_seed` from `users` for the payload. If error → 500.
7. Broadcast `{ type: "user_joined", user: { id, displayName, avatarSeed } }`. Non-fatal on failure (warn + continue).
8. Return `{ ok: true }`.

Admin check not applicable — anyone with a valid session can join.

### Existing `joinByPin` — add `user_joined` broadcast

After the successful membership upsert in `src/lib/rooms/joinByPin.ts`:
1. Take the new dep `broadcastRoomEvent: (roomId, event) => Promise<void>` (extending `JoinByPinDeps`).
2. After the upsert, SELECT `display_name, avatar_seed` for the user.
3. Broadcast `user_joined`. Non-fatal.
4. Route adapter at `src/app/api/rooms/join-by-pin/route.ts` injects `defaultBroadcastRoomEvent`.

Existing tests update:
- `happy path`: assert broadcast spy called once with `{type, user: {id, displayName, avatarSeed}}`.
- `idempotency` test: broadcast fires on both calls (unconditional).

Rejoin (double broadcast) is acceptable — lobby dedupes by userId.

### `RoomEventPayload` extension

In `src/lib/rooms/shared.ts`:

```ts
export type RoomEventPayload =
  | { type: "status_changed"; status: string }
  | { type: "now_performing"; contestantId: string }
  | { type: "user_joined"; user: { id: string; displayName: string; avatarSeed: string } };
```

## Frontend

### Page orchestrator: `src/app/room/[id]/page.tsx`

Client component (`"use client"`). Existing session-guard effect stays.

**State:**
```ts
type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; room: Room; memberships: MembershipView[]; contestants: Contestant[] };
```

**Mount flow:**
1. Session guard (existing): if no session, redirect to `/onboard?next=/room/{id}`.
2. GET `/api/rooms/{id}` via `fetchRoomData`.
3. On 404: `phase = error("This room doesn't exist…")`.
4. On 200: if `session.userId` not in `memberships`, POST `/{id}/join`, then refetch. On join error surface via `mapRoomError`.
5. On success: `phase = ready({...})`.

**Realtime subscription:** `useRoomRealtime(roomId, handler)`. Handler dispatches on `event.type`:
- `"status_changed"` → refetch room (easy: `setPhase(loading)` + rerun mount flow's fetch).
- `"user_joined"` → append to memberships if userId not already present.
- everything else → ignore.

**Render branch on `room.status`:**
- `"lobby"` → `<LobbyView room memberships isAdmin onStartVoting={…} />`.
- everything else → `<StatusStub status={status} />`.

**Admin "Start voting" callback:** calls `patchRoomStatus(roomId, "voting", userId)`. Surfaces failure via `mapRoomError` → shows inline error in `LobbyView` (optional hover prop or dedicated error slot).

### `LobbyView` component

`src/components/room/LobbyView.tsx`. Pure presentational; takes data + callbacks as props.

Props:
```ts
interface LobbyViewProps {
  room: Room;
  memberships: MembershipView[];
  isAdmin: boolean;
  startVotingState: "idle" | "submitting" | { kind: "error"; message: string };
  onStartVoting: () => void;
}
```

Layout (vertical stack, mobile-first):
1. **Room PIN** large monospace; subtle "Room PIN" caption above. Copy-to-clipboard button next to it. No toast for MVP (§6.1 Step 3 / Phase U A12 — deferred).
2. **Participants** grid of `Avatar` cards (existing `src/components/ui/Avatar.tsx`) + display names below each. Dedup by userId. Admin badge on the owner's card.
3. **Admin footer:**
   - If `isAdmin`: primary `Button` "Start voting". `disabled={startVotingState === "submitting"}`. Below, if `startVotingState.kind === "error"`, render inline error text.
   - If not admin: subtle muted line "Waiting for the host to start voting…".

### `StatusStub` component

`src/components/room/StatusStub.tsx`. Minimal placeholder:

```tsx
<main>
  <h1>{labelFor(status)}</h1>
  <p>This part of the room isn't built yet — coming soon.</p>
  <p>Status: {status}</p>
</main>
```

Labels: `voting → "Voting in progress"`, `scoring → "Tallying results"`, `announcing → "Announcement in progress"`, `done → "Show's over"`.

### Client helpers

`src/lib/room/api.ts`:
```ts
export async function fetchRoomData(roomId: string, deps: { fetch }): Promise<FetchRoomResult>;
export async function joinRoomApi(roomId: string, userId: string, deps: { fetch }): Promise<JoinRoomClientResult>;
export async function patchRoomStatus(roomId: string, status: string, userId: string, deps: { fetch }): Promise<PatchStatusClientResult>;
```

Each returns a tagged-union `{ok: true, data?} | {ok: false, code, message, field?}` matching the pattern from `submitPinToApi`. All three handle happy / 4xx / 5xx / network.

`src/lib/room/errors.ts`:
```ts
export function mapRoomError(code: string | undefined): string;
```

With entries for `ROOM_NOT_FOUND`, `FORBIDDEN`, `INVALID_TRANSITION`, `INVALID_USER_ID`, `ROOM_NOT_JOINABLE`, `NETWORK`, and a generic fallback.

## Test strategy

### Automated — lib helpers only (consistent with repo's lib-first testing)

**Backend:**
- `src/lib/rooms/joinRoom.test.ts` — happy path, validation (roomId/userId), 404, 409 parameterised over `{scoring, announcing, done}`, 200 over `{lobby, voting}`, DB error on upsert, DB error on user SELECT, broadcast called once on success, broadcast not called on reject paths, broadcast failure non-fatal.
- `src/app/api/rooms/[id]/join/route.test.ts` — 200/400/404/409.
- `src/lib/rooms/joinByPin.test.ts` (modify) — update happy/idempotency tests to assert broadcast calls.

**Frontend lib helpers:**
- `src/lib/room/api.test.ts` — fetchRoomData, joinRoomApi, patchRoomStatus: happy + 4xx body + 500 unparseable + network-error for each.
- `src/lib/room/errors.test.ts` — table test over all mapped codes + fallback.

### Manual browser smoke (user, before merge)

Documented in the plan. Key cases:
- Open `/room/<id>` with session but not a member → auto-joins, sees self in roster.
- Two browser tabs: Tab1 is host; Tab2 joins; Tab1's roster updates live.
- Tab1 clicks "Start voting"; Tab1 and Tab2 both transition to `<StatusStub status="voting" />`.
- Unknown room id → "This room doesn't exist…" error.
- Admin clicks "Start voting" from a non-lobby status (e.g. after a manual status flip via SQL) → inline "That action isn't available right now." error.

## Files

| Path | Kind |
|---|---|
| `src/lib/rooms/shared.ts` | modify — add `user_joined` variant to `RoomEventPayload` |
| `src/lib/rooms/joinByPin.ts` | modify — add `broadcastRoomEvent` dep + `user_joined` broadcast |
| `src/lib/rooms/joinByPin.test.ts` | modify — assert broadcast calls |
| `src/app/api/rooms/join-by-pin/route.ts` | modify — inject `defaultBroadcastRoomEvent` |
| `src/lib/rooms/joinRoom.ts` | **new** |
| `src/lib/rooms/joinRoom.test.ts` | **new** |
| `src/app/api/rooms/[id]/join/route.ts` | modify — wire lib |
| `src/app/api/rooms/[id]/join/route.test.ts` | **new** |
| `src/lib/room/api.ts` | **new** — three client fetch helpers |
| `src/lib/room/api.test.ts` | **new** |
| `src/lib/room/errors.ts` | **new** — `mapRoomError` |
| `src/lib/room/errors.test.ts` | **new** |
| `src/components/room/LobbyView.tsx` | **new** |
| `src/components/room/StatusStub.tsx` | **new** |
| `src/app/room/[id]/page.tsx` | modify — orchestrator |

## Non-goals / out of scope

- Presence / 30s idle grey-out (Phase R2 §6.6.2).
- Lobby countdown from `broadcastStartUtc`, late-joiner info card, contestant primer carousel (Phase R2).
- Owner's lobby-edit affordance (Phase U A2).
- `voting_ending` + 5-s undo (Phase R4, requires Phase R0 schema migration).
- Copy-link "Copied!" toast + 2-s confirmation (Phase U A12).
- Voting / scoring / announcing / done UI — entire other phases.
- RTL + jsdom for component tests — cross-cutting tooling decision.
- i18n of copy strings — Phase 1.5 T9.
- Broadcasting `user_joined` from `POST /api/rooms` (room creation). Owner is added before any realtime subscriber exists; unnecessary.

## Client-side dedup

`memberships` is appended on each `user_joined`. Dedup key: `userId`. Implementation:

```ts
setMemberships((prev) =>
  prev.some((m) => m.userId === event.user.id)
    ? prev
    : [...prev, { userId: event.user.id, displayName: event.user.displayName, avatarSeed: event.user.avatarSeed, joinedAt: new Date().toISOString(), isReady: false }]
);
```

Notes:
- `joinedAt` is client-synthesized since the broadcast doesn't carry it; acceptable because we don't render join timestamps in lobby.
- `isReady: false` default matches the DB default.

## Auto-join dedup

If `session.userId` is already present in the initial GET response's `memberships`, skip the `joinRoomApi` call. Covers the normal "joined via PIN → redirected here" flow where membership already exists.
