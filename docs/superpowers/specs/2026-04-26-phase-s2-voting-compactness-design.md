# Phase S2 — voting-card compactness

**Date:** 2026-04-26
**Status:** Approved
**SPEC sections:** §8.1 (header), §8.2 (score row + hint collapse), §6.6.3 (lobby primer-carousel sets the same flag this slice consumes)
**TODO references:** Phase S2 (the still-open lines)
**Closes:** Phase R3 §8.1 header replacement, Phase R3 §8.2 hint-collapse, Phase U V13/V14 are unrelated

## 1. Goal

Compress the voting card so that on iPhone 12+ (390×750 CSS px), a 5-category Classic-template room with collapsed hints + collapsed hot-take fits on one screen with no vertical scroll.

The two remaining vertical-budget eaters are:
1. The full-width *"Scale: 1 Devastating · 5 Fine · 10 Iconic"* strip rendered above the category rows on every card (~32 px).
2. The two-baseline category-row header (name + status pill on a separate visual line) (~16 px × 5 rows = ~80 px).

This slice replaces both with single-line / collapsed equivalents and adds a hint-collapse default driven by an `localStorage.emx_hints_seen_{roomId}` flag, with one-time onboarding for first-time voters.

## 2. Out of scope

- **Phase S3 calibration drawer / lock chip** — `<CalibrationSheet>` and the lock affordances in §8.1 are deferred.
- **Phase R2 lobby primer carousel** — the `emx_hints_seen_{roomId}` flag is *consumed* here but its lobby-side setter doesn't yet exist. The slice's onboarding setter is the only flag-writer for now.
- **Phase L L3 translations** — only `en.json` keys are added. Other locales remain empty stubs.
- **Vertical-budget regression test** — deferred. The repo's vitest is `node`-env and there is no DOM testing harness; manual smoke verification on iPhone 12+ during PR review is the success criterion. (Discussed in §6 and explicitly accepted at brainstorm time.)
- **Per-contestant `N / M scored` chip on the voting card** — Phase R3, separate slice. The chip already lives on jump-to-drawer rows.
- **Custom-template builder** — Phase U A5–A8.

## 3. Scope

### 3.1 In scope

**A. Scale ⓘ replacement (§8.1)**
- Remove the global `Scale: 1 Devastating · 5 Fine · 10 Iconic` strip from `<VotingView>`.
- Add an ⓘ icon-button to the header, positioned to the left of the progress cluster.
- Tap → opens a bottom-sheet (or fullscreen-on-mobile modal) listing the three anchors:
  - `1 — Devastating`
  - `5 — Fine`
  - `10 — Iconic`
- New component: `<ScaleAnchorsSheet>`.

**B. Score-row single-line header refactor (§8.2)**
- Collapse the existing two-baseline header into a single line: `name · status` (status inline, separated by a middle-dot `·`).
  - Unscored: `Vocals · Not scored` — `Vocals` in `text-foreground`, suffix in `text-muted-foreground`.
  - Scored: `Vocals · ✓ scored 7` — `Vocals` in `text-foreground`, suffix in `text-primary` (gold).
- Drop the right-aligned status pill that currently sits opposite the name.
- Weight badge stays in its current relative position to the name (left side, after the name).

**C. Score-row ⓘ hint collapse (§8.2)**
- When `hint` exists, render an ⓘ icon-button immediately after the category name (and after the weight badge, if present).
- Hint visibility is driven by an `expanded` prop on `<ScoreRow>` (parent owns state).
- Accessibility: `<ScoreRow>` exposes `aria-expanded` on the ⓘ button + `aria-controls` pointing at the hint's element id.

