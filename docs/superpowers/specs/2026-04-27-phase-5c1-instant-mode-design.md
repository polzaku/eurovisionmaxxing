# Phase 5c.1 — Instant-mode reveal flow (slice 1)

**Date:** 2026-04-27
**Status:** Approved
**SPEC sections:** §10.1 (instant mode), §6.7 (admin authorisation), §13 (`room_memberships`).
**TODO references:** Phase 5 line 85 (`/room/[id]` instant-mode results flow). Closes the wizard's `announcement_mode = 'instant'` MVP gap.

## 1. Goal

A working instant-mode announcement flow: when a room with `announcement_mode = 'instant'` enters `announcing` status, every member sees their own per-country points breakdown and a *"Ready to reveal"* button; the admin sees a ready-count chip and three reveal CTAs that unlock by spec rules; tapping any of them flips the room to `done` and hands every connected client off to `/results/[id]`.

**Closes the MVP gap.** `announcement_mode` is one of two wizard options. Live mode shipped as Phase 5b.1 + 5b.2; instant mode is the missing half.

## 2. Out of scope (explicitly)

- **Per-point 1 → 12 own-results reveal** (tap-to-advance ceremony) — Phase 5c.2.
- **Animated worst-to-best leaderboard reveal** between admin-tap and `done` — Phase 5c.2.
- **Awards cinematic reveal** — Phase 6.2.
- **Un-marking "ready"** — slice 1 is mark-only. If a user changes their mind they reload the page (which keeps them ready); future slice can add an un-toggle.
- **Live-mode behaviour** — `<AnnouncingView>` (the existing 5-mode live component) is untouched in this slice.

## 3. Scope

### 3.1 In scope

**A. Schema migration** — additive nullable column `room_memberships.ready_at TIMESTAMPTZ` (default NULL). Set when `is_ready` transitions to true; the minimum across the room is the room's "first-ready event" anchor for the 60-second countdown.

**B. New API endpoint** — `POST /api/rooms/{id}/ready`. User marks themselves ready. Idempotent. Allowed only when `rooms.status = 'announcing'` and `announcement_mode = 'instant'`. Writes `is_ready = true, ready_at = now()` if not already set; otherwise no-op. Broadcasts `member_ready` (new event) with `{ userId, readyAt, readyCount, totalCount }`.

**C. Admin reveal** — re-uses the existing `PATCH /api/rooms/{id}/status` endpoint with `{ status: 'done' }`. Already supports the `announcing → done` transition (verified in `updateStatus.ts`). The endpoint is owner-or-co-admin per §6.7. Client adds a confirmation modal for the *"Admin override — reveal now"* CTA only.

**D. New `<InstantAnnouncingView>` component** — renders when `rooms.status === 'announcing'` AND `announcement_mode === 'instant'`. Two sub-views by `currentUserId`:
- **Member view** (own-results breakdown + Ready button)
- **Admin view** (everything in the member view PLUS the three CTAs + the ready-count chip + countdown)

The owner is also a member, so the admin view is *additive* — admin sees their own breakdown too, plus admin-only controls below.

**E. `<RevealCtaPanel>`** — admin-only sub-component encapsulating the three CTAs + countdown logic. Pure-function helper `nextRevealCtaState({ readyCount, totalCount, firstReadyAt, now })` returns `{ canRevealAll, canRevealAnyway, anywayCountdownMs, override }`.

**F. Realtime wiring** — extend `RoomEvent` discriminated union (§15) with `member_ready`. Subscribers refresh the local memberships array on receipt. The existing `status_changed` event already drives the `announcing → done` transition (no changes needed).

**G. Room-page integration** — branch on `announcement_mode` inside the `status === 'announcing'` block in `src/app/room/[id]/page.tsx`. Live → existing `<AnnouncingView>`. Instant → new `<InstantAnnouncingView>`.

**H. `<DoneCard>` handoff** — already exists, already renders for `done` rooms with a CTA to `/results/[id]`. No changes; the slice flips the room to `done` and the existing handoff takes over.

