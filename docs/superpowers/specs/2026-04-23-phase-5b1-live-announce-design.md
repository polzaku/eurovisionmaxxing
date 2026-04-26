# Phase 5b.1 — Live-mode announce state machine (core)

**Date:** 2026-04-23
**SPEC refs:** §10.2 (live announcement flow), §15 (realtime channels)
**TODO refs:** Phase 5 items "live announcement_order randomization", "POST /api/rooms/{id}/announce/next"

## 1. Goal

Ship the server-authoritative announce state machine for `announcement_mode = 'live'`: server decides who's announcing, what point comes next, mutates state atomically, broadcasts. Clients react. Just enough UI on `/room/[id]` for the announcer to drive the flow; the polished `/present` TV view is 5c.

## 2. Scope

**In:**
1. `runScoring` extension — when `announcement_mode === 'live'`, shuffle members and write `announcement_order`, `announcing_user_id`, `current_announce_idx = 0` in the final transition to `announcing`.
2. `src/lib/rooms/advanceAnnouncement.ts` — orchestrator. Auth (announcer or owner), advance the per-announcer reveal pointer, mark the corresponding `results.announced = true`, rotate to the next announcer when current finishes, transition `announcing → done` when all announcers finish.
3. `POST /api/rooms/[id]/announce/next` — route adapter.
4. Extend `RoomEventPayload` with `announce_next` and `score_update` so the orchestrator's broadcasts type-check.
5. Minimal `<AnnouncingView>` on `/room/[id]` when `status === 'announcing'`: announcer name + avatar, "Reveal next point" button (announcer or admin only), compact live leaderboard. No animations, no fancy chrome — that's 5c.

**Out (deferred):**
- `/room/[id]/present` fullscreen TV view — 5c.
- `POST /api/rooms/[id]/announce/handoff` + `delegate_user_id` migration — 5b.2.
- Absent-user skip / restore / reshuffle / finish-the-show — Phase R4 §10.2.1 edge cases.
- Instant-mode reveal flow — 5d.
- Awards reveal sequence — Phase 6.
- Deterministic shuffle seed (SPEC §10.2.1) — MVP uses `Math.random`; reproducibility added when audit log lands.

## 3. Reveal mechanics (SPEC §10.2)

Each user announces their own 1-through-12 points (the Eurovision sequence: `1, 2, 3, 4, 5, 6, 7, 8, 10, 12` — 10 points awarded, ranks 11+ get 0).

- The announcer reveals points lowest → highest. So at `current_announce_idx = 0`, they're calling out **1 point** to their **rank-10** contestant. At `idx = 9`, **12 points** to their **rank-1**.
- General rule: at `idx = N`, the contestant being revealed is the announcer's rank-`(M − N)` pick, where `M` = number of points-awarded rows for that user. Edge case: with fewer than 10 contestants in the field (e.g. the year-9999 test fixture has 5), `M < 10` and the announcer reveals fewer points before rotating.
- `current_announce_idx` is per-announcer; resets to 0 on rotation.

## 4. State transitions

```
[scoring]
  |
  v   (runScoring — for live mode, set announcement_order + announcing_user_id + current_announce_idx=0)
[announcing]
  |
  v   (advanceAnnouncement — N times per announcer, then rotate)
[announcing] (next announcer)
  |
  v   (advanceAnnouncement — last announcer's last point)
[done]
```

**At each `advanceAnnouncement` call:**
1. Validate auth: caller is `announcing_user_id` OR room owner.
2. Look up the announcer's per-rank results (filtered to `points_awarded > 0`, sorted by `rank DESC` so position 0 is the lowest-points pick).
3. The row at `current_announce_idx` is what gets revealed.
4. Mark that result row `announced = true` (idempotent UPDATE on the (room_id, user_id, contestant_id) PK).
5. Compute the broadcast payloads:
   - `announce_next`: `{ contestantId, points, announcingUserId }`
   - `score_update`: `{ contestantId, newTotal, newRank }` — newTotal = SUM of points_awarded over all `announced = true` rows for that contestant; rank computed against the current public leaderboard (competition ranking, ties share position).
6. Determine next state:
   - If `idx + 1 < userPicksCount`: bump `current_announce_idx` (same announcer continues).
   - Else if there's a next user in `announcement_order`: set `announcing_user_id = order[order.indexOf(current) + 1]`, `current_announce_idx = 0`.
   - Else: transition to `done`, clear `announcing_user_id`. Broadcast `status_changed:done`.
7. Write the new state in a single conditional UPDATE (`WHERE id = :id AND status = 'announcing' AND announcing_user_id = :current AND current_announce_idx = :idx`). 0 rows affected → 409 (state mutated by a concurrent caller).

## 5. API contract

