# Jump-to drawer + swipe navigation — design

**Date:** 2026-04-26
**Spec sections:** SPEC §8.6 (footer + swipe), §8.8 (per-contestant chip — partially deferred)
**Phase:** 3 — Voting

---

## 1. Goal

Close out the last unfinished sub-features of the Phase 3 voting UI line: a `<JumpToDrawer>` for non-linear navigation across contestants, and horizontal-swipe gestures for prev/next. Backend already exposes everything needed (running order on contestants; user's own scores/missed/hotTake state lives in `VotingView`'s local state from PR1 of "I missed this"). Single PR, two clean commits.

## 2. Non-goals (deferred)

- §8.8 *per-contestant `N / M scored` chip* on drawer rows — depends on Phase R3 `voting_progress` realtime broadcasts that don't exist yet. The drawer's status column shows the user's *own* state ("Not scored yet" / "✓ Scored" / "👻 Missed") for MVP. The room-wide N/M chip can be added later as an extra column without restructuring.
- §8.6 *icon-only footer* — currently `Prev / Missed / Next` are text buttons; we add `Jump to` in the same style. The icon-only conversion is tracked under Phase U V/A items as cosmetic work.
- Drawer keyboard navigation (arrow keys to highlight rows, Enter to select). MVP supports tap-to-jump only.
- Pagination / virtual scrolling. 26 contestants is the realistic max; a flat scrollable list is fine.

## 3. Architecture

### 3.1 Pure helpers

**`summarizeContestantStatus`** (`src/lib/voting/contestantStatus.ts`):

```ts
export type ContestantStatus = "unscored" | "scored" | "missed";

export function summarizeContestantStatus(
  contestantId: string,
  scoresByContestant: Record<string, Record<string, number | null>>,
  missedByContestant: Record<string, boolean>,
  categoryNames: readonly string[]
): ContestantStatus;
```

