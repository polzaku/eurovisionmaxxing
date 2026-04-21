# Phase 4 — Scoring engine: DB orchestration + API route

**Date:** 2026-04-21
**SPEC refs:** §9 (scoring engine), §14 (API routes), §15 (realtime)
**TODO refs:** Phase 4 items 1–5 (score route + missed-fill write-back + weighted + rank+points + leaderboard)

## 1. Problem

The pure scoring pipeline (`src/lib/scoring.ts::scoreRoom`) is already implemented and tested — it turns `{categories, contestants, userIds, votes}` into `{filledVotes, results, leaderboard}`. Phase 4 needs the DB-side orchestration that:

1. Is admin-triggered via `POST /api/rooms/{id}/score`
2. Loads inputs from Supabase (categories from `rooms`, contestants via `fetchContestants`, userIds from `room_memberships`, votes from `votes`)
3. Invokes the pure pipeline
4. Writes filled `votes.scores` back (keeping `missed=true`)
5. Upserts `results` rows
6. Transitions `voting → scoring → announcing` with broadcasts

TODO Phase 4 item 6 (derive-or-cache final leaderboard for reads) is out of scope — that's `GET /api/rooms/{id}/results` territory (Phase 5). This design only computes the leaderboard and returns it in the response; persistence is the `results` rows.

TODO Phase 4 item 7 (tests) is satisfied in two layers: the pure pipeline is already covered by `src/lib/scoring.test.ts`; this phase adds orchestrator + route tests.

## 2. Module layout

- **`src/lib/rooms/runScoring.ts`** — new orchestrator. Follows the `updateStatus`/`updateNowPerforming` pattern: `runScoring(input, deps) → ScoringResult` (discriminated union). Deps-injected DB client + broadcast + `fetchContestants`. Name chosen to avoid collision with `scoreRoom` already exported from `src/lib/scoring.ts`.
- **`src/lib/rooms/runScoring.test.ts`** — unit tests with a supabase mock, mirroring `updateStatus.test.ts` conventions.
- **`src/app/api/rooms/[id]/score/route.ts`** — replaces the 501 stub. Thin adapter: parse body, call `runScoring`, map result to HTTP.
- **`src/app/api/rooms/[id]/score/route.test.ts`** — parse/dispatch coverage.

## 3. Function signatures

```ts
// src/lib/rooms/runScoring.ts
export interface RunScoringInput {
  roomId: unknown;
  userId: unknown;
}

export interface RunScoringDeps {
  supabase: SupabaseClient<Database>;
  fetchContestants: (year: number, event: EventType) => Promise<Contestant[]>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
}

export interface RunScoringSuccess {
  ok: true;
  leaderboard: LeaderboardEntry[];
}
export interface RunScoringFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}
export type RunScoringResult = RunScoringSuccess | RunScoringFailure;

export async function runScoring(input, deps): Promise<RunScoringResult>;
```

## 4. State-machine semantics

Per SPEC §9: "Transitions room from `voting` → `scoring` → `announcing`". The orchestrator drives both transitions itself (bypassing the narrower `updateRoomStatus`, which only permits `lobby→voting` and `announcing→done`):

1. Conditional UPDATE `rooms SET status='scoring' WHERE id=:id AND status IN ('voting', 'scoring')`. If 0 rows affected → 409 `ROOM_NOT_VOTING`. Accepting `scoring` as the incoming state makes the whole flow idempotent under retry (if an earlier attempt crashed mid-way the admin can POST again).
2. Broadcast `{ type: "status_changed", status: "scoring" }` (non-fatal, same try/catch/warn pattern as `updateRoomStatus`).
3. Load categories (from `rooms` row we just updated), contestants (`fetchContestants(year, event)`), userIds (from `room_memberships`), raw votes (from `votes`).
4. Call `scoreRoom({ categories, contestants, userIds, votes })` — pure, throws nothing under our inputs since precondition is enforced upstream.
5. Persist:
   - For every vote where `missed=true`, UPDATE `votes.scores` with the filled values (preserve `missed=true` per SPEC §9.1). Non-missed votes untouched.
   - UPSERT `results` rows (onConflict `(room_id, user_id, contestant_id)`), one per (user × contestant) returned by the pipeline.
6. Conditional UPDATE `rooms SET status='announcing' WHERE id=:id AND status='scoring'`. If 0 rows → `INTERNAL_ERROR` (state was tampered with mid-flight; rare).
7. Broadcast `{ type: "status_changed", status: "announcing" }`.
8. Return `{ ok: true, leaderboard }`.

