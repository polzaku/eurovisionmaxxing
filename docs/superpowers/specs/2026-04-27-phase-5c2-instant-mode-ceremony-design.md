# Phase 5c.2 — Instant-mode reveal ceremony

**Status:** design  •  **Date:** 2026-04-27  •  **Phase:** 5c.2  •  **Spec section:** §10.1
**Predecessor:** [`2026-04-27-phase-5c1-instant-mode-design.md`](2026-04-27-phase-5c1-instant-mode-design.md)

## Goal

Land the two ceremonial moments deferred from Phase 5c.1:

- **A — Per-user 12-point reveal.** Each user's own results screen hides their 12-point pick behind a single tap; the rest of their picks (1, 2, 3, 4, 5, 6, 7, 8, 10) render immediately on landing.
- **B — Worst-to-best leaderboard reveal.** When the admin taps any of the three reveal CTAs (`Reveal-all` / `Reveal-early` / `Skip-the-wait`), the room transitions `announcing → done` and every client plays a single-shot animated leaderboard ceremony before settling on `/results/{id}`.

5c.1 already shipped own-results breakdown (always-visible), Ready toggle, the three admin CTAs, and the `DoneCard` auto-redirect (PR #44). 5c.2 only changes the visual ceremony around those moments — no new endpoints, no schema migration, no new `RoomEvent` variant.

## Non-goals

- **Awards reveal animation** — deferred to Phase 6.2 (cinematic one-at-a-time reveal). Static `AwardsSection` on `/results/{id}` is sufficient.
- **Server-clocked synchronisation.** Each client plays the ceremony locally; sub-second drift between phones in the same room is invisible at this UX scale.
- **Live-mode "short" reveal style** (SPEC §10.2.2) — Phase V2.
- **Per-point 1→12 build-up.** The Eurovision-broadcast-faithful pattern compresses to *"lower nine shown, only the 12 is the moment."*

## Background — what 5c.1 produced

```
admin taps Reveal-all / Reveal-early / Skip-the-wait
  → PATCH /api/rooms/{id}/status to "done"
  → broadcast status_changed:done
  → all clients refetch via fetchRoomData
  → room/[id]/page.tsx renders <DoneCard />
  → DoneCard auto-redirects to /results/{id} after 10s
```

5c.2 inserts ceremonies at two points:

1. Before the admin tap, on the user's own results screen — Piece A.
2. Between `status_changed:done` and the redirect to `/results` — Piece B replaces the bare `DoneCard` for instant-mode rooms.

## Piece A — Per-user 12-point reveal

### Behaviour

On landing in `announcing` + `instant` mode, replace `<InstantOwnBreakdown>` with `<OwnPointsCeremony>`:

| State | Render |
|---|---|
| Initial (12-pt hidden) | Header + lower nine picks (1, 2, 3, 4, 5, 6, 7, 8, 10) sorted desc. Below the list: prominent `Reveal your 12 points` button + smaller `Skip the build-up` link. |
| 12-pt revealed | All ten picks visible, 12-pt at top with `motion-safe:animate-fade-in` + `emx-glow-gold` halo on first paint. Reveal button replaced with `Ready` CTA (the 5c.1 `I'm ready — show the leaderboard` button). |
| Degenerate (no 12-pt pick) | All picks rendered immediately, Ready enabled, no reveal affordance. |

The `Ready` CTA stays disabled (or absent) until the 12 is shown — gating the ceremony preserves the build-up.

### Degenerate cases

- **No 12-point pick.** Determined client-side: `entries.some(e => e.pointsAwarded === 12)`. False → skip ceremony, render the existing 5c.1 layout. (Possible if the user voted on ≤9 contestants and `tiebreak` never lifted any to 12.)
- **Multiple 12-point ties.** Cannot occur: `runScoring` assigns Eurovision points 12, 10, 8, 7, 6, 5, 4, 3, 2, 1 to ranks 1…10. Ties are broken in `tiebreak()` before points are assigned, so exactly one row gets 12.

### Reduced motion

When `prefers-reduced-motion: reduce` is set, the reveal still requires the tap (the *interaction* is the build-up, not the animation), but `animate-fade-in` and `emx-glow-gold` reduce to instant opacity and no halo. SPEC §3.3.

## Piece B — Worst-to-best leaderboard reveal

### Trigger

When `room/[id]/page.tsx` first observes `room.status === "done"` AND `room.announcementMode === "instant"` AND `sessionStorage["emx_revealed_${roomId}"]` is unset, render `<LeaderboardCeremony />` full-screen instead of `<DoneCard />`. Existing live-mode `done` continues to render `<DoneCard />` unchanged.

### Data flow

```
status flips to "done"
  → room/[id]/page.tsx mounts <LeaderboardCeremony roomId={roomId} />
  → component fetches /api/results/{id} on mount (already public, returns "done" payload)
  → component receives { leaderboard, contestants }
  → seeds initial state: every contestant at 0 pts, sorted alphabetically
  → useStaggeredReveal ticks 0 → leaderboard.length over (length × 250ms)
  → at each tick, "apply" the next worst contestant's pointsAwarded
  → recompute sort + ranks → React re-renders
  → CSS measures previous → current row position via FLIP, sets --shift-from per row, applies animate-rank-shift
```

No new endpoint. No new broadcast. Server already finalised everything during `runScoring`.

### Reveal order

Sorted by `leaderboard` array reversed: lowest rank first. For competition-ranked ties (1, 2, 2, 4 …), the secondary sort is `contestantId.localeCompare` — already deterministic in `loadResults.buildLeaderboard`. Reveal walks this same order, reversed.

### Sort behaviour during ceremony

At every snapshot, the visible list sorts by `pointsAwarded DESC, contestantId ASC` — same key as `loadResults.buildLeaderboard`, so the settled state matches the static `/results/{id}` leaderboard exactly.

- **Initial snapshot:** all contestants at 0 pts → tied → sort collapses to `contestantId ASC`. (Rendered as the seeding state — visually a sorted-alphabetical list of flags and countries with no point columns yet.)
- **Mid-ceremony:** revealed rows climb above unrevealed (0-pt) rows because their points are positive. Unrevealed rows stay sorted by contestantId among themselves.
- **Final snapshot:** identical to `/api/results/{id}` leaderboard.

### Rank number rendering

To avoid distracting tied-rank flicker during the climb (e.g. 26 rows all rank 1 at the initial snapshot), **rank numbers are not rendered during the staggered ticks**. They appear only when the ceremony has settled — i.e. once `currentStep === totalSteps`. The 3-second post-settle pause shows ranks 1…N as on `/results/{id}`. This keeps focus on the climb itself; the rank-shift animation visually communicates the rank changes mid-flight.

### Pacing

- 250 ms stagger between ticks
- 300 ms `animate-rank-shift` per row (overlaps with stagger — visually fluid)
- 800 ms `animate-fade-in` on the very first tick (the bottom of the list seeds in)
- 3 s pause showing the final leaderboard
- Then auto-redirect to `/results/{id}`

For a 26-contestant final: ~6.5 s ceremony + 3 s pause = 9.5 s total. Acceptable; the room is staring at the screen together.

### Persistent escape hatch

A `Stay here` link is visible during both the ceremony and the post-ceremony pause. Tap → cancels the auto-redirect, leaves the final leaderboard with a `See full results →` button.

### Reload / late-join

After the ceremony plays — whether it ended via auto-redirect, `Stay here` tap, or manual navigation — `<LeaderboardCeremony>` sets `sessionStorage["emx_revealed_${roomId}"] = "1"`. The flag is set on **every** completion path before the user-visible action fires (set-then-redirect, set-then-cancel-and-render-static).

On any subsequent mount with the flag set:

- Render the final leaderboard statically (already-sorted, no animation, no stagger).
- Show `See full results →` button immediately.
- No auto-redirect (the user has already chosen to be on this page).

A guest who lands on `/room/{id}` for the first time after `status === "done"` (never participated in the ceremony) gets the ceremony once. This is desirable — they get to see the moment.

### Reduced motion

`prefers-reduced-motion: reduce`: skip stagger entirely, render the final leaderboard in its settled state in one frame. Compress the post-ceremony pause from 3 s to 1 s, then redirect. Keeps the redirect contract intact, drops the choreography.

## Architecture

### File layout

```
src/components/instant/
  OwnPointsCeremony.tsx          # Piece A — replaces InstantOwnBreakdown
  OwnPointsCeremony.test.tsx
  LeaderboardCeremony.tsx        # Piece B — replaces DoneCard for instant-mode-done
  LeaderboardCeremony.test.tsx
  useStaggeredReveal.ts          # generic timer-driven index ticker
  useStaggeredReveal.test.ts
  leaderboardSequence.ts         # PURE: leaderboard → ordered intermediate states
  leaderboardSequence.test.ts
  sessionRevealedFlag.ts         # PURE: read/write/clear sessionStorage
  sessionRevealedFlag.test.ts
```

`InstantOwnBreakdown.tsx` is **deleted**. Its sole consumer is `InstantAnnouncingView`, which swaps to `OwnPointsCeremony` directly.

### Wire-in

**`src/components/room/InstantAnnouncingView.tsx`**

- Replace `<InstantOwnBreakdown entries={ownBreakdown} contestants={contestants} />` with `<OwnPointsCeremony entries={ownBreakdown} contestants={contestants} onAllRevealed={...} />`.
- Track local `allRevealed` state. Pass to the existing `<RevealCtaPanel>` to gate `Ready` (or render Ready disabled until allRevealed).
- For admin: `RevealCtaPanel` is unchanged — admin's own ceremony plays independently. They can still tap any of the three reveal CTAs without revealing their own 12 (the spec doesn't gate admin actions on personal ceremony completion).