```
POST /api/rooms/[id]/announce/next
Body: { userId: string }

200 → {
  contestantId: string,
  points: number,
  announcingUserId: string,         // who just revealed
  newTotal: number,                 // contestant's new running total
  newRank: number,                  // contestant's new rank
  nextAnnouncingUserId: string | null,  // null if all finished
  finished: boolean                 // true if status flipped to 'done'
}

400 INVALID_ROOM_ID — non-UUID path param
400 INVALID_USER_ID — missing/empty userId
404 ROOM_NOT_FOUND
403 FORBIDDEN — caller is neither current announcer nor room owner
409 ROOM_NOT_ANNOUNCING — room not in 'announcing' status (or no announcement_order)
409 ANNOUNCE_RACED — current_announce_idx / announcing_user_id changed under us
500 INTERNAL_ERROR — DB write failure
```

`ROOM_NOT_ANNOUNCING` and `ANNOUNCE_RACED` are new `ApiErrorCode` values to add.

## 6. `runScoring` change (live-mode init)

In addition to the existing scoring→announcing transition, when `announcement_mode === 'live'`:

- Shuffle `userIds` via Fisher-Yates with `Math.random()`.
- Filter to users who have **at least one** `points_awarded > 0` row (a user with all 0s can't announce — they only get rank 11+ contestants in their list and there's nothing to reveal). For the MVP this should be rare; but the test fixture and small-room edge case may produce it. Such users are silently excluded from `announcement_order`.
- The conditional UPDATE writes `status='announcing'`, `announcement_order = [...]`, `announcing_user_id = order[0]`, `current_announce_idx = 0` in one go.

For `announcement_mode === 'instant'`: status update only, no order. Existing behaviour.

## 7. Module layout

```
src/lib/rooms/runScoring.ts                    # extend (no new file)
src/lib/rooms/runScoring.test.ts               # +cases for live-mode init
src/lib/rooms/advanceAnnouncement.ts           # NEW
src/lib/rooms/advanceAnnouncement.test.ts      # NEW
src/lib/rooms/shared.ts                        # extend RoomEventPayload union
src/app/api/rooms/[id]/announce/next/route.ts  # REPLACE 501 stub
src/app/api/rooms/[id]/announce/next/route.test.ts  # NEW (already exists?)

src/components/room/AnnouncingView.tsx         # NEW (minimal client)
src/lib/room/api.ts                            # +postAnnounceNext
src/app/room/[id]/page.tsx                     # branch on status='announcing' → AnnouncingView

src/lib/api-errors.ts                          # +ROOM_NOT_ANNOUNCING, ANNOUNCE_RACED
src/locales/en.json                            # +error keys + announcing.* UI strings
```

## 8. Test plan

**Unit (vitest):**

- `runScoring.test.ts` — new cases:
  - `announcement_mode === 'live'` populates `announcement_order` (sorted by some deterministic-in-test seam), `announcing_user_id = order[0]`, `current_announce_idx = 0` in the announcing transition.
  - `announcement_mode === 'instant'` writes only `status: 'announcing'` (no order touched).
  - Live-mode: users with no `points_awarded > 0` rows are excluded from `announcement_order`.
  - Live-mode with 0 eligible announcers: still transitions to `announcing` but `announcement_order = []` and `announcing_user_id = null` — admin sees "no eligible announcers" path (UI handled later).
- `advanceAnnouncement.test.ts`:
  - Input validation (UUID, userId).
  - Room not found / 404.
  - Status not announcing → 409 `ROOM_NOT_ANNOUNCING`.
  - Caller neither current announcer nor owner → 403.
  - Happy path: middle-of-announcer reveal — bumps idx, marks one result row, broadcasts both events, returns expected payload.
  - Last reveal of current announcer → rotates to next user, idx resets to 0.
  - Last reveal of last announcer → transitions to `done`, clears `announcing_user_id`, broadcasts `status_changed:done`.
  - Idempotency / race: second concurrent call returns 409 `ANNOUNCE_RACED` (conditional UPDATE returns 0 rows).
  - DB write failures (results UPDATE, room UPDATE) → 500 with no broadcast.
  - Broadcast failure non-fatal (matches runScoring/updateStatus pattern).

- Route tests: identical pattern to existing endpoints — invalid body, success passthrough, failure mapping.

**Manual (browser):**

1. Create a room with `announcement_mode = 'live'` using the year-9999 fixture (5 contestants), 2+ users vote.
2. Admin taps "End voting" → status flips to `announcing`. Both clients refetch.
3. The announcer (announcement_order[0]) sees their name highlighted + the "Reveal next point" button. Other guests see "{Name} is announcing" without the button.
4. Tap "Reveal next point" — page updates: leaderboard shows the revealed contestant's points; the next reveal preview updates.
5. Walk through all 5 reveals × 2 users = 10 taps total → status flips to `done` → `/results/{roomId}` now renders the full done state.

## 9. Risks & non-goals

- **No deterministic shuffle seed** — replays of the same room produce different orders. SPEC §10.2.1 calls for a stored seed for reproducibility; deferred until an audit-log feature actually consumes it.
- **No presence-based skip** — an absent user blocks the flow indefinitely. R4 §10.2.1 fixes this; MVP relies on the room owner using the (also-deferred) handoff to keep things moving.
- **No /present screen yet** — guests have to read the announcer chrome inside the regular `/room/[id]` view. 5c addresses this.
- **No animation** — score updates render as plain text changes. `animate-rank-shift` from §3.2 is 5c chrome.
- **No instant mode** — 5d.
