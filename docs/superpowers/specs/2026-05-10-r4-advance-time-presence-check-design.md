# R4 advance-time presence check — design

**Date:** 2026-05-10
**TODO ref:** [TODO.md:265](../../../TODO.md#L265) (Phase R4 §10.2.1)
**SPEC ref:** §10.2.1 "Announcement-order edge cases", lines 960–982
**Slice:** R4 stage 1 of 3. Items #2 ("Finish the show" batch reveal) and #3 (`/present` "Awaiting an admin to continue…") consume this slice's `announcing_user_id = null + status = 'announcing'` sentinel.

## Problem

When `advanceAnnouncement` rotates from announcer A to the next user B at the end of A's reveal queue, the rotation happens unconditionally. If B is absent (closed tab, lost connection, never connected), the room visually rotates to B and stalls — no one is on B's phone to tap "Reveal next point", so the show waits indefinitely until an admin manually fires `skipAnnouncer`.

SPEC §10.2.1 specifies the fix:

> When advancing to the next announcer, the server checks the target user's presence on `room:{roomId}` (last seen ≤30 s).
> If absent: server sets `rooms.announce_skipped_user_ids` += this user's id, surfaces *"[User] isn't here — their points are being skipped"* as a brief banner on all clients for 3 s, advances the pointer to the next user.

Today the only path that writes `announce_skipped_user_ids` is the admin-driven `skipAnnouncer` endpoint (PR #56). It needs an automatic counterpart that fires at advance-time without requiring an admin to push a button.

## Goals

- **Server-authoritative absence detection** at every rotation point (`scoring → announcing` transition + every reveal that ends an announcer's queue).
- **Cascade behaviour** — one advance call drains all absent users between the current announcer and the next present user, so the room never displays an absent user as "current announcer".
- **Reuse existing scaffolding** — `announce_skipped_user_ids` column, `announce_skip` broadcast event variant, the result-row "mark announced" pattern from `skipAnnouncer`.
- **Set up items #2/#3** — when the cascade exhausts the order with no present user, leave the room in `announcing` with `announcing_user_id = null` so the next slices can hang batch-reveal mode + the `/present` waiting screen on that sentinel.

## Non-goals

- "Finish the show" batch-reveal mode (item #2).
- `/present` "Awaiting an admin to continue…" copy (item #3).
- Mid-turn absence detection (a user revealing 3 of 12 points then disappearing). Spec is explicit: the check fires at rotation, not continuously. Mid-turn absence stays handled by the existing manual `skipAnnouncer` endpoint.
- Server-side cron auto-promoting co-admins after 5 min admin absence (R1).
- Admin-confirm UX (the spec wants automatic; we follow the spec).

## Architecture

Two state-mutating call sites both invoke the same cascade helper:

```
runScoring (scoring → announcing transition)
  └─ before setting announcing_user_id = order[0],
     cascade-skip absent users from the front of order

advanceAnnouncement (live reveals)
  └─ at the moment current announcer's queue ends,
     cascade-skip absent users while rotating to next
```

Both emit `announce_skip` broadcasts (one per skipped user, in cascade order). When the cascade exhausts the order with no present user, `announcing_user_id` is set to `null`, status remains `announcing`. That's the sentinel item #2 will hang the "Finish the show" CTA on.

Server is authoritative throughout. The client never decides who to skip. The admin's phone holds no load-bearing role in this flow.

## Components

### 1. Schema migration (additive, single column)

```sql
ALTER TABLE room_memberships
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
```

- Nullable. NULL = "never seen" → treated as absent.
- Mirrors the `scores_locked_at` pattern from S0.
- Update [supabase/schema.sql](../../../supabase/schema.sql) and [SUPABASE_SETUP.md](../../../SUPABASE_SETUP.md) changelog with the same `ADD COLUMN IF NOT EXISTS` form.

### 2. Pure helper — `src/lib/rooms/isAbsent.ts`

```ts
export function isAbsent(
  lastSeenAt: string | null,
  now: Date,
  thresholdMs = 30_000,
): boolean {
  if (!lastSeenAt) return true;
  return now.getTime() - new Date(lastSeenAt).getTime() > thresholdMs;
}
```

No Supabase dep. Heavy unit-test coverage: null, fresh, exactly-30 s (boundary, returns false), >30 s, custom threshold.

### 3. Heartbeat write path

**Hook:** `useRoomHeartbeat(roomId, userId, active: boolean)`. Fires `PATCH /api/rooms/{id}/heartbeat` **immediately on mount** then every **15 s** while `active`. Stops on unmount or `active` flip. Wired on `<RoomPage>` with `active = true` whenever the page is mounted (any room status).

- 15 s cadence + 30 s threshold means a single dropped heartbeat doesn't immediately mark absent; two consecutive drops do.
- **Why all statuses, not just `announcing`:** the pre-cascade in `runScoring` runs at the exact moment `scoring → announcing` flips. If heartbeats only ran during `announcing`, no client would have heartbeated yet at that instant — every user would be flagged absent. By heartbeating across `lobby` / `voting` / `voting_ending` / `scoring` / `announcing`, `last_seen_at` is always ≤30 s fresh for any actively-mounted client at every transition.
- The fire-on-mount avoids the same race for clients that join mid-`announcing` (e.g., a re-joiner): their first heartbeat lands within milliseconds of mount, not 15 s later.
- Cost: one indexed `room_memberships` UPDATE per 15 s per active client. Negligible.

**Endpoint:** `PATCH /api/rooms/{id}/heartbeat`. Owner / member required. Calls `recordHeartbeat({ roomId, userId })`.

**Orchestrator:** `recordHeartbeat` UPDATEs `room_memberships.last_seen_at = NOW()` filtered by `(room_id, user_id)`. Returns `{ ok: true }`. Errors: `ROOM_NOT_FOUND` (no row matched), `INTERNAL_ERROR` (DB error). No status guard — heartbeats are accepted in any room status (cheap; future slices may want them in voting too).

### 4. Cascade helper extraction

`skipAnnouncer.ts` already does almost everything one cascade step needs:
- append to `announce_skipped_user_ids`,
- mark all of the skipped user's results as `announced`,
- advance the pointer.

Extract a private `applySingleSkip(roomTx, skippedUserId, broadcasts)` helper that both `skipAnnouncer` and the new cascade share. **No behaviour change to the existing admin-driven skip endpoint** — the refactor preserves all its current 403/404/409 paths and broadcasts.

### 5. Cascade in `advanceAnnouncement`

After the existing step 6 ("determine next state"), if `nextAnnouncingUserId !== null && !finishedShow`:

1. Query `room_memberships.last_seen_at` for `nextAnnouncingUserId`.
2. If `isAbsent(lastSeenAt, new Date())`:
   - `applySingleSkip` for that user.
   - Compute the user after them in `announcement_order`.
   - Loop back to step 1.
3. Otherwise: proceed with the existing rotation (set `announcing_user_id = nextAnnouncingUserId`).

If the cascade exhausts the order: set `announcing_user_id = null`, status stays `announcing`, return success with `finished: false` and a new field `cascadeExhausted: true`.

The conditional UPDATE guard (`announcing_user_id = currentAnnouncer AND current_announce_idx = expectedIdx`) is preserved so concurrent advance calls still get `ANNOUNCE_RACED`.

### 6. Pre-cascade in `runScoring`

Just before the existing line 362 (`announcingPatch.announcing_user_id = order[0]`), run the cascade from `order[0]`:

1. For each user in `order` from index 0:
   - Query their `last_seen_at`.
   - If absent: `applySingleSkip` (in-memory accumulation, since the room row doesn't exist in `announcing` state yet — we apply to the patch we're about to commit).
   - Otherwise: stop, set `announcingPatch.announcing_user_id = order[i]`.
2. If all absent: `announcingPatch.announcing_user_id = null`.

Subtle implementation note: in `runScoring`, the `applySingleSkip` shape needs to also stage the `announce_skipped_user_ids += [skippedUserId]` and the result-row `announced = true` updates within the same transaction that flips the room to `announcing`. The cascade emits its broadcasts after the commit, mirroring the rest of the codebase.

### 7. Broadcasts and banner UX

- One `announce_skip` per cascaded user, in cascade order. Existing event variant (`{ type: 'announce_skip', userId, displayName }`) — no schema change.
- Frontend already has a subscriber on `<AnnouncingView>` and `<PresentScreen>`. Add a tiny client-side queue: events landing within 2 s of each other render sequentially, 3 s each.
- **MVP simplification:** if the cascade emits >3 events within 2 s, render a single coalesced banner *"3 skipped: Alice, Bob, Carol"* (or *"4 skipped: Alice, Bob, Carol +1"* at >3 names) and skip the per-user sequence. Avoids a 9+ second banner train.
- Banner copy stays as spec'd: *"[User] isn't here — their points are being skipped"* for single skips.

### 8. Out-of-scope sentinels surfaced

After this slice lands, the codebase will have a new observable state: `rooms.status = 'announcing' AND announcing_user_id = null`. This slice does **not** add any UI for that state — it's the sentinel that:
- Item #2 reads to display the "Finish the show" CTA in `<AnnouncingView>` and engage batch-reveal mode.
- Item #3 reads to display "Awaiting an admin to continue…" on `/present`.

For this slice, the existing `<AnnouncingView>` + `<PresentScreen>` will render their default empty-state when `announcing_user_id` is null. That's acceptable as an interim — the next slice replaces it within days.

## Tests

### Unit / integration

- `isAbsent.test.ts` — null, fresh, exactly-30 s (boundary, false), >30 s, custom threshold.
- `recordHeartbeat.test.ts` — happy path, room not found, not a member, idempotent (consecutive calls succeed).
- `advanceAnnouncement.test.ts` — extend with:
  - Single skip on rotation (next is absent, after-next is present).
  - Cascade through 3 absent users, lands on the 4th.
  - Cascade exhausts the order → `announcing_user_id = null`, status stays `announcing`, `cascadeExhausted: true`.
  - Current announcer online + next online (no skip — golden path regression).
  - Broadcast count matches skip count + the regular `announce_next` / `score_update` pair.
- `runScoring.test.ts` — extend with:
  - Pre-cascade skips the first 2 absent users; lands on order[2].
  - Pre-cascade with all absent → `announcing_user_id = null`, `announce_skipped_user_ids = [...all]`.
  - Pre-cascade with idx 0 present (no skips, golden path regression).

### RTL

- `AnnouncingView.test.tsx` — queues + renders sequential `announce_skip` banners (3 s each); coalesces to single banner at >3 events within 2 s.

### Playwright (`tests/e2e/announce-cascade.spec.ts`)

Why E2E pulls weight here: the cascade is timing-sensitive (banner queue ordering, sequential `announce_skip` events arriving via Realtime), and unit tests can't catch a regression where the broadcast emits but the client banner queue mis-orders.

Build on the T7 `scripts/seed-room.ts` infrastructure. Add (or extend) a seed state that produces a 4-announcer order [A, B, C, D] where B and C have `last_seen_at` stamped 60 s in the past. A is the active announcer (idx 0).

**Test 1 — cascade through two absent users:**
- Single Chromium context signed in as the admin (owner). Land on `/room/[id]`.
- Drive A's reveals to the end via the existing reveal CTA.
- Assert in sequence:
  - Two `announce_skip` banners appear in order: *"Bob isn't here — their points are being skipped"*, then *"Carol isn't here — …"*.
  - Active announcer header transitions to D's display name.
  - Polling `/api/results/[id]`: `announce_skipped_user_ids` contains B's and C's UUIDs.

**Test 2 — cascade exhausts:**
- Seed state with order [A, B, C] where B and C are absent. Drive A's reveals to the end.
- Assert: two banners in sequence; `announcing_user_id` becomes null in `/api/results/[id]` payload; status stays `announcing` (NOT `done`); the existing empty-state renders.

## Slice plan (one PR)

1. Schema migration + types refresh ([supabase/schema.sql](../../../supabase/schema.sql), [SUPABASE_SETUP.md](../../../SUPABASE_SETUP.md), [src/types/database.ts](../../../src/types/database.ts)).
2. `isAbsent.ts` + `isAbsent.test.ts` (TDD).
3. `recordHeartbeat.ts` orchestrator + `recordHeartbeat.test.ts` + `PATCH /api/rooms/[id]/heartbeat` route adapter.
4. `useRoomHeartbeat` hook + wiring on `<RoomPage>`.
5. Refactor `skipAnnouncer` to extract `applySingleSkip` helper. All existing tests still pass.
6. Cascade in `advanceAnnouncement` + extended `advanceAnnouncement.test.ts`.
7. Pre-cascade in `runScoring` + extended `runScoring.test.ts`.
8. Frontend banner queue + extended RTL on `<AnnouncingView>`.
9. Seed-room state extension + `tests/e2e/announce-cascade.spec.ts`.

Roughly 6 files added, ~5 modified, +1 seed state. ~1 active day at current pace.

## Risks

- **Heartbeat traffic during a 25-announcer live show**: 25 clients × 1 PATCH per 15 s = ~100 writes/min on `room_memberships`. Single-row UPDATEs, indexed on `(room_id, user_id)`. Negligible cost on Supabase Free tier; well within rate limits.
- **Cascade timing on slow connections**: a present user with a slow phone might miss a heartbeat window and get incorrectly skipped. 30 s threshold is generous (covers two missed cycles) but a user on a flaky 3 G connection could be falsely skipped. Mitigation: spec accepts this trade-off — the alternative is the show stalling, which is worse. Restore is one tap by the admin.
- **`runScoring` rollback complexity**: the pre-cascade modifies `announce_skipped_user_ids` and result-row `announced` flags within the same transaction as the room status flip. If any step fails, the whole transition must roll back. The existing `runScoring` already handles partial-failure rollback (see runScoring.test.ts coverage); the pre-cascade just adds more stages to the same atomic step.
- **Banner UX on `/present`**: spec line 966 says *"a brief banner on all clients for 3 s"* — `/present` is a "client" too. Verify `<PresentScreen>` subscribes to `announce_skip` and renders the banner; if it doesn't yet, this slice adds it.
