# Design: VotingView — voting-screen skeleton

**Date:** 2026-04-21
**Phase:** 3 (voting UI — second sub-slice, composes ScoreRow)
**Depends on:** `ScoreRow` (merged to `main` in PR #17), `POST /api/rooms/{id}/votes` (PR #15, unused this slice)
**SPEC refs:** §8.1 (layout + global scale strip), §8.6 (prev/next nav), §7.2 (category hints)

---

## 1. Goal

Render a working voting UI at `/room/[id]` when `room.status === 'voting'`: the contestant card (flag + country + artist + song + running-order), the global 1/5/10 anchor strip, one `ScoreRow` per category, and Prev/Next navigation. Scores live in local state only this slice.

First visible milestone of Phase 3 end-to-end UX — after this, a user can open a room, start voting as admin, and see the real voting screen. Persistence and live feedback come in subsequent slices.

## 2. Scope

### In scope
- `src/components/voting/VotingView.tsx` — presentation + local state, no fetch.
- `src/components/voting/scoredCount.ts` — pure helper: given a scores record + required category names, return how many categories are filled (1..total inclusive). Used to drive the §8.1 progress bar.
- `src/components/voting/scoredCount.test.ts` — vitest unit tests under the existing node env.
- `src/app/room/[id]/page.tsx` — add a `status === "voting"` branch that renders `VotingView`. Mirrors the existing `status === "lobby"` branch.

### Out of scope (tracked separately)
- **Autosave to `POST /api/rooms/{id}/votes`** — scores are ephemeral this PR. Reloading the tab loses local scores. Own slice next.
- 3-state save chip (Saving / Saved / Offline), offline queue, conflict reconciliation.
- "I missed this" button + toast + undo.
- Hot-take text input.
- Swipe navigation (SPEC §8.6 gesture path).
- Jump-to drawer.
- Now-performing snap (SPEC §6.5).
- Per-contestant `N / M scored` chip (SPEC §8.8) — requires aggregating `voting_progress` broadcasts.
- Admin "End voting" control.
- Screen wake lock (SPEC §8.9).
- Realtime subscription for voting-phase events (the existing page-level `useRoomRealtime` already handles `status_changed`; nothing else needed yet).

## 3. Architecture

```
src/app/room/[id]/page.tsx          (modified — adds voting branch)
  └─ VotingView                     (new)
       ├─ header                    (flag, country, song, artist, progress cluster)
       ├─ scale strip               (global 1/5/10 anchors, once per card)
       ├─ ScoreRow × N              (PR #17 leaf component, one per category)
       └─ footer                    (Prev / Next)
```

The page already owns room + memberships + contestants fetching and realtime. This design adds no new data fetching; `VotingView` receives everything via props.

## 4. Props surface

```ts
import type { Contestant, VotingCategory } from "@/types";

export interface VotingViewProps {
  /** Expected pre-sorted by runningOrder; component sorts defensively. */
  contestants: Contestant[];
  /** Same shape the room's lobby already passes. */
  categories: VotingCategory[];
  /** Reserved — unused this slice, typed so future autosave PR needn't edit props. */
  isAdmin?: boolean;
}
```

No callbacks. No mutation of parent state. Entirely self-contained this slice.

## 5. State

```ts
const sortedContestants = useMemo(
  () => [...contestants].sort((a, b) => a.runningOrder - b.runningOrder),
  [contestants]
);

const [idx, setIdx] = useState(0);

// key = contestant.id, value = per-category scores (sparse — untouched categories absent)
const [scoresByContestant, setScoresByContestant] = useState<
  Record<string, Record<string, number | null>>
>({});
```

**Why a sparse Record and not a filled matrix?** Untouched categories stay undefined. `ScoreRow` expects `value: number | null` — `undefined` coerces cleanly to `null` via `?? null`. Filling all categories up front would require a `useEffect` to seed and would waste memory.

**Why `number | null` and not just `number`?** `null` represents an explicit clear (user tapped selected button). `undefined` represents "never touched". Both render the same (unset) but preserve intent if we ever need to distinguish.

**Why component-local, not page-level?** Scores don't leave the voting phase in this slice. When autosave lands, the score callback moves up to the page so it can own the POST + save chip. That refactor is trivial (add an `onChange` prop to `VotingView`) and doesn't require rewriting storage.

## 6. Rendering

### 6.1 Header (SPEC §8.1)

```
┌─────────────────────────────────────────────────────────────┐
│  🇺🇦  Ukraine                          3/17                 │
│      "Zinger" — Alyosha                 ▰▰▰▱▱▱ 2 scored     │
└─────────────────────────────────────────────────────────────┘
```

- Left column: flag emoji (text, not image — renders as system emoji), country name (bold), then on a second line the song title in quotes + em-dash + artist.
- Right column: running-order `{n}/{total}` stacked above a thin progress bar (`bg-muted` track, `bg-primary` fill at width `scoredContestants / total`), with `{count} scored` label beneath in `text-muted-foreground`.
- `scoredContestants` — how many distinct contestants have `scoredCount === categories.length` in local state (full-scored, not missed). Derives from `scoredCount` helper + `categories.length` comparison.

### 6.2 Global scale strip (SPEC §8.1)

One line directly below the header, above the score rows:

```
Scale: 1 Devastating · 5 Fine · 10 Iconic
```

Rendered as plain text in `text-xs text-muted-foreground`. Anchor copy comes from `SCORE_ANCHORS` in `src/types/index.ts` (existing constant). Not translated this PR — i18n of score anchors is a Phase L L1 task separately tracked.

### 6.3 Score rows

```tsx
{categories.map((cat) => (
  <ScoreRow
    key={cat.name}
    categoryName={cat.name}
    hint={cat.hint}
    value={scoresByContestant[contestant.id]?.[cat.name] ?? null}
    weightMultiplier={nonUniformWeights ? cat.weight : undefined}
    onChange={(next) => updateScore(contestant.id, cat.name, next)}
  />
))}
```

`nonUniformWeights = categories.some(c => c.weight !== categories[0].weight)`. When every category has the same weight, the weight-badge stays hidden (matches SPEC §8.2 rationale: "no visual noise in the common case").

### 6.4 Footer

Two buttons side by side via `grid grid-cols-2 gap-4` (matches existing Button sizing conventions):

- **Prev** — disabled when `idx === 0`.
- **Next** — disabled when `idx === sortedContestants.length - 1`.

Both use the existing `Button` component with `variant="secondary"`. No keyboard shortcut handling this slice (arrow keys work via native button focus → Space/Enter, but no "left arrow = Prev" global listener).

## 7. The `scoredCount` helper

```ts
// src/components/voting/scoredCount.ts
export function scoredCount(
  scores: Record<string, number | null> | undefined,
  categoryNames: readonly string[]
): number {
  if (!scores) return 0;
  let count = 0;
  for (const name of categoryNames) {
    const v = scores[name];
    if (typeof v === "number") count += 1;
  }
  return count;
}
```

Pure. Returns `0..categoryNames.length`. Used twice:
- Per-contestant status ("fully scored" = `scoredCount === categoryNames.length`) for the header progress bar.
- Could be used later by the progress chip (§8.8) — but that chip is out of scope.

**Tests** (pure, no DOM):
1. `undefined` scores → 0
2. Empty object → 0
3. Partial fill (3 of 5 categories) → 3
4. All null values → 0 (null ≠ a score)
5. Keys not in the category list are ignored (resilience)
6. Fully filled → equals `categoryNames.length`

## 8. Accessibility

- Header emits `<h2>` for country name (page-level landmark).
- Running-order + progress rendered as `<span>` + `<progress max={n} value={k}>`; `aria-label="{k} of {n} contestants fully scored"`.
- Prev/Next buttons: `<button>` with `aria-label="Previous contestant"` / `"Next contestant"` — visible text is just the word.
- No arrow-key handling added; Tab navigation works by default.
- The `isAdmin` prop does nothing visible this PR — no admin chrome yet.

## 9. Error / empty states

- **Empty `categories`.** Room creation requires ≥1 category; should never happen. If it does, render a minimal fallback: `"No voting categories configured — ask the host to check the room setup."` in `text-destructive`. Defensive, not expected.
- **Empty `contestants`.** Same: should never happen, but if it does, render `"No contestants for this event."`. The wizard blocks room creation when the API + hardcoded fallback both fail (SPEC §5.1e), so this only triggers for a schema regression.
- **Viewing outside the voting phase.** The page-level branch ensures `VotingView` only renders when `status === 'voting'`; otherwise page routes to `LobbyView` / `StatusStub` as today.

## 10. Page integration

Add a new branch to `src/app/room/[id]/page.tsx` after the existing lobby branch:

```ts
if (phase.room.status === "voting") {
  return (
    <VotingView
      contestants={phase.contestants}
      categories={phase.room.categories ?? []}
      isAdmin={isAdmin}
    />
  );
}
```

This requires:
1. Adding `contestants` to the `Phase.ready` shape (currently only `room` + `memberships`).
2. Threading `data.contestants` into `setPhase({ kind: "ready", ... })` in two places (initial load + post-join refetch).
3. Adding `ContestantShape[]` type (or reusing `Contestant` from `@/types` — preferred).

No change to realtime handler; `status_changed` already triggers `loadRoom()`, which transitions the view as the status changes (lobby → voting → scoring…).

## 11. Non-obvious decisions (flagged)

1. **Zero persistence.** This slice's biggest call-out: scores are local component state. Reload loses them. Autosave is the next stacked PR.
2. **Sparse score storage.** `Record<contestantId, Record<categoryName, number | null>>` — untouched categories stay undefined. Cheap, converts cleanly to the `ScoreRow` `value: number | null` prop via `?? null`.
3. **Component-local state, not page-level.** When autosave lands, the `onChange` moves up — trivial refactor. Until then, keeping it local avoids polluting the page component.
4. **Defensive sort.** Even though the API orders contestants by `runningOrder`, the component sorts in a `useMemo` to survive any upstream drift.
5. **No deep linking.** `idx` is `useState`, not a URL query param. Deep-linking a contestant during voting is off-spec and would add routing complexity (e.g. "what if `?c=2026-xx` isn't in the running order?").
6. **Global scale strip text is English-only.** Pulls from the existing `SCORE_ANCHORS` constant. Phase L L1 will extract it with `t('voting.anchor1|5|10')` across the voting UI at once.
7. **`weightMultiplier` propagated only when needed.** When all categories share one weight (the common case — all predefined templates default to weight 1), the badge stays hidden. Matches SPEC §8.2 "no visual noise in the common case".
8. **PR-ordering note.** This branch was started before PR #17 merged; rebased onto main after #17 landed. Clean 3-commit diff expected.

## 12. Follow-ups spawned by this design

- **Autosave slice (next PR).** Wire `VotingView.onChange` → `POST /api/rooms/{id}/votes` with 500ms debounce. Add 3-state save chip.
- **"I missed this" slice.** Footer button + toast with 5s undo; projected-score display on missed rows (§8.3, §8.4).
- **Hot-take slice.** Textarea below score rows, 140-char counter, emoji-aware (§8.7).
- **Swipe navigation.** Attach gesture handler to card, constrained to non-score-button regions (SPEC §8.6).
- **Jump-to drawer.** Button in footer → drawer with all contestants + per-contestant scored chip (§8.1).
- **Now-performing snap.** Consume `now_performing` broadcast; snap `idx` to that contestant unless user is mid-press (§6.5).
- **Progress chip (§8.8).** Aggregate `voting_progress` broadcasts per contestant across all room members; render on contestant card + jump-to drawer.
- **Admin end-voting control.** Button rendered only when `isAdmin`, calls `PATCH /api/rooms/{id}/status` → `voting_ending` (once R0 schema migration lands).
- **Wake lock (§8.9).** `navigator.wakeLock.request('screen')` on `VotingView` mount, release on unmount.
- **i18n (Phase L L1).** Extract every literal in this component via `t()` once the voting-surface extraction pass happens.