**D. Hint-collapse state + flag (§8.2)**
- New pure helper: `seenHintsKey(roomId): string` and a small client module `emxHintsSeen.ts` exposing `isSeen(roomId)` / `markSeen(roomId)`. Pure read/write to `localStorage`; safe-guarded for SSR.
- New hook: `useHintExpansion(roomId, contestantId, categoryNames): { expandedFor, toggleFor, onScored, onNavigated, onboarding }`.
  - **Two pieces of state**:
    - `onboarding: boolean` — `true` when the localStorage flag was unset at mount and hasn't been flipped yet. Lives at the hook level (not per-contestant).
    - `overrides: Record<categoryName, boolean>` — per-contestant manual overrides. Resets to `{}` whenever `contestantId` changes (per spec §8.2: *"per-card state is independent"*). Lives at the hook level but is scoped semantically to the current contestant.
  - **Read derivation**: `expandedFor[name] = overrides[name] ?? (onboarding ? true : false)`. So when a user hasn't touched a hint on this card, it shows the default (expanded during onboarding, collapsed otherwise); when they have, it shows their explicit choice.
  - `toggleFor(name)`: writes the flipped value into `overrides[name]`. Always derives the "current" value from `expandedFor[name]` (which respects defaults), so toggling an untouched hint during onboarding writes `false` (collapse) and during steady-state writes `true` (expand). If `onboarding === true`, also flips `onboarding` to `false` (which triggers the `markSeen` effect — see below).
  - `onScored()`: if `onboarding === true`, flips `onboarding` to `false`. Does NOT touch `overrides` — the user is reading; let them finish.
  - `onNavigated()`: same as `onScored()`. Fired when the user uses prev/next/swipe/jump-to.
  - **Effect**: a single `useEffect` watches `onboarding`. When it transitions from `true` to `false`, the effect calls `markSeen(roomId)` (the only flag-writer in this slice). The effect is idempotent if `markSeen` is called twice (`localStorage.setItem` of the same value).
  - **Effect on `contestantId` change**: a separate `useEffect` clears `overrides` when `contestantId` changes. Implemented as a reducer dispatch (`{ type: "contestantChanged", contestantId }`) so it's testable as part of the pure reducer.

**E. First-card onboarding microcopy (§8.2)**
- When `useHintExpansion` is in the "in-onboarding" state (i.e. flag was unset at mount and hasn't been flipped yet — driven by `onboarding === true` on the hook's return), render a single muted-foreground line beneath the score rows: *"Tap ⓘ on a category to hide its hint."* (locale key `voting.hint.onboarding`).
- Disappears the moment the flag flips (any score / nav / ⓘ-toggle).
- Does NOT re-render on subsequent navigations once the flag is set, because the `onboarding` flag survives navigation but flips on first action.

**F. Locale keys (`en.json` only)**
- `voting.status.scored` — `"✓ scored {value}"`
- `voting.status.unscored` — `"Not scored"`
- `voting.scale.openAria` — `"Show scale anchors"`
- `voting.scale.closeAria` — `"Close scale anchors"`
- `voting.scale.title` — `"Scale"`
- `voting.scale.1` — `"Devastating"`
- `voting.scale.5` — `"Fine"`
- `voting.scale.10` — `"Iconic"`
- `voting.hint.toggleAria.collapsed` — `"Show hint for {category}"`
- `voting.hint.toggleAria.expanded` — `"Hide hint for {category}"`
- `voting.hint.onboarding` — `"Tap ⓘ on a category to hide its hint."`

Closes the Phase R8 lines for `voting.scale.*`, `voting.status.scored/unscored`. The `voting.hint.*` namespace is new.

### 3.2 Acceptance — manual smoke

On iPhone 12 viewport (390×750), with a Classic-template room (5 categories, all weight 1, no custom hints disabled):
- Card on first entry: header + 5 rows with hints **expanded** (~one screen + slight scroll, acceptable for onboarding) + onboarding microcopy + collapsed hot-take pill + footer.
- After tapping any score, navigating to another contestant, or tapping ⓘ on any row: navigate to the next contestant — that card and all subsequent cards render with hints **collapsed** by default.
- Steady-state card (collapsed hints, collapsed hot-take, 5 rows): header + rows + pill + footer ≤ 750 px tall, no scroll required.
- Tapping the header ⓘ opens the scale bottom-sheet. Tapping anchors / outside / × dismisses it.