**I. Locale keys** — `instantAnnounce.{ownResults.title, ownResults.empty, ready.button, ready.busy, ready.waiting, admin.readyCount, admin.revealAll, admin.revealAnyway, admin.revealAnywayCountdown, admin.override, admin.overrideConfirmTitle, admin.overrideConfirmBody, admin.overrideConfirmCancel, admin.overrideConfirmGo}`.

### 3.2 What "own-results breakdown" looks like (concrete)

For each member's own view, the breakdown is a list of every contestant the user awarded points to, sorted descending by points awarded (12 first, then 10, 8, …, 1). One row per contestant:

- Left: points pill (`12`, `10`, `8`, …) in `text-primary` (gold).
- Middle: flag emoji + country name + song title.
- Right: hot take text if the user wrote one, otherwise nothing.

If the user voted on fewer than 10 contestants (e.g., they marked many as missed and the missed-fill produced a tie that pushed some to zero points), only contestants with `points_awarded > 0` are listed. Contestants the user didn't score don't appear.

Data source: `GET /api/rooms/{id}/results` already returns the per-user breakdown; the page already calls this when `status` is `announcing` (verified in current results route). The component just renders it.

### 3.3 What "ready-count" + countdown look like

**Member view:**
- Above the breakdown, a chip: `3 / 6 ready` (own user counted in numerator if they tapped ready).
- Below the breakdown, the *Ready to reveal* button — primary style. After tap: button replaces with text `Waiting on N others` (where N = `totalCount - readyCount`), greyed.

**Admin view (in addition):**
- Same chip at the top.
- Three CTAs stacked below the breakdown:
  1. **Reveal final results** — primary button. Enabled iff `readyCount === totalCount`.
  2. **Reveal anyway — N / M ready** OR **Reveal anyway — unlocks in M:SS** — secondary button. Enabled iff `readyCount * 2 >= totalCount` OR `(now - firstReadyAt) >= 60_000`. The label switches based on which condition gates it: if half-ready already holds, the label shows the count; otherwise it shows the countdown ticking down.
  3. **Admin override — reveal now** — destructive-style (red text on transparent). Always enabled. Tap → confirmation modal: title *"Reveal the results right now?"*, body *"No one will be waited for."*, buttons Cancel / Reveal.

The countdown derives client-side from a single server-provided timestamp (`firstReadyAt = MIN(ready_at) across memberships where is_ready = true`). A `setInterval(250ms)` re-renders the label until either condition fires.

### 3.4 Acceptance — manual smoke

Single browser test, two windows:
- **Window A** (admin/owner): create a room, set `announcement_mode = 'instant'`, set 5-category template. Vote on 3+ contestants. Tap "End voting" → room flips to `scoring`, then `announcing`.
- **Window B** (guest): join the room, vote on 3+ contestants. Wait for `announcing`.

Expected:
- Both windows render `<InstantAnnouncingView>`. Both see their own breakdowns and a *Ready* button.
- A taps Ready → A's button becomes *Waiting on 1 other*, A's window shows ready-count `1 / 2`. B's window also updates to `1 / 2` (via `member_ready` broadcast).
- B taps Ready → both ready chips show `2 / 2`. A (admin) sees *Reveal final results* enabled.
- A taps *Reveal final results* → `PATCH /api/rooms/{id}/status` with `{status: 'done'}` → both windows refetch, both render `<DoneCard>` with a link to `/results/[id]`.
- Visit `/results/[id]` — full leaderboard + per-user breakdowns + awards (Phase 6 already shipped).

Edge cases worth eyeballing:
- A taps *Admin override* before anyone's ready — confirmation modal, then the same flip-to-done path.
- A is the only member in the room (so totalCount=1); `readyCount === totalCount` triggers immediately on A's own ready tap.

## 4. Component / state design

### 4.1 `<InstantAnnouncingView>`

```tsx
interface InstantAnnouncingViewProps {
  room: { id: string; ownerUserId: string; status: "announcing" };
  contestants: Contestant[];
  memberships: Array<{ userId: string; displayName: string; isReady: boolean; readyAt: string | null }>;
  currentUserId: string;
  isAdmin: boolean;            // owner OR co-admin (R1 not yet shipped, so == owner for now)
  ownBreakdown: Array<{ contestantId: string; pointsAwarded: number; hotTake: string | null }>;
  onMarkReady: () => Promise<void>;
  onReveal: () => Promise<void>;       // PATCH status → done; admin only
}
```

