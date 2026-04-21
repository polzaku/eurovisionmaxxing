# Design: `POST /api/rooms/{id}/votes`

**Date:** 2026-04-21
**Phase:** 3 (first item)
**SPEC refs:** §8.2 (score buttons), §8.5 (autosave), §8.7 (hot takes), §8.8 (scored-by chip), §13 (`votes` schema), §14 (routes), §15 (broadcast)

---

## 1. Goal

Deliver the server endpoint every other Phase 3 task depends on: a vote upsert that accepts partial score updates, a `missed` toggle, and a hot-take, then broadcasts per-contestant voting progress.

This slice is **server-only**. The voting UI, autosave chip, offline queue, and hot-take deletion are separate TODO items.

## 2. Scope

### In scope
- `src/lib/votes/upsert.ts` — upsert function with injected `{ supabase, broadcastRoomEvent }` dependencies, matching the `updateStatus` / `updateNowPerforming` pattern.
- `src/lib/votes/upsert.test.ts` — vitest unit tests against a mocked Supabase client.
- `src/app/api/rooms/[id]/votes/route.ts` — thin Next.js route handler that replaces the existing 501 stub.
- `voting_progress` `RoomEvent` / `RoomEventPayload` union extension (add `contestantId`).
- New `api-errors.ts` codes as needed.