## 4. Component / state design

### 4.1 `<ScaleAnchorsSheet>`

```tsx
interface ScaleAnchorsSheetProps {
  open: boolean;
  onClose: () => void;
}
```

Renders a fixed bottom-sheet (mobile-style: full-width, slide up from bottom, dimmed backdrop) when `open`. Inside: title (`voting.scale.title`), three rows of `n — Label`, a close button. Backdrop click or ✕ → `onClose()`. Escape key → `onClose()`. Trap focus inside while open, restore focus to the trigger button on close.

Placement: rendered inside `<VotingView>`, controlled by a single `useState<boolean>` next to the existing card state.

Why bottom-sheet and not popover: the spec gives the choice; bottom-sheet is the mobile-default and matches `<JumpToDrawer>`'s existing pattern.

### 4.2 `<ScoreRow>` refactor

Existing prop signature (`categoryName`, `hint`, `value`, `weightMultiplier`, `onChange`, `disabled`) gains:

```tsx
hintExpanded?: boolean;     // default: !hint (collapsed when no hint to show)
onToggleHint?: () => void;  // omitted when no hint
```

Header collapses from two-baseline to single-line:

- `<div class="flex items-baseline gap-2 min-w-0">`
  - `<span class="font-medium text-foreground truncate">{categoryName}</span>`
  - `{showWeightBadge && <Badge>}`
  - `{hint && <HintToggleButton aria-expanded={hintExpanded} onClick={onToggleHint} />}`
  - `<span class="text-sm text-muted-foreground">·</span>`
  - `<span class="text-sm {scored ? 'text-primary font-medium' : 'text-muted-foreground'}">{statusText}</span>`

Hint paragraph remains, gated on `hint && hintExpanded`. The right-aligned pill (`text-sm flex-shrink-0`) is removed entirely.

The score-bar grid is unchanged.

### 4.3 `useHintExpansion` hook + `nextHintExpansion` reducer

```ts
type HintExpansionState = {
  contestantId: string;
  onboarding: boolean;
  overrides: Record<string, boolean>;
};

type HintExpansionEvent =
  | { type: "init"; roomSeen: boolean; contestantId: string }
  | { type: "contestantChanged"; contestantId: string }
  | { type: "toggle"; name: string; namesInDisplayOrder: readonly string[] }
  | { type: "scored" }
  | { type: "navigated" };

export function nextHintExpansion(
  state: HintExpansionState,
  event: HintExpansionEvent,
): HintExpansionState;

export function useHintExpansion(
  roomId: string | undefined,
  contestantId: string,
  categoryNames: readonly string[],
): {
  expandedFor: Record<string, boolean>;
  toggleFor: (name: string) => void;
  onScored: () => void;
  onNavigated: () => void;
  onboarding: boolean;
};
```

**Reducer rules** (pure, fully tested):
- `init`: returns `{ contestantId, onboarding: !roomSeen, overrides: {} }`.
- `contestantChanged`: returns `{ contestantId: event.contestantId, onboarding: state.onboarding, overrides: {} }`. (Onboarding flag survives navigation; overrides reset.)
- `toggle`: computes the current effective value (`overrides[name] ?? state.onboarding`), writes the flipped value into `overrides[name]`, and sets `onboarding: false`. The `namesInDisplayOrder` field is unused by the reducer itself but serializable for tracing if needed.
- `scored` and `navigated`: identity if `state.onboarding === false`. Otherwise return the same state with `onboarding: false`. No effect on `overrides`.