**`src/app/room/[id]/page.tsx`**

In the `phase.room.status === "done"` branch:

```ts
if (phase.room.status === "done") {
  if (phase.room.announcementMode === "instant" && !sessionRevealedFlag.has(roomId)) {
    return <LeaderboardCeremony roomId={roomId} onComplete={() => sessionRevealedFlag.set(roomId)} />;
  }
  return <DoneCard roomId={roomId} />;
}
```

`LeaderboardCeremony` self-fetches via `/api/results/{id}`. After auto-redirect timer or `Stay here`/explicit nav, it sets the flag.

### Pure helpers

**`leaderboardSequence.ts`**

```ts
export interface LeaderboardSnapshot {
  contestantId: string;
  pointsAwarded: number;     // 0 until revealed
  rank: number | null;       // null until revealed
}

/**
 * Given the final leaderboard (sorted best→worst) and the set of all
 * contestants in the field, produce one initial snapshot (all 0 pts) plus
 * one snapshot per reveal step in worst→best order. Each subsequent
 * snapshot adds exactly one country's final points and re-ranks the list.
 *
 * Rank ties use competition ranking (1, 2, 2, 4) and the same
 * contestantId.localeCompare tiebreak as loadResults.
 */
export function leaderboardSequence(
  finalLeaderboard: LeaderboardEntry[],
  contestants: Contestant[],
): LeaderboardSnapshot[][];
```