The component is mostly presentational. It derives:
- `readyCount = memberships.filter(m => m.isReady).length`
- `totalCount = memberships.length`
- `firstReadyAt = min of memberships[].readyAt where isReady` (ISO string)
- `ownIsReady = memberships.find(m => m.userId === currentUserId)?.isReady ?? false`

It renders the own-results breakdown (sorted by `pointsAwarded` desc), the ready chip, the Ready button (or its waiting equivalent), and (when `isAdmin`) the `<RevealCtaPanel>` below.

### 4.2 `<RevealCtaPanel>` (admin-only sub-component)

```tsx
interface RevealCtaPanelProps {
  readyCount: number;
  totalCount: number;
  firstReadyAt: string | null;     // ISO; null when no one is ready yet
  onReveal: () => Promise<void>;
}
```

Internally:
- Uses a `setInterval(250)` to drive a `now: number` state variable.
- Derives state via `nextRevealCtaState({ readyCount, totalCount, firstReadyAt, now })` (pure helper).
- Renders three buttons. The primary fires `onReveal` directly. The "Anyway" button fires `onReveal` directly. The "Override" button opens a local confirmation modal that, on confirm, fires `onReveal`.
- All three call the same `onReveal` — the differentiation is purely UX (when each is enabled).

### 4.3 `nextRevealCtaState` (pure helper)

```ts
export interface RevealCtaState {
  canRevealAll: boolean;
  canRevealAnyway: boolean;
  anywayLabel:
    | { kind: "halfReady"; readyCount: number; totalCount: number }
    | { kind: "countdown"; secondsRemaining: number }
    | { kind: "disabled" };  // no one ready yet, no countdown started
}

export function nextRevealCtaState(input: {
  readyCount: number;
  totalCount: number;
  firstReadyAt: number | null;  // ms epoch; null if no one ready
  now: number;                  // ms epoch
}): RevealCtaState;
```

Rules (pure, fully tested):
1. `canRevealAll = readyCount === totalCount && totalCount > 0`.
2. `canRevealAnyway`:
   - `firstReadyAt === null` → `false`.
   - `readyCount * 2 >= totalCount` → `true` (with `kind: "halfReady"`).
   - `now - firstReadyAt >= 60_000` → `true` (with `kind: "countdown"` and `secondsRemaining: 0`).
   - Otherwise → `false` (with `kind: "countdown"` and `secondsRemaining = ceil((60_000 - (now - firstReadyAt)) / 1000)`).
3. When `firstReadyAt === null`: `anywayLabel = { kind: "disabled" }`.

The reducer is pure → unit-tested with ~10 cases.

### 4.4 Realtime: `member_ready` event

Add to `RoomEvent` union in `src/types/index.ts`:

```ts
| {
    type: "member_ready";
    userId: string;
    readyAt: string;       // ISO
    readyCount: number;
    totalCount: number;
  }
```

Server broadcasts on `room:{roomId}` after the `is_ready = true` write succeeds. Subscribers update their local memberships array (set `isReady = true, readyAt = readyAt` for the matching userId). Counts in the UI are derived; the broadcast carries them only as a sanity-check the client can use to detect drift.

The `room` page's existing `useRoomRealtime` hook currently dispatches on `status_changed`. Add a `member_ready` branch that calls a new prop `onMemberReady?: (event) => void`, which the page passes through to update local state without a refetch. (Refetch is acceptable too — instant mode rooms are small; latency isn't material.)

### 4.5 `POST /api/rooms/{id}/ready` route

```
POST /api/rooms/{id}/ready
Body: {} (empty — derives userId from session)
Auth: any room member
Allowed only when: rooms.status === 'announcing' AND rooms.announcement_mode === 'instant'
```

Validation cascade:
- 401 if no session.
- 404 if room not found.
- 403 if user isn't a member of this room.
- 409 `{code: "ROOM_NOT_INSTANT"}` if `announcement_mode !== 'instant'`.
- 409 `{code: "ROOM_NOT_ANNOUNCING"}` if `status !== 'announcing'`.