**Hook wiring** (manually verified — no DOM test in this slice):
- `useReducer(nextHintExpansion, initialState)` where `initialState` is the `init`-result computed at mount-time using `isSeen(roomId)`.
- `useEffect(() => dispatch({ type: "contestantChanged", contestantId }), [contestantId])` — fires when the active contestant changes.
- `useEffect(() => { if (!state.onboarding) markSeen(roomId) }, [state.onboarding, roomId])` — calls `markSeen` whenever the flag flips false (idempotent under repeated calls).
- `expandedFor` derived via `useMemo` from `state.overrides` + `state.onboarding` + `categoryNames`.
- `toggleFor / onScored / onNavigated` are stable callbacks dispatching the matching events.

Reducer tests in `useHintExpansion.test.ts` (see §6).

### 4.4 `emxHintsSeen` module

```ts
// src/lib/voting/emxHintsSeen.ts
export function seenHintsKey(roomId: string): string {
  return `emx_hints_seen_${roomId}`;
}

export function isSeen(roomId: string): boolean {
  if (typeof window === "undefined") return false;  // SSR-safe
  try {
    return window.localStorage.getItem(seenHintsKey(roomId)) === "true";
  } catch {
    return false;  // Safari private mode etc.
  }
}

export function markSeen(roomId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(seenHintsKey(roomId), "true");
  } catch {
    /* swallow */
  }
}
```

Tested as a unit (see §6).

### 4.5 `<VotingView>` integration

- Remove the `Scale: …` div block (around line 320 of the current file).
- Add `<ScaleAnchorsSheet>` + a header ⓘ button that toggles its `open` state.
- Replace the manual per-card `<ScoreRow hint={...}>` props with state from `useHintExpansion`. Pass `hintExpanded={expandedFor[c.name]}` and `onToggleHint={() => toggleFor(c.name)}`.
- Wire `onScored` into the existing `onScoreChange` path (call when a score actually changes from null/value to a different value).
- Wire `onNavigated` into the prev/next/swipe/jump-to navigation handlers.
- Conditionally render the onboarding microcopy line when `onboarding === true`.

## 5. File structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/voting/emxHintsSeen.ts` | Create | localStorage read/write for the per-room hints-seen flag |
| `src/lib/voting/emxHintsSeen.test.ts` | Create | Unit tests: SSR-safe, key shape, error swallowing |
| `src/components/voting/useHintExpansion.ts` | Create | Hook: per-card hint expansion state + onboarding flag |
| `src/components/voting/useHintExpansion.test.ts` | Create | Unit tests for the hook (using `renderHook` from `@testing-library/react` if present, else split logic into pure helper) |
| `src/components/voting/ScaleAnchorsSheet.tsx` | Create | Header ⓘ bottom-sheet |
| `src/components/voting/ScoreRow.tsx` | Modify | Single-line header + ⓘ hint toggle |
| `src/components/voting/VotingView.tsx` | Modify | Remove scale strip, mount sheet + hook, render onboarding microcopy |
| `src/locales/en.json` | Modify | Add 11 new keys under `voting.{status,scale,hint}` |

## 6. Tests

The repo's vitest is in `node` env. Strategy: pull every testable invariant into pure helpers and unit-test them. Components themselves are smoke-tested manually.

**`emxHintsSeen.test.ts` — unit:**
1. `seenHintsKey("abc")` returns `"emx_hints_seen_abc"`.
2. `isSeen("abc")` returns `false` when the key is unset.
3. `isSeen("abc")` returns `true` when the key was set to `"true"`.
4. `markSeen("abc")` writes `"true"` to the right key.
5. SSR safety: `isSeen` returns `false` and `markSeen` is a no-op when `window === undefined` (mock by deleting `globalThis.window`).
6. localStorage-throws: `isSeen` returns `false` and `markSeen` is a no-op when `localStorage.setItem`/`getItem` throws.

**`useHintExpansion.test.ts` — unit (reducer-only):**

The reducer is pure — tested directly. The hook itself (effects + useMemo wiring) is manually verified during the §7 smoke check.

Reducer test cases (each tests `nextHintExpansion(state, event)` directly):