100% pure. Deterministic. Testable without React.

**`useStaggeredReveal.ts`**

```ts
export interface StaggeredRevealOptions {
  totalSteps: number;
  staggerMs: number;
  onComplete?: () => void;
  enabled?: boolean;          // false → snap to totalSteps immediately
}

export function useStaggeredReveal(opts: StaggeredRevealOptions): {
  currentStep: number;        // 0 .. totalSteps
  isComplete: boolean;
};
```

Single `setTimeout` chain. Cancels on unmount. `enabled: false` (reduced motion) snaps current to totalSteps in the first render.

**`sessionRevealedFlag.ts`**

```ts
export const sessionRevealedFlag = {
  has: (roomId: string): boolean => /* sessionStorage check */,
  set: (roomId: string): void => /* sessionStorage write */,
  clear: (roomId: string): void => /* sessionStorage delete (test helper) */,
};
```

SSR-safe (`typeof window === "undefined"` guards).

### FLIP animation

`LeaderboardCeremony` uses a row-key + ref pattern:

1. Before each render, capture each row's bounding rect by `contestantId`.
2. After render, compare new rect to old. If row moved, set `--shift-from` to `(oldY - newY)px` and apply `animate-rank-shift`.
3. Class strips after `animationend` so subsequent renders re-measure cleanly.

Implementable in ~30 lines via `useLayoutEffect` + a `Map<string, DOMRect>`. No third-party library.

## Locale keys

New under `instantAnnounce`:

```json
{
  "ownResults": {
    "revealTwelveButton": "Reveal your 12 points",
    "revealTwelveSkip": "Skip the build-up",
    "twelveLabel": "Your 12 points"
  },
  "ceremony": {
    "subtitle": "The room's final leaderboard",
    "redirectingIn": "Opening full results in {seconds}s…",
    "stayHere": "Stay here",
    "seeFullResults": "See full results →"
  }
}
```

`src/locales/locales.test.ts` bumps the expected key count by 7. Non-`en` locales remain skeleton (Phase L L3 deferred).

## Tests (TDD order)

Write each test red first, then implement.

1. **`leaderboardSequence.test.ts`** — pure
   - Empty contestants → empty list of snapshots.
   - 3 contestants, no ties → 4 snapshots (initial + 3 reveals); reveal order matches reversed leaderboard.
   - Ties (1, 2, 2, 4) → all tied entries share rank in final snapshot; reveal order is worst-first using `contestantId.localeCompare` as the inner tiebreak.
   - Contestants in field but not in leaderboard → present in initial snapshot at 0 pts; never "revealed" (their entry stays at 0). (Cannot occur with real data — `loadResults.buildLeaderboardSeeded` includes all contestants — but the helper is robust.)

2. **`useStaggeredReveal.test.ts`** — Vitest fake timers
   - `vi.useFakeTimers()`. `currentStep` starts at 0. After advancing `staggerMs × N`, equals `N`. After advancing past `staggerMs × totalSteps`, stops at `totalSteps`. `onComplete` fires once.
   - `enabled: false` → `currentStep === totalSteps` on first render, `onComplete` fires synchronously.
   - Unmount mid-stagger → no further updates (no warnings).