**Intentionally NOT implemented in this phase:**
- `announcement_order` randomization for `live` mode — that's Phase 5.
- Awards writes — Phase 6.
- Atomic transactions across the multi-step writes. Supabase-js has no transaction client; a Postgres function would be the right long-term home, but MVP scale (≤10 users × ≤37 contestants = ≤370 results rows) makes the naïve per-step approach acceptable. Retries are idempotent because (a) the status update is conditional, (b) vote updates with identical filled values are no-ops, (c) results UPSERT on the composite PK is deterministic.

## 5. Error shapes

| Cause | HTTP | code |
|---|---|---|
| non-UUID roomId | 400 | `INVALID_ROOM_ID` |
| non-string/empty userId | 400 | `INVALID_USER_ID` |
| non-JSON body | 400 | `INVALID_BODY` |
| room missing | 404 | `ROOM_NOT_FOUND` |
| caller ≠ owner | 403 | `FORBIDDEN` |
| status ∉ {voting, scoring} | 409 | `ROOM_NOT_VOTING` |
| `fetchContestants` throws `ContestDataError` | 500 | `INTERNAL_ERROR` |
| any DB write error | 500 | `INTERNAL_ERROR` |

`ROOM_NOT_VOTING` already exists in the `ApiErrorCode` union.

The "check owner before transition" phase needs a preliminary SELECT (not strictly required by the conditional UPDATE, but `updateRoomStatus` does this for the 403 and we maintain parity). So the sequence is SELECT → owner check → conditional UPDATE (with status guard) → ...

## 6. Test plan

`runScoring.test.ts` follows `updateStatus.test.ts` structure. The supabase mock needs to handle: `rooms.select`, `rooms.update` (twice, with `.eq.eq` for the conditional), `room_memberships.select`, `votes.select`, `votes.update` (loop), `results.upsert`.

Cases:
- **Happy path** (`voting→scoring→announcing`): owner triggers; fixture has 2 users × 3 contestants, 1 missed vote. Assert: status updated twice, broadcasts fired twice, votes updated with filled scores (missed flag preserved), results upserted with correct ranks/points, leaderboard returned.
- **Happy path from `scoring`** (retry): incoming status=`scoring` also succeeds — validates idempotency guard.
- **Input validation**: non-UUID roomId, non-string userId, empty userId.
- **Not found**: room missing → 404.
- **Authorization**: caller ≠ owner → 403; no writes, no broadcasts.
- **Invalid transition**: status ∈ {lobby, announcing, done} → 409 `ROOM_NOT_VOTING`; no writes.
- **`fetchContestants` throws `ContestDataError`**: 500, status stays at `scoring` (documented, acceptable — admin retries).
- **Vote UPDATE error**: 500; no results upsert, no final transition.
- **Results upsert error**: 500; no final transition.
- **Final transition error**: 500 (raced state).
- **Broadcast failure (either)**: non-fatal; success returned; `console.warn` emitted.

`route.test.ts`:
- Rejects non-JSON body → 400 `INVALID_BODY`.
- Rejects non-object body → 400 `INVALID_BODY`.
- Passes `params.id` + body.userId through to `runScoring`.
- Propagates `{ok: true, leaderboard}` → 200 JSON.
- Propagates failure `{code, message, field?, status}` → `apiError(...)`.

## 7. File diffs summary

| Path | Delta |
|---|---|
| `src/lib/rooms/runScoring.ts` | ADD |
| `src/lib/rooms/runScoring.test.ts` | ADD |
| `src/app/api/rooms/[id]/score/route.ts` | REPLACE (was 501 stub) |
| `src/app/api/rooms/[id]/score/route.test.ts` | ADD |

No schema changes. No new packages. No locale keys (endpoint returns `code` + `message` as usual; i18n consumers render via existing `errors.*` keys — `ROOM_NOT_VOTING` already in `en.json`).

## 8. Not in this phase (tracked for later)

- GET endpoint for reading leaderboard (Phase 5 — `GET /api/rooms/{id}/results`)
- `announcement_order` randomization for live mode (Phase 5)
- Awards computation (Phase 6)
- Atomic Postgres RPC for the full pipeline (post-MVP hardening)
- UI to trigger scoring — a Phase 3 / Phase 5 concern