### Out of scope (tracked in TODO.md)
- Voting UI (next Phase 3 item).
- `DELETE /api/rooms/{id}/votes/{contestantId}/hot-take` (R3 hot-take delete).
- Offline queue / consolidated-toast conflict reconciliation (§8.5.1–§8.5.3) — client concern.
- `voting_ending` status support (depends on R0 schema migration).
- Rejoin-token validation (existing routes don't do it; separate defence-in-depth ticket).

## 3. Request & response

### Request
```http
POST /api/rooms/{id}/votes
Content-Type: application/json

{
  "userId": "uuid",
  "contestantId": "2026-gb",
  "scores":  { "Vocals": 7, "Staging": 9 },   // optional; partial merge
  "missed":  false,                            // optional; overwrite
  "hotTake": "iconic."                         // optional; null clears; omit preserves
}
```

### Success (200)
```json
{
  "vote": {
    "id": "uuid",
    "roomId": "uuid",
    "userId": "uuid",
    "contestantId": "2026-gb",
    "scores":  { "Vocals": 7, "Staging": 9 },
    "missed":  false,
    "hotTake": "iconic.",
    "updatedAt": "2026-04-21T19:04:00Z"
  },
  "scoredCount": 2
}
```

### Errors
| Condition | `code` | HTTP |
|---|---|---|
| body not valid JSON or not an object | `INVALID_BODY` | 400 |
| `userId` missing / not UUID | `INVALID_USER_ID` | 400 |
| `roomId` not UUID | `INVALID_ROOM_ID` | 400 |
| `contestantId` missing / doesn't match `/^\d{4}-[a-z]{2}$/` | `INVALID_CONTESTANT_ID` | 400 |
| any `scores[key]` not integer in [1,10] | `INVALID_BODY` (field: `scores.<categoryName>`) | 400 |
| any `scores` key not in `rooms.categories[].name` | `INVALID_CATEGORY` (field: `scores.<categoryName>`) | 400 |
| `missed` present and not boolean | `INVALID_BODY` (field: `missed`) | 400 |
| `hotTake` present, not string-or-null, or `.length > 140` | `INVALID_BODY` (field: `hotTake`) | 400 |
| room not found | `ROOM_NOT_FOUND` | 404 |
| caller not in `room_memberships` for this room | `FORBIDDEN` | 403 |
| `room.status !== 'voting'` | `ROOM_NOT_VOTING` | 409 |
| Supabase write fails | `INTERNAL_ERROR` | 500 |

`INVALID_CONTESTANT_ID` is already in `ApiErrorCode`. All others exist.

## 4. Merge semantics

Read the existing `votes` row (if any) via `SELECT … WHERE (room_id, user_id, contestant_id)`, then build the write payload:

| Incoming field | If present | If absent |
|---|---|---|
| `scores` | `{ ...existing.scores, ...incoming.scores }` (shallow merge by category name) | keep existing |
| `missed` | overwrite | keep existing |
| `hotTake` | overwrite (`null` is valid, clears the field) | keep existing |

If no existing row, treat "existing" as `{ scores: {}, missed: false, hotTake: null }`. An all-empty request (`{ userId, contestantId }` only) creates an empty row — that's fine; the voting UI opens the row on first navigation.

Persist with `UPSERT` on `(room_id, user_id, contestant_id)` unique key. `updated_at` set by DB `DEFAULT NOW()`.

## 5. `scoredCount` semantics

Per SPEC §8.8 + §15:
- If `missed === true` → `scoredCount = 0` (missed display suppresses per-category progress).
- Otherwise → `scoredCount = Object.keys(scores ?? {}).length`, counting only integer keys that correspond to valid category names (i.e. the final merged scores object). No partial scores in MVP (buttons are all-or-nothing 1–10).

The broadcast fires **after** the DB commit with the post-merge value.

## 6. Broadcast payload

Extend `RoomEvent` in [src/types/index.ts:129](../../../src/types/index.ts#L129) and `RoomEventPayload` in [src/lib/rooms/shared.ts](../../../src/lib/rooms/shared.ts):

```ts
| { type: "voting_progress"; userId: string; contestantId: string; scoredCount: number }
```

(The current type omits `contestantId` — that's a pre-existing divergence from SPEC §15.)

Broadcast via `defaultBroadcastRoomEvent(roomId, { type: 'voting_progress', userId, contestantId, scoredCount })`. Follow the `updateStatus` pattern: commit the DB write first, best-effort broadcast, log + swallow broadcast errors. Never fail the request on broadcast failure (a missed broadcast degrades the "scored-by" chip for other clients but doesn't corrupt state).

## 7. File layout

```
src/
  lib/
    votes/
      upsert.ts            # upsertVote({...}, {supabase, broadcastRoomEvent}) → UpsertVoteResult
      upsert.test.ts       # vitest suite (~15 cases)
  app/
    api/
      rooms/
        [id]/
          votes/
            route.ts       # thin POST adapter
  types/
    index.ts               # extend RoomEvent → add contestantId to voting_progress
  lib/
    rooms/
      shared.ts            # extend RoomEventPayload to match
```

## 8. Testing plan (TDD)

Unit tests drive the implementation. Each test is one behaviour.

### Validation (red first)
1. Rejects non-JSON body → `INVALID_BODY`
2. Rejects missing/invalid `userId` → `INVALID_USER_ID`
3. Rejects invalid `roomId` → `INVALID_ROOM_ID`
4. Rejects bad `contestantId` format → `INVALID_CONTESTANT_ID`
5. Rejects non-integer score → `INVALID_BODY` with field pointer
6. Rejects score outside [1,10] → `INVALID_BODY`
7. Rejects score key not in `rooms.categories` → `INVALID_CATEGORY`
8. Rejects non-boolean `missed` → `INVALID_BODY`
9. Rejects non-string `hotTake` / oversize `hotTake` → `INVALID_BODY`

### Authorization
10. Room not found → `ROOM_NOT_FOUND`
11. Caller not a member → `FORBIDDEN`
12. `room.status = 'lobby'` → `ROOM_NOT_VOTING`
13. `room.status = 'done'` → `ROOM_NOT_VOTING`

### Happy path
14. First write (no existing row): inserts with given scores, `scoredCount = len(scores)`
15. Update existing row: shallow-merges scores, preserves untouched categories
16. `missed: true` sets the flag; `scoredCount` broadcasts as 0 regardless of scores object
17. `hotTake: null` clears the field on an existing row
18. `hotTake: "text"` upserts the hot-take
19. Broadcasts `voting_progress` exactly once with the post-merge count
20. DB commit succeeds even when broadcast throws (logged warning only)

Test scaffolding mirrors `updateStatus.test.ts` — a `makeSupabaseMock()` builder returning chainable mocks.

## 9. Verification checklist (before marking done)

- [ ] `npm test` — full suite passes, new suite included
- [ ] `npm run type-check` — zero errors
- [ ] `npm run lint` — zero warnings in new files
- [ ] Manually hit the endpoint via `curl` against a local Supabase once the dev server is running, to sanity-check the happy path (not a blocker if Supabase creds aren't available in-session — documented as a follow-up)
- [ ] Update TODO.md: check off the first Phase 3 bullet; note any follow-ups discovered

## 10. Follow-ups spawned by this design

- Add `voting_ending` to the accepted-status set once the R0 migration lands.
- Consider rejoin-token auth as a defence-in-depth layer across every write endpoint, not just this one — separate ticket.
- Client aggregation of `voting_progress` per contestant into the §8.8 chip lives in the voting UI slice.