Algorithm:
- `missedByContestant[id]` → `"missed"`
- All `categoryNames` have numeric scores in `scoresByContestant[id]` → `"scored"`
- Otherwise → `"unscored"`
- Empty `categoryNames` → `"unscored"` (defensive — shouldn't occur in practice).

**`nextIdxFromSwipe`** (`src/lib/voting/nextIdxFromSwipe.ts`):

```ts
export function nextIdxFromSwipe(
  currentIdx: number,
  total: number,
  deltaX: number,
  threshold: number  // default 50
): number | null;
```

- `deltaX > threshold` (finger moved right) → previous: `currentIdx - 1` if `> 0`, else `null`.
- `deltaX < -threshold` (finger moved left) → next: `currentIdx + 1` if `< total - 1`, else `null`.
- `|deltaX| <= threshold` → `null` (strict greater-than to avoid ambiguous tap-with-drift).

### 3.2 `<JumpToDrawer>` component

`src/components/voting/JumpToDrawer.tsx`

```ts
interface JumpToDrawerProps {
  isOpen: boolean;
  contestants: Contestant[];   // already sorted by running order at the call site
  currentContestantId: string;
  scoresByContestant: Record<string, Record<string, number | null>>;
  missedByContestant: Record<string, boolean>;
  categoryNames: readonly string[];
  onSelect: (contestantId: string) => void;  // VotingView translates id → idx + closes drawer
  onClose: () => void;
}
```

Layout:
- `<div role="dialog" aria-modal="true" aria-labelledby="jump-to-title">` overlaying everything when open.
- Backdrop: `fixed inset-0 bg-foreground/40` — click closes.
- Drawer: `fixed inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl bg-background border-t border-border` with `animate-slide-up` (or fall back to a basic Tailwind translate transition if the animation isn't already in the codebase).
- Sticky header: title `Jump to contestant` + `×` close button (aria-label "Close").
- Body: scrollable list, one row per contestant in running order. Current contestant gets `bg-muted` background + a `(current)` text suffix.
- Each row: `<button>` containing running order, flag, country, song (truncated), and a status badge on the right.
- Dismiss handlers: backdrop click → `onClose()`, `×` click → `onClose()`, `Escape` keydown on the dialog → `onClose()`.
- Returns `null` when `!isOpen`.

Status badge styling:
- `"unscored"` → grey pill `Not scored yet` (`text-muted-foreground`, no icon).
- `"scored"` → primary-coloured pill `✓ Scored` (`text-primary`).
- `"missed"` → muted pill `👻 Missed` (`text-muted-foreground`, italic).

### 3.3 `VotingView` changes

**State.** Add `isDrawerOpen: boolean`.

**Footer.** Replace the existing 3-column grid with 4 columns:

```
[← Prev] [I missed this] [☰ Jump to] [Next →]
```

The `Jump to` button uses `variant="ghost"` (matching the missed button) and toggles `setIsDrawerOpen(true)`.

**Drawer render.** After the existing footer `<nav>`:

```tsx
<JumpToDrawer
  isOpen={isDrawerOpen}
  contestants={sortedContestants}
  currentContestantId={contestant.id}
  scoresByContestant={scoresByContestant}
  missedByContestant={missedByContestant}
  categoryNames={categoryNames}
  onSelect={(id) => {
    const target = sortedContestants.findIndex((c) => c.id === id);
    if (target >= 0) setIdx(target);
    setIsDrawerOpen(false);
  }}
  onClose={() => setIsDrawerOpen(false)}
/>
```

**Swipe wrapper.** Add `onTouchStart` and `onTouchEnd` handlers to the existing inner `<div className="w-full max-w-xl space-y-6 animate-fade-in">`. Track the start X coord in a `useRef`. On `touchend`, compute delta and feed to `nextIdxFromSwipe`; if non-null, call `setIdx`.

Touch-target exclusion via `data-no-swipe`:
- Add `data-no-swipe` attribute on the `<div role="group">` inside `ScoreRow.tsx` (the score-button grid).
- Add `data-no-swipe` on the textarea wrapper inside `HotTakeField.tsx`.
- `onTouchStart` checks `event.target.closest("[data-no-swipe]")` — if matched, store `null` in the start ref so `onTouchEnd` short-circuits.

This puts the no-swipe boundary at the DOM level rather than the JSX-tree level — cheaper than restructuring and behaviorally identical.

### 3.4 Locale keys

```json
"voting": {
  "missed": { ... existing },
  "hotTake": { ... existing },
  "jumpTo": {
    "footerButton": "Jump to",
    "footerButtonAria": "Jump to a contestant",
    "title": "Jump to contestant",
    "closeAria": "Close",
    "currentSuffix": "(current)",
    "status": {
      "unscored": "Not scored yet",
      "scored": "✓ Scored",
      "missed": "👻 Missed"
    }
  }
}
```

Component uses bare English strings (mirrors the rest of the voting surface). Keys land for Phase L L1 voting-surface extraction.

## 4. Edge cases

- **Drawer opens during animation** (rare). Tailwind's transition is purely cosmetic — `isOpen` flips immediately and the click handler fires on the new state. No race.
- **Swipe in middle of a touch on a score button** — by structure, the score-button click handler intercepts the click. The `onTouchStart` we attach at the *outer* div still fires though. The `data-no-swipe` check on `event.target.closest("[data-no-swipe]")` returns truthy because the target is the `<button>` inside a `<div role="group" data-no-swipe>`, so we set `swipeStartXRef.current = null` and `touchend` short-circuits. No accidental nav.
- **Drawer scrolled to current contestant.** On open, the drawer auto-scrolls the current row into view via `useEffect` + `ref.scrollIntoView({ block: "center" })`. Acceptable for 26 contestants; smooth scroll fine.
- **Drawer closed via backdrop while scrolled deep into the list.** `isOpen` flips to false, drawer unmounts (because we return `null` when not open) — re-opening starts at the current contestant again. Acceptable; users navigating with the drawer typically tap a row immediately.
- **Both swipe and tap on the same touch.** Tap = touchstart and touchend within ~5px and within ~250ms; threshold-50 for swipe is well above tap drift on iOS. No special handling.
- **Multi-touch (pinch / two-finger swipe).** `event.touches.length > 1` on `onTouchStart` → `swipeStartXRef.current = null` (treat as a non-swipe gesture). Cheap defensive guard.
- **Drawer renders with empty categoryNames.** All rows show `"unscored"`. Same as voting card — won't happen in practice but defensive.
- **Contestant id present in `scoresByContestant` but not in `contestants` prop.** Filtered at the helper level — drawer iterates `contestants`, so stale ids in the score map are simply not rendered.

## 5. Test plan (pure helpers only — no component tests, no jsdom)

- `summarizeContestantStatus.test.ts` — 5 tests:
  1. Missed flag wins even with full scores in the map.
  2. All categories scored, no missed flag → `"scored"`.
  3. Some categories scored → `"unscored"`.
  4. No entry in either map → `"unscored"`.
  5. Empty `categoryNames` → `"unscored"`.

- `nextIdxFromSwipe.test.ts` — 7 tests:
  1. Left swipe (deltaX = -100) at idx=5, total=10 → 6.
  2. Right swipe (deltaX = +100) at idx=5, total=10 → 4.
  3. Left swipe at idx=9, total=10 (last) → null.
  4. Right swipe at idx=0 (first) → null.
  5. Below threshold positive (deltaX = +30) → null.
  6. Below threshold negative (deltaX = -30) → null.
  7. Exactly at threshold (deltaX = +50) → null (strict `>`).

Manual smoke (verification):
1. Tap "Jump to" footer button → drawer slides up; current contestant highlighted; status badges visible per row.
2. Tap a row → drawer closes, voting card shows the selected contestant.
3. Swipe left on the card header → next contestant; right → previous.
4. Swipe left on a score button → no navigation (button receives the press).
5. Swipe left on the hot-take textarea → no navigation (textarea owns selection).
6. Swipe at the first contestant rightwards → no movement (boundary).
7. Drag finger less than 50px → no navigation.
8. Two-finger pinch → no navigation.
9. Drawer × button + Escape + backdrop tap all close the drawer.

## 6. Out-of-scope follow-ons

- §8.8 N/M scored chip on drawer rows (Phase R3, requires `voting_progress` broadcasts).
- Icon-only footer per §8.6 (Phase U).
- Drawer keyboard navigation (arrow keys + Enter).
- Drawer search/filter (rare for 26 contestants).