Happy path:
- If membership already has `is_ready = true`, no-op (idempotent), return `{readyAt: <existing>}` in 200.
- Else `UPDATE room_memberships SET is_ready = true, ready_at = now() WHERE room_id = ? AND user_id = ?`.
- After write, fetch fresh membership counts.
- Broadcast `member_ready` with `{userId, readyAt, readyCount, totalCount}`.
- Return 200 `{readyAt, readyCount, totalCount}`.

Implementation orchestrator: `src/lib/rooms/markReady.ts` (mirrors `runScoring.ts` / `advanceAnnouncement.ts` shape). Tested as a unit.

### 4.6 Server-broadcast timing

The broadcast must fire *after* the DB write commits. If it fires before, subscribers might re-fetch and see stale counts. Server-side timing in `markReady.ts`:

```
1. UPDATE membership SET is_ready=true, ready_at=now() (skipped if already true)
2. SELECT counts: ready (true) and total
3. broadcast member_ready { userId, readyAt, readyCount, totalCount }
4. return 200 to caller
```

Same broadcast-after-commit pattern as `advanceAnnouncement` (existing).

### 4.7 `<DoneCard>` handoff

No changes. Existing `<DoneCard>` already renders for `status === 'done'` rooms and links to `/results/[id]`. Once admin taps any reveal CTA → `PATCH status → done` → broadcast `status_changed` → all clients refetch → all render `<DoneCard>`.

## 5. File structure

| File | Status | Responsibility |
|---|---|---|
| `supabase/schema.sql` | Modify | Add `ready_at TIMESTAMPTZ` to `room_memberships` block |
| `SUPABASE_SETUP.md` | Modify | Append migration changelog entry for 2026-04-27 |
| `src/types/index.ts` | Modify | Add `readyAt: string \| null` to membership shape; add `member_ready` to `RoomEvent` union |
| `src/types/database.ts` | Modify | Add `ready_at` to `room_memberships` row type (Insert/Update too) |
| `src/lib/rooms/get.ts` | Modify | Select `ready_at` and map to `readyAt: string \| null` |
| `src/lib/rooms/markReady.ts` | Create | `markReady(roomId, userId, supabase)` orchestrator |
| `src/lib/rooms/markReady.test.ts` | Create | Unit tests for `markReady` (validation cascade + happy path + broadcast) |
| `src/app/api/rooms/[id]/ready/route.ts` | Create | `POST` handler delegating to `markReady` |
| `src/app/api/rooms/[id]/ready/route.test.ts` | Create | Route-level tests (auth, 4xx codes, happy path) |
| `src/components/voting/nextRevealCtaState.ts` | Create | Pure reducer for the three CTAs (placement under `voting/` mirrors `nextScore.ts` precedent) |
| `src/components/voting/nextRevealCtaState.test.ts` | Create | Unit tests for the reducer (~10 cases) |
| `src/components/room/RevealCtaPanel.tsx` | Create | Admin-only three-CTA + override-confirm modal panel |
| `src/components/room/InstantAnnouncingView.tsx` | Create | Top-level instant-mode announce view |
| `src/components/room/InstantOwnBreakdown.tsx` | Create | Per-user own-results breakdown list (sorted by pointsAwarded desc) |
| `src/app/room/[id]/page.tsx` | Modify | Branch on `announcement_mode` for the `announcing` block |
| `src/lib/room/api.ts` | Modify | Add `postRoomReady(roomId)` client helper |
| `src/hooks/useRoomRealtime.ts` | Modify | Surface `member_ready` events to the consumer |
| `src/locales/en.json` | Modify | Add 14 new keys under `instantAnnounce.{ownResults,ready,admin}` |

## 6. Tests

The repo's vitest is `node`-env; pure helpers + route handlers + orchestrators get unit tests; JSX components are manually verified.

