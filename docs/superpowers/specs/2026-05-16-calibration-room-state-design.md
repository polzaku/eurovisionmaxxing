# Calibration room state — design

**TODO #10, slice B** — the second half of the #10 bundle. Slice A
shipped a per-announcer "Peek your picks" button. Slice B adds a new
`calibration` room state between `scoring` and `announcing` so every
member can review their own 1→12 picks before the live reveals start.
The room owner triggers the transition out of calibration via a
button on their phone.

## State machine

Before:
```
lobby → voting → voting_ending → scoring → announcing → done
```

After (LIVE mode only — INSTANT skips calibration):
```
lobby → voting → voting_ending → scoring → calibration → announcing → done
                                            ▲
                                            └─ owner taps "Start announcing"
```

## Server changes

- **Schema (supabase/schema.sql)**: extend `rooms.status` CHECK to
  include `'calibration'`. Migration block added inline at the bottom
  of the file for production application via the Supabase SQL Editor.
- **Type (src/types/index.ts)**: extend `RoomStatus` union.
- **runScoring**: when `room.announcement_mode === "live"`, write
  `status: "calibration"` (was always `"announcing"`). INSTANT rooms
  unchanged. The `announcement_order`, `announcing_user_id`, and
  short-style auto-batch (if applicable) still fire in `runScoring`
  — those operations prep the announcing state but don't actually
  start it. The `status_changed` broadcast now carries `nextStatus`
  (`calibration` for live, `announcing` for instant).
- **New lib `startAnnouncing.ts`**: owner-only transition from
  `calibration` to `announcing`. Validates room state + ownership,
  performs a conditional UPDATE guarded by `status='calibration'` (so
  concurrent calls race-safe), broadcasts `status_changed: announcing`.
- **New route `POST /api/rooms/[id]/start-announcing`**: thin wrapper
  around `startAnnouncing`. Body: `{ userId }`.
- **loadResults**: new `calibration` branch returns
  `{ status, year, event, pin, contestants, ownBreakdown, firstAnnouncerName }`.
  `ownBreakdown` is gated on `callerUserId` (same spoiler-safety
  pattern as `announcerOwnBreakdown` from slice A). `firstAnnouncerName`
  is the name of `announcement_order[0]` — used in calibration UI for
  "Bob will announce first" copy.

## Client changes

- **CalibrationView component**: renders during `status === "calibration"`.
  Shows the user's own picks (reuses `<UserPicksList>` from slice A) +
  "Bob will announce first" + owner-only "Start announcing" CTA / non-owner
  "Waiting for the host…" copy. Polls `/api/results/[id]?asUser=…`
  on mount + subscribes to `status_changed` realtime to auto-exit when
  the owner advances.
- **Room page**: new branch for `status === "calibration"` between
  the existing `scoring` and default `StatusStub` cases.
- **PresentScreen (TV)**: new branch for `status === "calibration"` —
  shimmer-style "Everyone's reviewing their picks…" waiting screen.
- **5 locale updates**: top-level `calibration.*` block (used by
  CalibrationView component) and `present.calibration.*` block (used
  by PresentScreen).

## Test coverage

- `startAnnouncing.test.ts` — 8 cases: happy path, validation
  (UUID/userId), ROOM_NOT_FOUND, FORBIDDEN, ROOM_NOT_CALIBRATING,
  concurrent transition race, non-fatal broadcast failure.
- `runScoring.test.ts` — updated 8 existing live-mode cases to expect
  `status: "calibration"` instead of `"announcing"` in the final
  patch + broadcast. INSTANT-mode case unchanged.
- `CalibrationView.test.tsx` — 7 cases: owner vs non-owner branches,
  start-button POST, realtime-driven exit, empty-state, first-
  announcer copy.

## Deferred / out of scope

- **Existing instant-mode happy-path test** (line ~685 of
  `runScoring.test.ts`) was already passing because `defaultRoomRow`
  is instant — no update needed.
- **Short-style auto-batch broadcast timing**: the
  `score_batch_revealed` event still fires from `runScoring` (now
  while status is `calibration`). Subscribers refetch and see
  calibration; harmless. Moving the auto-batch into start-announcing
  could be a future refinement.
- **Calibration timeout**: not implemented. If the owner never taps
  "Start announcing", the room stays in calibration indefinitely.
  Acceptable for a single-evening watch party.
- **Playwright**: not added for this slice. The component + server
  pieces are RTL/unit-tested individually; the full
  scoring→calibration→announcing flow would need a session + realtime
  setup the existing Playwright suite hasn't tackled.

## Risk

Medium.

- **Schema migration** is the load-bearing piece. Production rooms
  table must run the inline migration block before the new code ships
  or the CHECK constraint will reject the calibration UPDATE.
  Documented in `supabase/schema.sql` "Existing-database migrations"
  comment block.
- INSTANT mode rooms are unchanged — instant flows continue to land
  straight in `announcing` (no calibration). Verified by the existing
  instant-mode test.
- The short-style auto-batch event fires "early" relative to the
  announcer's actual turn. Real-world impact: clients seeing the
  broadcast during calibration refetch results, see status=calibration,
  no UI change. Acceptable noise.
