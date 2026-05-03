# R6 §5.1d Admin-Driven Contestant Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Admin-only `POST /api/rooms/{id}/refresh-contestants` + a "Refresh contestants" button on the lobby, so withdrawals + running-order changes after room creation can be pulled in without tearing down the room.

**Architecture:** Pure diff helper (`contestantDiff`) + server orchestrator (`refreshContestants`) + route adapter + client fetch helper + LobbyView button slot. UI-side cooldown (button disabled for 30 s after a successful refresh) replaces server-side rate-limiting for MVP — schema cost is too high relative to abuse risk for a single-admin lobby surface. Rate-limit is a known V2 follow-up, called out in the route's JSDoc.

**Tech Stack:** Next 14 / Supabase service client / `fetchContestants` (existing) / Vitest + RTL.

---

## File Structure

**Create:**
- `src/lib/rooms/contestantDiff.ts` + `.test.ts` — pure helper computing `{ added, removed, reordered }` country codes between two contestant lists.
- `src/lib/rooms/refreshContestants.ts` + `.test.ts` — orchestrator: input validation, room load, owner guard, lobby guard, contestant re-fetch, diff, broadcast, return.
- `src/app/api/rooms/[id]/refresh-contestants/route.ts` — POST adapter using `runRequest` pattern from `src/lib/room/api.ts`.
- `src/app/api/rooms/[id]/refresh-contestants/route.test.ts` — smoke test.

**Modify:**
- `src/types/index.ts` — add `contestants_refreshed` `RoomEvent` variant: `{ type: "contestants_refreshed"; added: string[]; removed: string[]; reordered: string[] }`.
- `src/lib/rooms/shared.ts` — extend `RoomEventPayload` union.
- `src/lib/room/api.ts` — add `refreshContestantsApi(roomId, userId, deps)` client helper.
- `src/components/room/LobbyView.tsx` — admin-only "Refresh contestants" button below the share section, with cooldown state + result toast (counts of added/removed/reordered, or "Already up to date").
- `src/app/room/[id]/page.tsx` — wire `onRefreshContestants` callback + handle `contestants_refreshed` realtime event by reloading the room (refresh contestant list).
- `src/locales/en.json` — `lobby.refreshContestants.{button, busy, upToDate, summary, error}`.
- `src/hooks/useRoomRealtime.ts` — exhaustive switch must handle the new variant (silent — page handler decides what to do).

---

## Task 1: `contestantDiff` pure helper

**Files:**
- Create: `src/lib/rooms/contestantDiff.ts`
- Test: `src/lib/rooms/contestantDiff.test.ts`

Returns three arrays of country codes: `added` (in `next` not in `prev`), `removed` (in `prev` not in `next`), `reordered` (in both but with different `runningOrder`). All sorted alphabetically for stability.

Test cases:
1. Empty diff: identical lists → `{ added: [], removed: [], reordered: [] }`.
2. One added, one removed: `prev = [SE]`, `next = [UA]` → `{ added: ["UA"], removed: ["SE"], reordered: [] }`.
3. Reordered: `prev = [{SE, ro:1}, {UA, ro:2}]`, `next = [{UA, ro:1}, {SE, ro:2}]` → `{ added: [], removed: [], reordered: ["SE", "UA"] }` (sorted).
4. Mixed: drop one, add one, reorder one → all three arrays populated correctly.
5. Both empty → `{ added: [], removed: [], reordered: [] }`.

Commit: `feat(rooms): contestantDiff pure helper for refresh §5.1d`

## Task 2: `refreshContestants` orchestrator

**Files:**
- Create: `src/lib/rooms/refreshContestants.ts`
- Test: `src/lib/rooms/refreshContestants.test.ts`

Signature mirrors `updateRoomStatus` / `updateNowPerforming` shape (input object, deps with `db: SupabaseClient` + `fetchContestants` injectable + `broadcast` injectable). Returns `ApiOk<{ added, removed, reordered }>` or `ApiFail`.

Error codes (extend `ApiErrorCode` if missing):
- `INVALID_ROOM_ID` (400) — bad UUID
- `INVALID_USER_ID` (400) — bad UUID
- `ROOM_NOT_FOUND` (404)
- `FORBIDDEN` (403) — caller isn't owner
- `ROOM_NOT_IN_LOBBY` (409) — `rooms.status !== 'lobby'`
- `INTERNAL_ERROR` (500) — fetch/broadcast failures