1. `init { roomSeen: true, contestantId: "X" }` → `{ contestantId: "X", onboarding: false, overrides: {} }`.
2. `init { roomSeen: false, contestantId: "X" }` → `{ contestantId: "X", onboarding: true, overrides: {} }`.
3. `contestantChanged { contestantId: "Y" }` from state with non-empty overrides → `overrides: {}`, `contestantId: "Y"`, `onboarding` unchanged.
4. `toggle { name: "Vocals", ... }` from state-2 (onboarding) → `overrides: { Vocals: false }`, `onboarding: false`. (Onboarding default was `true`, flipping → `false`.)
5. `toggle { name: "Vocals", ... }` from state-1 (steady) → `overrides: { Vocals: true }`, `onboarding: false`. (Default was `false`, flipping → `true`.)
6. `toggle` twice on the same name → `overrides[name]` flips back to default (`true` then `false` etc.). Confirms the toggle uses the *effective* current value (override-or-default), not just `overrides[name]`.
7. `scored` from state-2 (onboarding) → `onboarding: false`, `overrides: {}` (unchanged). `state` is otherwise referentially equal? No — return new state with `onboarding: false`.
8. `scored` from state-1 (steady) → identity (`===` to input).
9. `navigated` mirrors `scored`.
10. `contestantChanged` clears overrides but preserves `onboarding: true` if currently onboarding.

The reducer is exhaustively tested. The two `useEffect`s and the `useMemo` are simple enough to manually verify in the smoke pass:
- Effect 1: contestantId change → `dispatch({ type: "contestantChanged", contestantId })`. Manual smoke: navigate forward, observe overrides reset.
- Effect 2: `state.onboarding` flip false → `markSeen(roomId)`. Manual smoke: open dev tools, watch `localStorage.emx_hints_seen_${roomId}` after first toggle/score/navigate.

**No new VotingView/ScoreRow tests.** Both are JSX-only changes; unit-testable behaviour lives in the hook + helper above.

## 7. Acceptance — verification

- `npm run type-check` clean.
- `npm test` — all suites pass; new helper + reducer tests added.
- `npm run lint` clean.
- Manual smoke: dev server, navigate to a real test room, verify:
  - First entry: hints expanded on the active card, onboarding microcopy visible, scale strip absent.
  - Tap ⓘ on a row → that hint collapses, microcopy goes away.
  - Navigate to next contestant → hints all collapsed by default. Microcopy not visible.
  - Refresh the page → hints still collapsed (flag persists).
  - Open a fresh room (different roomId) → hints expanded again on first entry (flag is per-room).
  - Tap header ⓘ → bottom-sheet appears with three anchors. Backdrop / ✕ / Esc dismiss it.
- iPhone 12 viewport check (390×750): steady-state card with a 5-category Classic template, no scroll.

## 8. Rollback

Three commit boundaries planned in §9 below. Any single commit revertable in isolation (each leaves the build green). Rolling back the whole slice means reverting the merge commit.

## 9. Slicing

Single PR, but four logical commits inside it for clean review:

1. Locale keys — `en.json` additions only.
2. `emxHintsSeen` helper + tests — pure module.
3. `nextHintExpansion` reducer + `useHintExpansion` hook + tests.
4. Components: `<ScaleAnchorsSheet>` + `<ScoreRow>` refactor + `<VotingView>` integration + onboarding microcopy. Single coupled commit (cards/parent rewiring tightly coupled).

## 10. Follow-ups (not in this slice)

- Phase R2 lobby primer carousel — when shipped, also writes `emx_hints_seen_{roomId}` (no extra work in this slice; the consumer is already wired).
- Phase S3 calibration drawer button + lock chip in the header — separate slice.
- Phase R3 per-contestant `N/M scored` chip on the voting card — depends on `voting_progress` broadcast wiring, separate slice.
- Phase L L3 translations of the new keys to es/uk/fr/de.
- A real DOM-testing harness (Playwright or testing-library + jsdom) so future slices can test JSX directly. Recommended for after Phase 6 / Phase 7.
