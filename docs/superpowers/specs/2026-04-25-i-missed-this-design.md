# "I missed this" voting flow — design

**Date:** 2026-04-25
**Spec sections:** SPEC §8.3 (button), §8.4 (projected score), §8.5 (autosave for missed toggle)
**Phase:** 3 — Voting

---

## 1. Goal

Let a guest mark a contestant as "missed" mid-show without leaving the voting flow. The scoring engine already fills missed entries with the user's per-category averages (`computeMissedFill` in `src/lib/scoring.ts`); this work adds the **client-side affordance and projected-score display** that lets the user see what the scoring engine will substitute. Backend already accepts `{ missed: true }` on `POST /api/rooms/{id}/votes`.

## 2. Non-goals

- Realtime own-votes subscription (SPEC §8.4 mentions it; per Q2 of the brainstorm we ship local-state only — the user is the only writer of their own votes, so local state is the source of truth).
- The "updated from your recent votes" inline `animate-score-pop` label on projected category cells (Phase U V8 — separate item).
- Hot-take 140-char field (Phase 3, separate item — V13/V14).
- Jump-to drawer / swipe-nav refinements (Phase 3, separate items — §8.6, §8.8).

## 3. User flow (canonical)

1. User is on a contestant's voting card.
2. User taps the **"I missed this"** button in the footer.
3. The card immediately switches to a **missed-state card** showing `~7` (overall projected average) and a per-category breakdown (`~6` vocals, `~7` stage, …). A "Rescore this contestant" button is present at the bottom of the card.
4. A bottom toast appears: *"Marked missed — we'll estimate your scores as ~7. Undo"*. Toast auto-dismisses at 5 seconds.
5. If the user taps **Undo** within 5s → state reverts; the score-row UI returns; toast disappears.
6. If 5s elapses without Undo → toast disappears; the missed state persists. The user can still revert via the **Rescore** button on the missed-state card.
7. The autosave debounce is 500ms (existing). A "tap missed → tap undo within 500ms" sequence never hits the wire.

## 4. Architecture

Three shippable PRs, in order. Each is independently testable and `tsc --noEmit` clean.

### PR 1 — Pure helpers + Autosaver extension

**New file:** `src/lib/voting/computeProjectedAverage.ts`

```ts
export interface ProjectedAverage {
  perCategory: Record<string, number>;  // rounded int, 1–10
  overall: number;                       // rounded mean of all per-cat means, 1–10
}

export function computeProjectedAverage(
  scoresByContestant: Record<string, Record<string, number | null>>,
  missedByContestant: Record<string, boolean>,
  categories: { name: string }[]
): ProjectedAverage;
```

Algorithm:
- For each category `c`: collect every score value across contestants where `missedByContestant[id] !== true` and the value is a number (not null). Compute `mean(values)`, round with `Math.round`.
- If no values for category `c`: default to `5`.
- `overall = round(mean(perCategory values))`. If perCategory all came from defaults (no votes at all anywhere): overall = `5`.
- Clamp overall to `[1, 10]`.

**Test cases (`computeProjectedAverage.test.ts`):**
- No votes anywhere → all cats `5`, overall `5`.
- Some cats have votes, some don't → unscored cats default to `5`.
- A contestant flagged missed but with stale scores still in the map → those scores excluded.
- Rounding: `6.5 → 7`, `6.4 → 6`.
- Single contestant scored, all 10s → all cats `10`, overall `10`.
- Two contestants, one missed → only non-missed contributes.

**Modified:** `src/lib/voting/Autosaver.ts`

New `schedule` shape:

```ts
schedule(contestantId: string, fields: {
  scoreFor?: { categoryName: string; value: number | null };
  missed?: boolean;
  hotTake?: string | null;       // accepted now, used by future PRs
}): void;
```

Pending entry holds `{ scores: Record<string, number|null>; missed?: boolean; hotTake?: string|null }`. On flush, merges into a single `POST /votes` payload via `deps.post`. Existing single-arg score-only calls migrate to the new shape at the call site (`useVoteAutosave`).