3. **`sessionRevealedFlag.test.ts`** — jsdom
   - `has(roomId)` initially false; after `set` → true; after `clear` → false.
   - SSR (`window` undefined) → all methods no-op without throwing.

4. **`OwnPointsCeremony.test.tsx`** — RTL
   - 10-pick fixture (1, 2, 3, 4, 5, 6, 7, 8, 10, 12): renders nine lower picks, 12 absent. `Reveal your 12 points` button visible.
   - Click reveal → 12 pick rendered. `onAllRevealed` fired.
   - Click `Skip the build-up` → 12 pick rendered, `onAllRevealed` fired (same path).
   - 5-pick fixture (no 12): all picks render immediately, no reveal button, `onAllRevealed` fired on mount.
   - 0-pick fixture (`empty` case): existing empty-state copy renders, `onAllRevealed` fired on mount.

5. **`LeaderboardCeremony.test.tsx`** — RTL with mocked fetch
   - Mocks `/api/results/{id}` returning a `done` payload with 4 contestants.
   - Initial render: all 4 rows present at 0 pts.
   - Fake-timer advance through stagger ticks → final ordering matches input leaderboard.
   - After complete + 3 s pause: `router.push('/results/...')` called.
   - `Stay here` click before redirect → no `router.push`; `See full results →` button visible.
   - `prefers-reduced-motion: reduce` (mocked via `matchMedia`): rows render in final state on mount; pause compressed to 1 s.
   - sessionStorage flag set on mount → no animation (test by checking that no row has class `animate-rank-shift` ever applied).
   - sessionStorage flag set after first ceremony run.

The two RTL test files use the existing test setup (`src/__tests__/setup.ts` if present, otherwise vitest's jsdom default). The `useRouter` mock follows the pattern already used elsewhere (`postRoomReady.test.ts` etc.).

## Files modified / added

- ✏️ `src/components/room/InstantAnnouncingView.tsx` — swap breakdown component, track allRevealed.
- ✏️ `src/app/room/[id]/page.tsx` — branch `done` render on announcementMode + flag.
- ✏️ `src/locales/en.json` — 7 new keys.
- ✏️ `src/locales/locales.test.ts` — bump expected key count.
- ➕ `src/components/instant/OwnPointsCeremony.tsx` (+ test)
- ➕ `src/components/instant/LeaderboardCeremony.tsx` (+ test)
- ➕ `src/components/instant/useStaggeredReveal.ts` (+ test)
- ➕ `src/components/instant/leaderboardSequence.ts` (+ test)
- ➕ `src/components/instant/sessionRevealedFlag.ts` (+ test)
- ❌ `src/components/room/InstantOwnBreakdown.tsx` — deleted (no other consumers)
- ❌ `src/components/room/InstantOwnBreakdown` test if any (none today)

## Migration / rollout

- No DB migration. No `supabase/schema.sql` edit. No `SUPABASE_SETUP.md` change.
- No new API endpoint. `/api/results/{id}` already serves the payload `LeaderboardCeremony` needs.
- No new `RoomEvent` variant.
- Single-PR scope: ~600 lines of new code + 5 deletions.

## Risks

- **FLIP measurement edge cases.** If the list re-renders mid-animation (e.g. a `status_changed` broadcast lands), classes may strip prematurely. Mitigation: skip new classes if a previous animation is still running on the same row (track via `Map<contestantId, animationStartedAt>`).
- **Late `/api/results/{id}` response.** If the fetch resolves slowly (>2 s), the ceremony delays. Show a tiny `animate-shimmer` placeholder while loading, then start the ceremony when data arrives. Acceptable — admin's tap creates anticipation.
- **Phone goes to sleep mid-ceremony.** Wake-lock for `done` is out of scope (Phase R3 §8.9 covered voting). The 6.5 s ceremony is short enough that screen-off is unlikely.
- **iOS Safari `prefers-reduced-motion` flicker.** Already gated correctly via `motion-safe:animate-fade-in` + `motion-safe:animate-rank-shift`; FLIP code paths bail out early when reduced-motion media query matches.

## Acceptance

- [ ] All new tests green; `npm run pre-push` passes.
- [ ] Manual smoke in `npm run dev` with 2+ browsers in an instant-mode room: own-points reveal works, leaderboard ceremony plays once per session per client, reload skips replay, `Stay here` works, redirect lands on `/results/{id}`.
- [ ] Reduced-motion smoke: enable OS-level reduced motion → ceremony fast-forwards; redirect still happens after ~1 s pause.
- [ ] No regressions in live-mode `done` (still renders `DoneCard`).
- [ ] No regressions in 5c.1 admin reveal CTAs.
- [ ] [todo.md:85](../../todo.md#L85) updated: 5c.2 row flips from `[~]` to `[x]`.
