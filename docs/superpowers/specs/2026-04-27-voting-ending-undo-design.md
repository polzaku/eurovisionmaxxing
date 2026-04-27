---
title: "End voting" 5-second undo window
date: 2026-04-27
spec_anchor: SPEC §6.3.1, §13, §15
phase: R0 (partial) + R4 §6.3.1
status: design
---

# "End voting" undo — implementation design

Maps SPEC §6.3.1 onto schema, types, API, and UI changes. SPEC §6.3.1 is the source of truth for the user-facing flow; this doc captures the implementation shape and the server-authoritative timing strategy.

## Problem

Today, the admin's "End voting" tap is final: a `window.confirm` dialog gates it but there is no undo path. A mis-tap in a noisy living room kicks off scoring and freezes every guest's vote. SPEC §20 #5 (Definition of Done) explicitly requires a "5-second undo window".

Additionally, the current control is a floating top-right pill that overlaps the contestant card on narrow viewports — smoke-tested 2026-04-26 as visually out of place.

## Scope

In:
- New room status `voting_ending`, written to the schema with a 5-second `voting_ends_at` deadline.
- Admin path: tap End voting → modal confirm → status moves to `voting_ending`, all clients render countdown.
- Admin can tap **Undo** while `now() < voting_ends_at` to revert to `voting`.
- At t≤0, admin client fires `POST /api/rooms/{id}/score`; existing `runScoring` accepts `voting_ending` and atomically transitions to `scoring`.
- Refresh-proof: countdown anchored on server-issued `votingEndsAt`; admin reload re-renders remaining time and auto-fires if elapsed.
- Guest UX: passive pill ("Voting ending in 5s…") at top of screen; no Undo. Voting writes still permitted during `voting_ending` per SPEC.
- Replaces the floating top-right pill with a header-chrome button next to the SaveChip cluster.

Out:
- 30-s admin idle hand-off (R4 separate item).
- Force-finalize button for non-admins when room stuck (V2 polish).
- Shimmer overlay during `scoring` (Phase U L9 separate).
- Server-side cron / pg_cron timer (rejected as Option C in brainstorm — Vercel cron is min 1 minute).

## Decision: who fires the `voting_ending → scoring` transition?

**Option A (chosen):** Admin client owns the timer and fires `POST /score`. Existing `runScoring` accepts `voting_ending` status. Atomic SQL conditional update (`UPDATE ... WHERE status IN ('voting','voting_ending') AND voting_ends_at <= now()`) makes only the first call succeed; concurrent callers get the same scored room.

Edge case (admin disconnect during countdown): room stuck in `voting_ending`. On admin's next page load, the page checks `voting_ends_at <= now()` and auto-fires `/score`. Acceptable for MVP. Non-admin force-finalize is V2.

Rejected:
- **Option B** (any member can finalize) — bigger API surface, duplicates score-trigger logic.
- **Option C** (server cron) — Vercel cron 1-minute resolution; Supabase pg_cron extension setup. Massive overkill.

## Architecture

### 1. Schema (`supabase/schema.sql` + `supabase/migrations/`)

```sql
ALTER TABLE rooms ALTER COLUMN status TYPE VARCHAR(14);
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_status_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_status_check
  CHECK (status IN ('lobby','voting','voting_ending','scoring','announcing','done'));
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS voting_ends_at TIMESTAMPTZ;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS voting_ended_at TIMESTAMPTZ;
```

Both timestamps nullable. `voting_ends_at` is set on `voting → voting_ending` and cleared on `voting_ending → voting` (undo). `voting_ended_at` is set when `voting_ending → scoring` actually fires; it's audit-only and not consumed by application logic in this slice.

### 2. Types

```ts
// src/types/index.ts
export type RoomStatus =
  | "lobby" | "voting" | "voting_ending"
  | "scoring" | "announcing" | "done";

export type RoomEvent =
  | { type: "status_changed"; status: RoomStatus }
  | { type: "voting_ending"; votingEndsAt: string }   // NEW
  | ... // existing variants

// src/lib/rooms/shared.ts
export type RoomEventPayload =
  | { type: "status_changed"; status: string }
  | { type: "voting_ending"; votingEndsAt: string }   // NEW
  | ... // existing variants

// src/types/database.ts (regenerated/extended)
rooms.Row = { ...; voting_ends_at: string | null; voting_ended_at: string | null }
```

The existing forward-compat `voting_ending` mention in `loadResults.ts` and `loadResults.test.ts` continues to work without changes.

### 3. API extensions

#### `PATCH /api/rooms/{id}/status` (`updateRoomStatus`)

Extend the requested-status set and transitions table:

```ts
const ALLOWED_REQUESTED_STATUSES = new Set([
  "voting",          // existing (lobby → voting AND voting_ending → voting undo)
  "voting_ending",   // NEW
  "done",            // existing (announcing → done)
]);

const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  lobby: ["voting"],
  voting: ["voting_ending"],         // NEW (replaces direct voting → scoring via /score for spec compliance)
  voting_ending: ["voting"],          // NEW (undo)
  announcing: ["done"],
};
```

On `voting → voting_ending`:
- Write `{ status: 'voting_ending', voting_ends_at: now() + interval '5 seconds' }` in a single update.
- Broadcast `{ type: 'voting_ending', votingEndsAt: <iso> }` to the room channel.

On `voting_ending → voting` (undo):
- Validate `now() < voting_ends_at` server-side. If past deadline → 409 `INVALID_TRANSITION`.
- Update `{ status: 'voting', voting_ends_at: null }`.
- Broadcast `{ type: 'status_changed', status: 'voting' }`.

Admin auth check unchanged.

#### `POST /api/rooms/{id}/score` (`runScoring`)

Modify the status guard:

```ts
// before
if (room.status !== "voting" && room.status !== "scoring") { fail(...); }

// after
if (room.status !== "voting" && room.status !== "voting_ending" && room.status !== "scoring") {
  fail(...);
}
if (room.status === "voting_ending" && room.voting_ends_at && new Date(room.voting_ends_at) > new Date()) {
  fail("VOTING_ENDING_NOT_ELAPSED", "Cannot finalize before the countdown completes.", 409);
}
```

Atomic transition update:
```ts
.update({ status: "scoring", voting_ended_at: new Date().toISOString() })
.eq("id", roomId)
.in("status", ["voting", "voting_ending", "scoring"])
```

`voting_ended_at` is written atomically with the status flip. Idempotent under retry remains correct.

### 4. UI on `/room/[id]`

Three new components plus a removal:

#### `<EndVotingModal>` — `src/components/voting/EndVotingModal.tsx`

Replaces `window.confirm`. Standard modal pattern: backdrop, dialog, title + body + cancel + confirm. Confirm calls `PATCH /status { status: 'voting_ending' }`. Body copy: *"Voting ends in 5 seconds. You can undo within that window."*