**`nextRevealCtaState.test.ts`** — 10+ cases:
1. No one ready (`readyCount = 0`, `firstReadyAt = null`, `totalCount = 6`) → `canRevealAll: false, canRevealAnyway: false, anywayLabel: { kind: "disabled" }`.
2. All ready (`readyCount = 6, totalCount = 6`) → `canRevealAll: true, canRevealAnyway: true` (half holds too), `anywayLabel: { kind: "halfReady" }`.
3. Half-ready threshold met (`readyCount = 3, totalCount = 6`) → `canRevealAll: false, canRevealAnyway: true, anywayLabel: { kind: "halfReady", readyCount: 3, totalCount: 6 }`.
4. Just under half (`readyCount = 2, totalCount = 6, firstReadyAt = now - 30_000, now = now`) → `canRevealAll: false, canRevealAnyway: false, anywayLabel: { kind: "countdown", secondsRemaining: 30 }`.
5. 60s elapsed exactly (`readyCount = 1, totalCount = 6, firstReadyAt = now - 60_000`) → `canRevealAnyway: true, anywayLabel: { kind: "countdown", secondsRemaining: 0 }`.
6. 75s elapsed (`firstReadyAt = now - 75_000`) → `canRevealAnyway: true, anywayLabel: { kind: "countdown", secondsRemaining: 0 }` (clamped to 0).
7. 1s elapsed (`firstReadyAt = now - 1_000`) → `secondsRemaining: 59`.
8. `totalCount === 1` (solo room), `readyCount === 1` → `canRevealAll: true`.
9. `totalCount === 0` (degenerate, defensive) → `canRevealAll: false, canRevealAnyway: false`.
10. `readyCount > 0` but `firstReadyAt === null` (defensive — shouldn't happen, but) → falls back as if `readyCount === 0`.

**`markReady.test.ts`** — orchestrator unit tests:
1. Happy path: sets `is_ready=true, ready_at=now()`, broadcasts, returns counts.
2. Idempotent: second call returns existing `readyAt`, no second broadcast.
3. Status not `announcing` → 409 `ROOM_NOT_ANNOUNCING`.
4. `announcement_mode` not `instant` → 409 `ROOM_NOT_INSTANT`.
5. Room not found → 404.
6. User not a member → 403.

**`/api/rooms/[id]/ready/route.test.ts`** — route-level (similar shape to existing route tests):
1. 401 when no session.
2. 200 happy path delegates to `markReady`.
3. 4xx error codes map through `apiError` correctly.

**No new component tests.** The JSX (`<InstantAnnouncingView>`, `<RevealCtaPanel>`, `<InstantOwnBreakdown>`) is manually smoke-tested per the §3.4 acceptance plan. The testable invariants live in the reducer (covered).

## 7. Acceptance — verification

- `npm run type-check` clean.
- `npm test` — all suites pass; new tests added (~20 cases).
- `npm run lint` clean.
- Manual smoke test per §3.4.
- Schema migration: re-applied on a dev Supabase via SQL Editor; `\d room_memberships` shows `ready_at`.

## 8. Rollback

Each commit lands clean and revertable. The `ready_at` column is nullable and ignored by all code paths if the new endpoint is reverted, so dropping the column post-merge is safe (`ALTER TABLE room_memberships DROP COLUMN ready_at` — only do if specifically requested).

## 9. Slicing

Single PR, six logical commits:

1. **Schema migration** — `ready_at` column + SUPABASE_SETUP changelog.
2. **Database layer** — `src/types/{index,database}.ts` + `get.ts` to surface `readyAt` in membership shape.
3. **`nextRevealCtaState` reducer + tests** — pure helper landing first (TDD).
4. **`markReady` orchestrator + tests + `POST /api/rooms/[id]/ready` route + route tests** — backend complete.
5. **Realtime + client API helper** — `member_ready` event surfaced via `useRoomRealtime`; `postRoomReady` added to `src/lib/room/api.ts`.
6. **Components + room-page integration + locale keys** — `<InstantAnnouncingView>`, `<RevealCtaPanel>`, `<InstantOwnBreakdown>`, branch in `/app/room/[id]/page.tsx`, en.json keys.

## 10. Follow-ups (Phase 5c.2 and beyond)

- Per-point 1 → 12 own-results reveal ceremony (tap-to-advance).
- Animated worst-to-best leaderboard reveal between admin-tap and `done`.
- Un-marking ready (toggle on/off rather than mark-once).
- Awards cinematic reveal (Phase 6.2).
- Phase L L3 translations for the 14 new keys.