**Test cases (`Autosaver.test.ts` additions):**
- Missed-only schedule → flush sends `{ missed: true }` with no `scores`.
- Score then missed in the same debounce window → single flush sends both.
- Two missed schedules within debounce → coalesce, last wins.
- Score after missed in same window → both go in same payload.

**Modified:** `src/components/voting/useVoteAutosave.ts`

Adds:
```ts
onMissedChange: (contestantId: string, missed: boolean) => void;
```
to `UseVoteAutosaveResult`. Internally calls `saver.schedule(contestantId, { missed })`.

### PR 2 — Missed UI: footer button + missed-state card

**New file:** `src/components/voting/MissedCard.tsx`

Props:
```ts
interface MissedCardProps {
  projected: ProjectedAverage;
  categories: { name: string }[];
  onRescore: () => void;
}
```

Layout (rendered in place of `<ScoreRow>` list when `missedByContestant[contestant.id] === true`):
- Section label: *"This one's marked as missed"* (`text-muted-foreground`).
- Large overall: `~{projected.overall}` (italic, dimmed, large font, tilde prefix).
- Per-category list — one row per category: name on the left, `~{projected.perCategory[name]}` on the right, both dimmed.
- Full-width secondary `<Button>` "Rescore this contestant" at the bottom — calls `onRescore`.

All copy via `t()` (locale keys listed in §6).

**Modified:** `src/components/voting/VotingView.tsx`

- Add `missedByContestant` state, seeded from `initialMissed` prop.
- Add `onMissedChange?: (contestantId: string, missed: boolean) => void` prop.
- Restructure footer: 3 columns `[Prev] [I missed this] [Next]`. Missed button is disabled when current contestant is already in missed state.
- Branch render: when `missedByContestant[contestant.id]`, render `<MissedCard>` with `projected = useMemo(() => computeProjectedAverage(...))`. Otherwise render the existing score rows.
- Rescore handler: `setMissed(id, false)`.

**Modified:** `src/lib/voting/seedScoresFromVotes.ts`

Either (a) extend the existing helper to return both `scores` and `missed` maps, or (b) add a sibling `seedMissedFromVotes`. We'll go with (b) to avoid disrupting the existing call site signature beyond the additive prop.

**Modified:** `src/app/room/[id]/page.tsx`

- Compute `initialMissed = seedMissedFromVotes(phase.votes, phase.contestants)`.
- Pass `initialMissed` and `autosave.onMissedChange` to `<VotingView>`.

**Test cases:**
- `MissedCard.test.tsx` — renders overall and each per-category projected; clicking Rescore fires `onRescore`.
- `VotingView.test.tsx` (extension) — clicking "I missed this" sets missed state for current contestant and calls `onMissedChange(id, true)`. Renders `<MissedCard>` after toggle. Clicking Rescore returns to score rows. Navigating to a non-missed contestant preserves the missed flag of the previous one. Projected updates when the user scores another contestant.
- `seedMissedFromVotes.test.ts` — handles missing/empty votes; round-trips a vote with `missed: true`.

### PR 3 — Toast + 5s Undo

**New file:** `src/hooks/useMissedUndo.ts`

```ts
export interface MissedUndoToast {
  contestantId: string;
  projectedOverall: number;
}
export interface UseMissedUndoResult {
  toast: MissedUndoToast | null;
  trigger: (contestantId: string, projectedOverall: number) => void;
  undo: () => void;
  dismiss: () => void;
}
export function useMissedUndo(opts: {
  onUndo: (contestantId: string) => void;
  ttlMs?: number;             // default 5000
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
}): UseMissedUndoResult;
```

Behaviour:
- `trigger(id, overall)` sets `toast` and arms a `ttlMs` timer that nulls the toast on expiry.
- A second `trigger(...)` replaces the active toast and re-arms the timer (no queue).
- `undo()` calls `onUndo(toast.contestantId)` and clears the toast and timer.
- `dismiss()` clears the toast and timer without calling `onUndo`.
- Unmount clears the timer (no leak).

**New file:** `src/components/voting/MissedToast.tsx`

```ts
interface MissedToastProps {
  toast: MissedUndoToast | null;
  onUndo: () => void;
}
```