Behaviour:
1. Validate inputs.
2. Load room via service client. If not found → 404.
3. If `caller !== room.owner_user_id` → 403. (Co-admin support is R1 — out of scope here. Helper `assertAdmin` is owner-only for now.)
4. If `room.status !== 'lobby'` → 409 `ROOM_NOT_IN_LOBBY`.
5. Call injected `fetchContestants(year, event, { cacheBypass: true })`. On `ContestDataError`: 500 (we already shipped a hardcoded fallback so this shouldn't happen for committed years; surface upstream issues).
6. Compare against the old contestant list resolved the same way (or against the broadcast cache — but the cleanest approach is "re-fetch both" since `fetchContestants` is the single source of truth and the prior list is a function of (year, event)). Wait — the SPEC says "Compares the returned list with the in-memory cached list for the room". There's no per-room contestant cache server-side; contestants are derived per-request from (year, event). So the diff is between a fresh-from-API fetch and the same-shape fetch from the local hardcoded fallback, which is what the user has been seeing. Resolve by: prev = `fetchContestants` *without* cache bypass (returns whatever the user was seeing), next = `fetchContestants` with cache bypass.
7. Broadcast `contestants_refreshed` with the diff arrays. If broadcast fails → log a warn and return success anyway (broadcast is best-effort, mirrors existing patterns in `joinByPin` etc.).
8. Return `{ added, removed, reordered }`.

Tests:
- 7 cases following the existing `updateNowPerforming.test.ts` shape: invalid room id, invalid user id, room not found, non-owner forbidden, non-lobby 409, happy path with no changes (all empty arrays), happy path with changes (broadcast fired with diff).

Commit: `feat(rooms): refreshContestants orchestrator (admin-only, lobby-only)`

## Task 3: API route adapter

**Files:**
- Create: `src/app/api/rooms/[id]/refresh-contestants/route.ts`
- Create: `src/app/api/rooms/[id]/refresh-contestants/route.test.ts`

Standard adapter: read `userId` from JSON body, call `refreshContestants`, return `runRequest` response. Test mirrors `now-performing/route.test.ts`.

Commit: `feat(api): POST /api/rooms/{id}/refresh-contestants route adapter`

## Task 4: RoomEvent variant + broadcast plumbing

**Files:**
- Modify: `src/types/index.ts` — add to `RoomEvent` union: `{ type: "contestants_refreshed"; added: string[]; removed: string[]; reordered: string[] }`.
- Modify: `src/lib/rooms/shared.ts` — same shape for `RoomEventPayload`.
- Modify: `src/hooks/useRoomRealtime.ts` — exhaustive switch: handle the new variant (no-op at hook level; consumers decide).
- Update SPEC §15 in a doc-only commit if it lists the union.

Verify with `npm run type-check` — exhaustiveness check via `never` will catch any switch missing the new arm.

Commit: `feat(types): contestants_refreshed RoomEvent variant`

## Task 5: Client helper `refreshContestantsApi`

**Files:**
- Modify: `src/lib/room/api.ts` — add helper after `postRoomScore` / `postRoomReady` family.

Signature:
```ts
export async function refreshContestantsApi(
  roomId: string,
  userId: string,
  deps: Deps,
): Promise<ApiOk<{ added: string[]; removed: string[]; reordered: string[] }> | ApiFail>
```

Test: append to existing `src/lib/room/api.test.ts` if it exists, else inline alongside other helpers' coverage pattern.

Commit: `feat(room): refreshContestantsApi client helper`

## Task 6: LobbyView "Refresh contestants" button

**Files:**
- Modify: `src/components/room/LobbyView.tsx`
- Modify: `src/components/room/LobbyView.test.tsx` — add cases for: button only renders for admin, click fires `onRefreshContestants` callback, button disables during in-flight + 30 s cooldown, result toast shows counts.

Layout: a small admin-only `<section>` between the share-section and the start-voting CTA, with the button + a ghost-styled inline result/status line. Disabled states:
- `busy` (in-flight) → label changes to `lobby.refreshContestants.busy`, spinner emoji.
- `cooldown` (30 s after success) → label stays "Refresh contestants" but `disabled={true}`; release on timer.

Toast: a `<p role="status">` rendered inline (not floating) for one of:
- `lobby.refreshContestants.upToDate` — "Already up to date — nothing changed."
- `lobby.refreshContestants.summary` with ICU plurals: "{added} added · {removed} dropped · {reordered} reordered"
- `lobby.refreshContestants.error` — "Couldn't refresh — try again."

Commit: `feat(lobby): admin Refresh contestants button + cooldown + result toast`

## Task 7: Wire callback in `/room/[id]` page

**Files:**
- Modify: `src/app/room/[id]/page.tsx`

- Add `handleRefreshContestants` callback that calls `refreshContestantsApi`, returns the `{added, removed, reordered}` (or fail) for the LobbyView to render its toast.
- Handle `contestants_refreshed` realtime event: when payload has any non-empty array, `void loadRoom()` to pick up the new contestant list.

Commit: `feat(room): wire LobbyView refresh-contestants callback + realtime reload`

## Task 8: Locale keys + verify + TODO + PR

- Add `lobby.refreshContestants.*` keys to `en.json`.
- `npm run type-check`, `npm run lint`, `npm test`. All green.
- Tick TODO.md lines 291 + 292.
- Commit + push + PR.

---

## Self-Review

**Spec coverage (§5.1d):**
- Endpoint shape ✅ Task 3
- Admin-only auth ✅ Task 2 (FORBIDDEN code)
- Lobby-only guard ✅ Task 2 (ROOM_NOT_IN_LOBBY code)
- §5.1 cascade re-run with cache bypass ✅ Task 2 (injects cacheBypass:true)
- Diff computation (added / removed / reordered) ✅ Task 1
- Broadcast `contestants_refreshed` ✅ Task 4
- Response body shape `{ added, removed, reordered }` ✅ Task 2 + 5
- Rate limit 1/30s — **partial** (UI-side cooldown only). Documented as MVP limitation in route JSDoc; server-side rate limit deferred to V2 (cheap to add when a `last_contestant_refresh_at` migration lands with R1).

**Out of scope for this slice:**
- §5.1e fetch loading state in `/create` Step 1 (debounce/slow-copy/timeout) — separate item, ship-floor #4.
- §5.3 allocation-draw-lag wizard copy — separate item.
- Server-side rate limit — see above.
- Co-admin handling — gated on R1 (which is V1.1).

**Type consistency:**
- `RoomEvent` union additions match across `src/types/index.ts` (client) + `src/lib/rooms/shared.ts` (server).
- `refreshContestants` return shape (`{added, removed, reordered}`) matches the broadcast payload, the API response, and the LobbyView toast input — single shape, no transforms.
