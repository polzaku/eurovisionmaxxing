# Phase 4 — Scoring engine implementation plan

Spec: [`docs/superpowers/specs/2026-04-21-phase-4-scoring-engine-design.md`](../specs/2026-04-21-phase-4-scoring-engine-design.md)

TDD: write the failing test, run it, confirm the failure is for the right reason, then make it pass. One logical step per commit. `npm run type-check` + `npm test` green before each commit.

## Step 1 — Orchestrator: input validation (red → green)

**Tests first** (`src/lib/rooms/runScoring.test.ts`):
- non-UUID `roomId` → 400 `INVALID_ROOM_ID` + field
- non-string or empty `userId` → 400 `INVALID_USER_ID` + field

**Impl** (`src/lib/rooms/runScoring.ts`):
- Export types. UUID regex guard. Early-return `fail(...)` on invalid input. No DB access yet — DB mock unused.

## Step 2 — Orchestrator: room load + ownership

**Tests:**
- room missing → 404 `ROOM_NOT_FOUND`
- SELECT errors → 404 `ROOM_NOT_FOUND` (parity with `updateStatus`)
- caller ≠ owner → 403 `FORBIDDEN`; no writes; no broadcast

**Impl:** SELECT `id, owner_user_id, status, year, event, categories` from `rooms`. Owner check.

## Step 3 — Status guard + transition to `scoring`

**Tests:**
- current status in {lobby, announcing, done} → 409 `ROOM_NOT_VOTING`
- current `scoring` → treated as retry (proceeds; test just confirms no 409 is raised, leaves remaining flow as later steps)

**Impl:** If status ∉ {voting, scoring} → 409. Otherwise conditional UPDATE `status='scoring' WHERE id=:id AND status IN ('voting','scoring')`. Assert returned row or fall through to 500.

Broadcast `status_changed:scoring` after the update. Non-fatal.

## Step 4 — Load full inputs for the pure pipeline

**Tests:**
- Mock `room_memberships.select` returning 2 users + mock `votes.select` returning 6 votes + mock `fetchContestants` returning 3 contestants → assert they flow into the assertion target (to be exercised via the happy-path test in step 6).

**Impl:** 
- SELECT `user_id` from `room_memberships` where room_id=:id (ordered by joined_at to make output deterministic).
- SELECT `id, room_id, user_id, contestant_id, scores, missed, hot_take, updated_at` from `votes` where room_id=:id. Map to domain `Vote` shape.
- `await deps.fetchContestants(room.year, room.event)` — catch `ContestDataError` → 500 `INTERNAL_ERROR`.

## Step 5 — Invoke pure pipeline + write-back

**Tests:**
- Happy path on a 2-user × 3-contestant fixture with 1 missed vote:
  - `votes.update` called once per missed vote with `{ scores: filledValues }` (missed stays true implicitly — we don't write it). Non-missed votes NOT updated.
  - `results.upsert` called once with all 6 rows (2 users × 3 contestants), correct rank/points derived from the pure function's known output.
- Vote UPDATE error → 500; no `results.upsert` call; no final status transition.
- Results upsert error → 500; no final status transition.

**Impl:**
- Call `scoreRoom({ categories, contestants, userIds, votes })` from `@/lib/scoring`.
- For each `filledVote` where `missed` is true: UPDATE `votes` SET `scores=:filled` WHERE `id=:id`. (Filter by id keeps it targeted and scoped.)
- UPSERT `results` rows with onConflict `(room_id, user_id, contestant_id)`. Build array from `out.results`.

## Step 6 — Transition to `announcing` + broadcast + return

**Tests:**
- Happy-path integration: asserts both status updates occurred in order, both broadcasts fired, returned `{ok: true, leaderboard}` matches pure-pipeline expectation.
- Second status UPDATE errors → 500 `INTERNAL_ERROR` (documented-rare race).
- Broadcast failure on either step → still returns success; warn logged.
- Idempotent retry: initial status=`scoring`, everything succeeds the second time.

**Impl:**
- Conditional UPDATE `status='announcing' WHERE id=:id AND status='scoring'`. Error → 500.
- Broadcast `status_changed:announcing`. Non-fatal.
- Return `{ ok: true, leaderboard: out.leaderboard }`.

## Step 7 — Route adapter (`POST /api/rooms/[id]/score`)

**Tests** (`route.test.ts`):
- Invalid JSON body → 400 `INVALID_BODY`.
- Non-object body (e.g. array) → 400 `INVALID_BODY`.
- Missing userId → propagates 400 `INVALID_USER_ID` (delegated).
- Success → 200 `{ leaderboard }`.
- Failure → `apiError(code, message, status, field)`.

**Impl:** Replace 501 stub. Pattern: identical to [src/app/api/rooms/[id]/status/route.ts](../../src/app/api/rooms/[id]/status/route.ts) but with `runScoring` and `fetchContestants` injected.

## Step 8 — Verification

- `npm test` — all green (149 existing + new).
- `npm run type-check` — clean.
- `npm run pre-push` — clean.
- Tick Phase 4 items in `TODO.md`.

## Out of scope / explicit non-goals

- No UI to trigger scoring (Phase 5).
- No awards (Phase 6).
- No `announcement_order` randomization (Phase 5).
- No Postgres transaction RPC (post-MVP).
- No `GET /api/rooms/{id}/results` — Phase 5.