- Returns `null` when `toast === null`.
- Otherwise renders fixed-position bottom toast (`fixed bottom-4 inset-x-4 mx-auto max-w-md z-20`), `role="status" aria-live="polite"`, with `animate-fade-in`. Body: *"Marked missed — we'll estimate your scores as ~{overall}."* + *"Undo"* button.

**Modified:** `src/components/voting/VotingView.tsx`

```ts
const undo = useMissedUndo({ onUndo: (id) => setMissed(id, false) });
function handleMarkMissed(id: string) {
  setMissed(id, true);
  const next = { ...missedByContestant, [id]: true };
  const projected = computeProjectedAverage(scoresByContestant, next, categories);
  undo.trigger(id, projected.overall);
}
```
Footer "I missed this" button calls `handleMarkMissed(contestant.id)`. Render `<MissedToast toast={undo.toast} onUndo={undo.undo} />` once at the top of the main element.

**Test cases:**
- `useMissedUndo.test.ts` — trigger sets toast; timer expiry nulls it; undo calls `onUndo` with the right id and clears toast; second trigger replaces the toast; dismiss clears without `onUndo`; unmount clears timer.
- `MissedToast.test.tsx` — renders the projected overall with `~` prefix; Undo button fires handler; null state renders nothing.

## 5. Edge cases

- **User toggles missed before any votes exist anywhere.** Projected `overall = 5`, per-category all `5`. Toast says "~5".
- **User toggles missed → undo within 500ms (debounce window).** Autosaver `schedule` is called twice for the same contestant before the 500ms timer fires. The first call set `missed:true`, the second `missed:false`. Pending entry's `missed` field is overwritten by the second call. Flush sends `{ missed: false }` once. Net: zero round-trips for the toggle, one for the undo (which itself coalesces to the existing pending entry's missed field). UX-correct.
- **User toggles missed → undo after 500ms.** First flush sends `{ missed: true }`, server saves. Undo schedules a new flush with `{ missed: false }`. Two round-trips. Save chip shows Saving… / Saved twice in quick succession; user expectation matches.
- **User toggles missed → navigates to next contestant before undo.** Toast persists across navigation (it's a `VotingView`-level concern, not a per-contestant concern). The user can still tap Undo to revert the *previous* contestant's missed state.
- **Stale scores under a missed flag.** When a user enters scores then later marks the contestant missed, scores stay in the local map (and the DB row) but `computeProjectedAverage` filters them out via `missedByContestant`. Rescore flips the flag and the original scores reappear. Matches scoring-engine semantics — the engine reads `missed` and ignores scores when `missed === true`.
- **Offline.** All writes go through the existing OfflineAdapter — missed/undo writes queue in `localStorage.emx_offline_queue` and drain on reconnect. No new offline-handling code needed.
- **Two devices, same userId.** Per Q2 we ship local-state only; second device's projection refreshes only on the next room re-fetch. Acceptable for MVP.

## 6. Locale keys (added to `en.json`)

```json
{
  "voting": {
    "missed": {
      "button": "I missed this",
      "cardLabel": "This one's marked as missed",
      "estimated": "Estimated score",
      "perCategoryLabel": "Per category (estimated)",
      "rescoreButton": "Rescore this contestant",
      "toast": {
        "body": "Marked missed — we'll estimate your scores as ~{overall}.",
        "undo": "Undo"
      }
    }
  }
}
```

`locales.test.ts` updated to expect these keys. Other locales remain skip-empty per existing convention.

## 7. Out-of-scope follow-ons

- §8.4 "updated from your recent votes" inline label + animate-score-pop on per-category projected cells when the projection shifts due to user activity. Tracked as Phase U V8.
- Hot-take field (V13/V14, separate Phase 3 item).
- Jump-to drawer (§8.8 / Phase R3, separate item).

## 8. Verification checklist

- `npm run test` — all green, including new tests for `computeProjectedAverage`, `Autosaver` missed-field, `MissedCard`, `seedMissedFromVotes`, `useMissedUndo`, `MissedToast`.
- `npm run type-check` — clean.
- `npm run lint` — clean.
- Manual exercise in `npm run dev`: create a room, start voting, mark a contestant missed, see toast + Undo, verify the missed-state card, score another contestant, see projected card update.
- Reload the page mid-voting after marking missed — state survives via DB seed.