Uses native `<dialog>` with `showModal()`/`close()` for accessibility (or a div+role=dialog if dialog doesn't fit existing UI patterns — verify against [src/components](src/components) before implementing).

#### `<EndVotingCountdownToast>` — admin-only

Mounted on `/room/[id]` whenever `room.status === 'voting_ending'` AND viewer is the room owner. Position: top of screen (`position: fixed; top: 0`), full-width, accent color.

Content:
- Live countdown: derived from `votingEndsAt - now()` via `votingEndingTimer()` helper. Tick interval: 100 ms (smoothness without too much rerender churn). Display as `Math.max(0, Math.ceil(remainingMs / 1000))`.
- Big **Undo** button — calls `PATCH /status { status: 'voting' }`.
- When `remainingMs <= 0`: hide Undo, show "Finalising…", fire `POST /score` once (guarded by `firedRef.current`).

#### `<EndingPill>` — guest variant

Mounted whenever `room.status === 'voting_ending'` AND viewer is NOT the owner. Smaller, top-of-screen, passive: "Voting ending in {n}s…". No buttons. Continues VotingView underneath unchanged.

#### Header-chrome End-voting button (replaces floating pill)

Remove the existing `<div className="fixed top-3 right-3 z-30">` block in [src/app/room/[id]/page.tsx:341-361](src/app/room/[id]/page.tsx). Add an `<EndVotingButton>` inline in `<VotingView>`'s header — positioned next to the existing SaveChip / progress cluster (admin-only conditional). Tap → opens `<EndVotingModal>`.

### 5. Pure helper

`src/lib/rooms/votingEndingTimer.ts`:

```ts
export interface VotingEndingTimerInput {
  votingEndsAt: string | null;        // ISO; null when status is not voting_ending
  now: Date;
}

export interface VotingEndingTimerResult {
  remainingMs: number;                 // clamped >= 0; 0 if expired or null input
  remainingSeconds: number;            // ceil(remainingMs / 1000), clamped >= 0
  expired: boolean;                    // true if votingEndsAt is non-null and <= now
}

export function votingEndingTimer(input: VotingEndingTimerInput): VotingEndingTimerResult;
```

8 unit tests:
1. null input → `{remainingMs: 0, remainingSeconds: 0, expired: false}` (no countdown to render)
2. ISO 5s in future, now is reference time → 5000ms / 5s / not expired
3. ISO 4500ms in future → 4500ms / 5s (ceil) / not expired
4. ISO at exactly now → 0ms / 0s / expired
5. ISO 1ms in past → 0ms (clamped) / 0s / expired
6. ISO 100ms in future → 100ms / 1s (ceil) / not expired
7. Invalid ISO string → `{remainingMs: 0, remainingSeconds: 0, expired: false}` — graceful fallback
8. ISO far future (1 hour) → 3 600 000ms / 3600s / not expired

### 6. Locale keys

`voting.endVoting.*`:
- `button` — *"End voting"*
- `modal.title` — *"End voting?"*
- `modal.body` — *"Voting ends in 5 seconds. You can undo within that window."*
- `modal.confirm` — *"End voting"*
- `modal.cancel` — *"Cancel"*
- `countdown.body` — *"Voting ends in {seconds}s"*
- `countdown.finalising` — *"Finalising…"*
- `countdown.undo` — *"Undo"*
- `guest.body` — *"Voting ending in {seconds}s…"*

9 keys in `en.json`. Non-en bundles stay empty (Phase L L3 gate).

### 7. Realtime wiring

`src/hooks/useRoomRealtime.ts` — handle the new `voting_ending` event variant in the message switch (refetch room + memberships, or just refetch room — match existing `status_changed` pattern). Exhaustive-check `never` branch confirms no new variants are missing.

### 8. Admin disconnect / refresh path

In `src/app/room/[id]/page.tsx`, add a `useEffect` that runs whenever the resolved room is loaded:

```ts
useEffect(() => {
  if (phase.kind !== "ready") return;
  const r = phase.room;
  if (r.status !== "voting_ending") return;
  if (!isAdmin) return;
  if (!r.votingEndsAt) return;
  if (new Date(r.votingEndsAt) > new Date()) return;
  // Timer already elapsed before we mounted (admin reload after disconnect).
  // Fire /score once.
  void postRoomScore(r.id, session.userId, { fetch: window.fetch.bind(window) });
}, [phase, isAdmin]);
```

Multi-tab safety: only the first call succeeds via `runScoring`'s atomic conditional update; subsequent calls return their existing scored response.

## Test plan (TDD)

1. **`votingEndingTimer.test.ts`** — 8 tests above (RED → GREEN per TDD).
2. **`updateStatus.test.ts`** — extend with: voting → voting_ending writes `voting_ends_at`; voting_ending → voting (undo) clears it; undo after deadline → 409; non-admin → 403; broadcasts new event variant.
3. **`runScoring.test.ts`** — extend with: voting_ending status accepted; voting_ending without elapsed timer → 409; voting_ended_at written.
4. **`route.test.ts`** for `/api/rooms/[id]/status` — extend if existing, add for new transitions; payload validation.
5. Manual smoke (UI):
   - Tap End voting → modal → confirm → countdown toast appears → Undo → returns to voting cleanly.
   - Tap End voting → wait 5s → countdown finishes → "Finalising…" → status flips to scoring/announcing.
   - Refresh during countdown (admin) → countdown resumes from server clock.
   - Refresh after deadline (admin) → page mounts, auto-fires /score, room flips.
   - Guest sees passive pill, voting still works.
   - Two admin tabs → only one fires successfully; the other no-ops on 409.

## Files

**New:**
- `supabase/migrations/20260427_add_voting_ending_state.sql` (or rename per existing convention)
- `src/lib/rooms/votingEndingTimer.ts` + `.test.ts`
- `src/components/voting/EndVotingModal.tsx`
- `src/components/voting/EndVotingCountdownToast.tsx`
- `src/components/voting/EndingPill.tsx`
- `src/components/voting/EndVotingButton.tsx`

**Modified:**
- `supabase/schema.sql`
- `SUPABASE_SETUP.md` (re-apply note)
- `src/types/index.ts`
- `src/types/database.ts`
- `src/lib/rooms/shared.ts`
- `src/lib/rooms/updateStatus.ts` (+ test)
- `src/lib/rooms/runScoring.ts` (+ test)
- `src/app/room/[id]/page.tsx`
- `src/components/voting/VotingView.tsx` (header-chrome End-voting button)
- `src/hooks/useRoomRealtime.ts`
- `src/locales/en.json`

## Verification

- `npm run type-check` clean
- `npx vitest run` green (existing 818 + ~12 new tests around 830)
- `npm run lint` no new warnings
- DB migration applied to local Supabase before manual smoke
- Manual smoke covers all 6 scenarios above

## Coordination note

`feat/phase-5c1-instant-mode` is touching `src/app/room/[id]/page.tsx` and `src/components/voting/VotingView.tsx`. They're rebased on stale main, so they'll need to rebase before merging. My voting-ending work will create merge conflicts in `room/[id]/page.tsx` (status branch logic) but no schema conflict (they touch `room_memberships`, I touch `rooms`). Resolution at PR time is straightforward: their instant-mode `announcing` branch + my `voting_ending` branch are disjoint.
