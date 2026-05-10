# R4 "Finish the show" batch-reveal mode — design

**Date:** 2026-05-10
**TODO ref:** [TODO.md:268](../../../TODO.md#L268) (Phase R4 §10.2.1)
**SPEC ref:** §10.2.1 lines 980–982 ("All users absent simultaneously")
**Slice:** R4 stage 2 of 3. Builds on R4 #1 (advance-time cascade-skip, merged via PR #95). Follows item #3 (`/present` "Awaiting an admin to continue…" copy + TV-surface broadcast subscriber).

## Problem

R4 #1 added a server-authoritative cascade-skip: when `advanceAnnouncement` rotates from announcer A to the next user, absent users are skipped, their `results.announced` flags flipped to `true` (silent leaderboard reveal, no per-point banner), and their userIds appended to `rooms.announce_skipped_user_ids`. When the cascade exhausts the order with no present user, the room lands in `status='announcing' AND announcing_user_id=null` — a sentinel state with no UX exit today. The admin sees nothing; the show stalls forever until the room is manually transitioned.

SPEC §10.2.1 specifies the resolution:

> If the server advances and every subsequent entry in `announcement_order` is absent (including any co-admins), the admin is offered *"Finish the show"* — a single large button that transitions the admin into a **batch-reveal mode**: all remaining points for all absent users are revealed in sequence by the admin tapping "Next point" like a normal announcer. Each point is still attributed to the original user in the record (`points_awarded`), just revealed by the admin.

Two reads of the spec collide:

- Line 967 (per-skip during normal flow): *"Skipped users' points are NOT revealed in MVP. Their points still contribute to the final leaderboard (already written during scoring) — but the dramatic individual reveal is suppressed."*
- Line 981 (cascade-exhaust): *"all remaining points for all absent users are revealed in sequence by the admin..."*

Today's R4 #1 cascade matches line 967 unconditionally — it silent-marks every cascade-skipped user's results as `announced=true`. So at exhaust time, nothing is pending. "Finish the show" has nothing to reveal.

The design resolves the contradiction by treating the two cases differently: **silent-mark only when the show is continuing** (line 967 fires, momentum preserved); **leave pending when the show is exhausting** (line 981 fires, admin gets to reveal).

## Goals

- **Server-authoritative cascade refactor**: defer the `applySingleSkip` call until the cascade outcome is known. Found-present → silent-mark trailing skipped users. Exhausted → leave them pending for batch reveal.
- **Explicit batch-reveal mode flag**: new `rooms.batch_reveal_mode BOOLEAN` column. Cascade short-circuits when true; rotation walks announcement_order mechanically, finding the next user with unrevealed results.
- **Single new endpoint** `POST /api/rooms/{id}/finish-show` that transitions a cascade-exhausted room into batch-reveal mode.
- **UI affordance** in `<AnnouncingView>`: cascade-exhaust state surfaces a "Finish the show" CTA for the owner; non-owners see "Waiting for the host to continue…".
- **Termination invariant**: when the last skipped user's last unrevealed point is announced, status flips to `done` and `batch_reveal_mode` resets to `false`.

## Non-goals

- `/present` "Awaiting an admin to continue…" copy + TV-surface `<SkipBannerQueue>` broadcast subscriber — item #3, separate slice.
- Admin-absent fallback (room sits in `announcing` until admin or co-admin reconnects) — item #3.
- Mid-batch-reveal handoff to a different admin — out of MVP scope.
- "Pull the absent user back to active" mid-batch-reveal — covered by the existing `restoreSkipped` endpoint (PR #89/#90), but not explicitly tested in batch-reveal context here.
- V2 "claim your turn" rejoin (mentioned in line 967) — explicitly deferred.

## Architecture

Two coordinated changes:

### (a) Cascade refactor (probe-then-mark)

Both `advanceAnnouncement` (rotation cascade) and `runScoring` (pre-cascade at `scoring → announcing`) currently call `applySingleSkip` *inside* the cascade probe loop. The refactor moves it *after* the loop:

```
# BEFORE
while probePos < length:
    if isAbsent(...):
        applySingleSkip(probeUser)   ← silent-mark in-loop
        cascadedSkipped.push(probeUser)
        probePos++
    else: break

# AFTER
while probePos < length:
    if isAbsent(...):
        cascadedSkipped.push(probeUser)   ← probe-only
        probePos++
    else: break

if probePos < length:
    # Found present user — silent-mark trailing skipped users now
    for user in cascadedSkipped:
        applySingleSkip(user)
    nextAnnouncingUserId = order[probePos]
else:
    cascadeExhausted = true
    nextAnnouncingUserId = null
    # Skipped users' results stay announced=false for batch reveal
```

Identical change in `runScoring`. Same conditional UPDATE guards apply. The behavior change is observable: cascade-exhausted rooms now have `announced=false` rows for the cascade-skipped users; per-rotation cascades preserve today's silent-mark behavior.

### (b) Batch-reveal mode

Schema:

```sql
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS batch_reveal_mode BOOLEAN NOT NULL DEFAULT FALSE;
```

State machine additions:

| State | `status` | `announcing_user_id` | `batch_reveal_mode` |
|---|---|---|---|
| Cascade-exhausted (sentinel) | `announcing` | `NULL` | `FALSE` |
| Batch-reveal active | `announcing` | non-null | `TRUE` |
| Done | `done` | non-null | `FALSE` |

Entry: `POST /api/rooms/{id}/finish-show` (see §4). Exit: when the last unrevealed result is announced, the orchestrator flips `status='done'` and `batch_reveal_mode=false` in the same UPDATE.

## Components

### 1. Schema migration

```sql
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS batch_reveal_mode BOOLEAN NOT NULL DEFAULT FALSE;
```

- Single ALTER. NOT NULL with default — every existing row gets `false`. No data risk.
- Update [supabase/schema.sql](../../../supabase/schema.sql) and [SUPABASE_SETUP.md](../../../SUPABASE_SETUP.md) changelog.

### 2. Cascade refactor in `advanceAnnouncement`

In `src/lib/rooms/advanceAnnouncement.ts`, replace the in-loop `applySingleSkip` call with a probe-only loop, then a post-loop branch:

- Loop body: only push to `cascadedSkippedUserIds`; no DB write.
- After loop: if `probePos < announcers.length`, iterate `cascadedSkippedUserIds` and call `applySingleSkip` for each (preserving the short-circuit-on-error behavior from R4 #1's bug fix). If `probePos >= announcers.length`, set `cascadeExhausted=true` and emit broadcasts but do NOT mark.

The conditional UPDATE guard at step 7 (`eq(announcing_user_id, currentAnnouncer)` etc.) stays unchanged.

The success-return field `cascadedSkippedUserIds: string[]` keeps the same contract — callers continue to see the list of skipped users in cascade order.

### 3. Cascade refactor in `runScoring`

Same shape as §2, applied to the pre-cascade in `src/lib/rooms/runScoring.ts`. The pre-cascade runs at the `scoring → announcing` transition and operates on the freshly-shuffled order from index 0.

The all-absent-at-start case (e.g., the host triggers scoring after every guest has closed their tab) lands in cascade-exhausted state with all users having `announced=false` results. Batch-reveal then walks the entire order.

### 4. `finishTheShow` orchestrator + route

**File:** `src/lib/rooms/finishTheShow.ts` + `src/app/api/rooms/[id]/finish-show/route.ts`.

**Input:** `{ roomId, userId }`.
**Authorization:** owner-only (`room.owner_user_id === userId`); 403 otherwise. Co-admin support is R1 territory; this slice mirrors `skipAnnouncer`'s owner-only check.

**State guard:** `status='announcing' AND announcing_user_id IS NULL AND batch_reveal_mode=false`. Anything else → 409 `NOT_IN_CASCADE_EXHAUST_STATE`.

**Logic:**
1. Load room (with `announcement_order`, `announce_skipped_user_ids`).
2. For each user in `announce_skipped_user_ids` (in array order), query their `results` rows in this room. The first user with any `announced=false` row becomes `firstBatchAnnouncer`.
3. If no such user → 409 `NO_PENDING_REVEALS`. (Defensive — with §2/§3 cascade refactor, exhaust always leaves at least one user with unrevealed points.)
4. Conditional UPDATE on `rooms`: set `batch_reveal_mode=true`, `announcing_user_id=firstBatchAnnouncer`, `current_announce_idx=0`. Guard: `status='announcing' AND announcing_user_id IS NULL AND batch_reveal_mode=false`. On zero rows → 409 `RACE`.
5. Fetch the first batch announcer's display name (single-row lookup — only one user transitions at this point, not the bulk lookup the cascade does).
6. Broadcast a new `RoomEvent` variant: `{ type: 'batch_reveal_started', announcingUserId, displayName }`. Non-fatal try/catch.

**Response:** `{ ok: true, announcingUserId, displayName }`.

### 5. `advanceAnnouncement` batch-reveal branch

When `batch_reveal_mode=true`, the existing presence-cascade does NOT run. Instead, when the current announcer's last-row reveal lands (`isLastForAnnouncer && !finishedShow`):

1. Walk `announcement_order` from `currentAnnouncer's index + 1`.
2. For each candidate: query `count(results) where room_id=X AND user_id=candidate AND announced=false`. (Or fetch their results with `announced=false` and check empty.)
3. If `count > 0`: this is the next batch announcer. `nextAnnouncingUserId = candidate`. Break.
4. If `count = 0`: candidate was silent-marked earlier (historical skip). Advance silently — no `announce_skip` broadcast, no banner.
5. If walk exhausts: `nextAnnouncingUserId = null`, `finishedShow = true`, `roomPatch.status = 'done'`, `roomPatch.batch_reveal_mode = false`.

The reveal mechanics (which row to mark `announced=true`) are unchanged — the existing `announcerResults` query at the top of the orchestrator already orders by rank ascending so each tap reveals the next-lowest-points pick.

Delegate handling: `delegate_user_id` is orthogonal to batch-reveal mode. The owner can use the existing handoff endpoint to delegate batch-reveal driving to a co-admin if desired (R1 will formalize this); for MVP, owner drives.

### 6. New `RoomEvent` variant

Add to `src/types/index.ts` `RoomEvent` union and `src/lib/rooms/shared.ts` `RoomEventPayload`:

```ts
| { type: "batch_reveal_started"; announcingUserId: string; displayName: string }
```

Subscriber updates: `<AnnouncingView>` (and any future `<PresentScreen>` work) should re-fetch room state on this event so the UI swings from cascade-exhaust CTA to batch-reveal active view.

### 7. UI in `<AnnouncingView>`

**Derived state:**
```ts
const isCascadeExhausted =
  room.status === "announcing" &&
  !announcingState?.announcingUserId &&
  !room.batchRevealMode;
```

**Owner branch:** prominent "Finish the show" primary CTA, with subtitle *"All remaining announcers are absent — finish revealing on their behalf"*. Routes through new `postFinishShow(roomId)` client helper.

**Non-owner branch:** waiting copy *"Waiting for the host to continue…"*.

**Batch-reveal active rendering:** when `batchRevealMode=true`, the existing announcer-of-record header renders with the original user's display name (data-attribution stays accurate). Add a chip/subtitle *"Host is finishing the show"* near the header. Reuses the existing component shape — no new layout primitive.

`<PresentScreen>` updates are **out of scope** for this slice. The TODO comment placed in PR #95 references the broadcast subscriber that item #3 will add.

### 8. Locale keys

Under the existing `announce.*` namespace:

```json
"announce": {
  ...,
  "finishTheShow": {
    "ownerCta": "Finish the show",
    "ownerSubtitle": "All remaining announcers are absent — finish revealing on their behalf",
    "guestWaiting": "Waiting for the host to continue…",
    "batchRevealChip": "Host is finishing the show"
  }
}
```

Other locale stubs follow the empty-key convention from `locales.test.ts`.

## Tests

### Unit / integration

- **`finishTheShow.test.ts`** (5 cases):
  - Happy path: cascade-exhausted state with one skipped user pending → 200, sets `batch_reveal_mode=true`, sets `announcing_user_id`, broadcasts `batch_reveal_started`.
  - Multiple skipped users with mixed announced/unannounced results: picks the first in array order with any pending row.
  - Wrong state (`announcing_user_id != null`): 409 `NOT_IN_CASCADE_EXHAUST_STATE`.
  - No pending reveals (defensive): 409 `NO_PENDING_REVEALS`.
  - Non-owner caller: 403 `FORBIDDEN`.
  - Race (state changed under us): 409 `RACE`.

- **`advanceAnnouncement.test.ts` extensions** (3 new + refactor existing):
  - Cascade refactor: rotation case still calls `applySingleSkip` for cascaded users (just at a different point in the orchestrator); existing assertions update to inspect post-loop `applySingleSkip` calls.
  - Cascade-exhaust refactor: `applySingleSkip` is **not** called for cascade-exhausted users; their `results.announced` flags stay false. Tests update to assert the absence of those calls.
  - Batch-reveal rotation: `batch_reveal_mode=true` + current announcer's last reveal → walks order, lands on next user with unrevealed results.
  - Batch-reveal silent-skip: rotation candidate has all-announced results (historical silent-mark) → advance to the user after them, no `announce_skip` broadcast emitted for the silent-skip.
  - Batch-reveal terminal: walk exhausts → `status='done'`, `batch_reveal_mode=false`.

- **`runScoring.test.ts` extensions:** mirror cascade refactor — pre-cascade exhaust does NOT call `applySingleSkip`; pre-cascade with present user found does call it for trailing skipped users.

### RTL

- **`AnnouncingView.test.tsx` extensions:**
  - Cascade-exhaust state for owner renders "Finish the show" CTA. Tap routes through `postFinishShow`.
  - Cascade-exhaust state for non-owner renders waiting copy.
  - Batch-reveal active state renders the announcer's display name + "Host is finishing the show" chip.

### Playwright

- **`announce-cascade.spec.ts` extension:**
  - New seed state `announcing-cascade-all-absent`: order `[A]` only (or `[A, B, C]` with all absent at start of announcing — drives the all-absent-at-start path).
  - Test flow: load as owner → cascade-exhausted state visible → tap "Finish the show" → assert announcing_user_id = first absent user → drive their reveals via existing reveal CTA → rotate to next absent → continue → eventually status=done.

## Slice plan (one PR)

1. Schema migration + types refresh ([supabase/schema.sql](../../../supabase/schema.sql), [SUPABASE_SETUP.md](../../../SUPABASE_SETUP.md), [src/types/database.ts](../../../src/types/database.ts), [src/types/index.ts](../../../src/types/index.ts), [src/lib/rooms/shared.ts](../../../src/lib/rooms/shared.ts) for the new RoomEvent variant).
2. `advanceAnnouncement` cascade refactor (probe-then-mark) + extended tests.
3. `runScoring` pre-cascade refactor + extended tests.
4. `finishTheShow.ts` orchestrator + `finishTheShow.test.ts` + route adapter + `postFinishShow` client helper.
5. `advanceAnnouncement` batch-reveal branch + tests.
6. `<AnnouncingView>` cascade-exhaust UI + batch-reveal chip + RTL.
7. Locale keys (`announce.finishTheShow.*`).
8. Seed state extension (`announcing-cascade-all-absent`) + Playwright spec extension.
9. TODO tick + push + PR.

Roughly 4 files added, ~7 modified. ~1 active day at current pace.

## Risks

- **Cascade refactor is a behavior change to just-shipped code.** Existing R4 #1 unit tests assert `applySingleSkip` is called inside the cascade loop. The refactor moves the call to after the loop. Tests need updating, not because the behavior is wrong but because the in-loop assertion moves to a post-loop assertion. Easy to verify: total number of `applySingleSkip` calls in the rotation case stays the same as before; in the exhaust case it drops from N to 0.
- **Race between cascade-exhaust and a late-arriving heartbeat.** A user could heartbeat just as the cascade probe completes, marking themselves "present" milliseconds after being included in the skip list. This is identical to today's race (no change introduced by this slice). The conditional UPDATE on `rooms` (`status='announcing' AND announcing_user_id=null`) protects against the room being mutated under us; if a different concurrent advance lands first, we get `RACE` and the client refetches.
- **Spec line 967 vs 981 reading.** This design leans on a particular interpretation: silent-mark only applies when the show is continuing. If product preference is "always preserve pending for V2 'claim your turn' rejoin" (not in MVP), the cascade refactor here aligns with that future direction. If preference is "always silent-mark, batch-reveal is purely cosmetic", a separate spec revision is required — flag this for product review before merge.
- **Owner-absent during batch-reveal.** If the owner taps "Finish the show" then loses connection mid-reveal, the room sits in batch-reveal mode with no driver. Item #3 handles this generally (the `/present` "Awaiting an admin to continue…" copy already covers the announcing-with-no-driver case; batch-reveal is a special case of that). For this slice, no additional handling — the existing handoff endpoint can be invoked by a co-admin if R1 ships.
