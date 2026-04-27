---
title: End-of-voting affordance (last-contestant signal)
date: 2026-04-26
spec_anchor: SPEC §8.11
phase: Phase U (UX review follow-ups)
status: design
---

# End-of-voting affordance — implementation design

Maps SPEC §8.11 onto concrete files, props, and tests. SPEC §8.11 is the source of truth for behaviour and copy; this doc only captures the implementation shape.

## Problem

When a guest reaches the last contestant in the running order, the voting screen "just runs out" — no signal that they're done, no list of unresolved gaps, no indication of what happens next. Smoke-tested 2026-04-26: users on the last card don't know whether to wait, rescore something they marked missed, or backtrack to find something they skipped.

## Scope

In:
- Pure helper that classifies the user's vote state into one of three end-of-voting variants.
- Presentational component that renders each variant (per SPEC §8.11 copy).
- Wire-in to `VotingView`: render only when the user is on the last contestant card.
- Quick-jump callbacks reusing existing `setIdx` pathway.
- Five new English locale keys under `voting.endOfVoting.*`.

Out:
- The §8.10 calibration drawer or `lock-scores` flow (different concern; admin-facing data signal vs. user-facing UI signal).
- Server broadcasts. The affordance is purely client-side per SPEC §8.11.
- Non-English translations (Phase L L3 gate).
- The "End voting" admin pill itself (R4 work).

## Architecture

Two new units, one wire-in:

### 1. Pure helper — `src/lib/voting/endOfVotingState.ts`

Discriminated union output:

```ts
export type EndOfVotingState =
  | { kind: 'allScored'; total: number }
  | { kind: 'missedSome'; missed: Contestant[] }
  | { kind: 'unscored'; unscored: Contestant[] };

export function endOfVotingState(input: {
  contestants: readonly Contestant[];           // already running-order sorted
  categoryNames: readonly string[];             // configured room categories
  scoresByContestant: Record<string, Record<string, number | null> | undefined>;
  missedByContestant: Record<string, boolean>;
}): EndOfVotingState;
```

**Classification rules** (precedence: `unscored` > `missedSome` > `allScored`):

A contestant is *fully scored* iff `scoredCount(scores, categoryNames) === categoryNames.length`. The existing `scoredCount` helper in `src/components/voting/scoredCount.ts` is the canonical definition (treats `null` as not-scored, matching how the rest of the voting UI behaves).

For each contestant, classify:
- **scored** — fully scored AND not in `missedByContestant`.
- **missed** — in `missedByContestant` (regardless of how many scores it has — once flagged missed, the user has explicitly resolved it).
- **unscored** — neither of the above.

Result:
- If `unscored.length > 0` → `{ kind: 'unscored', unscored }` (lists every unscored contestant in running order).
- Else if `missed.length > 0` → `{ kind: 'missedSome', missed }`.
- Else → `{ kind: 'allScored', total: contestants.length }`.

**Edge cases:**
- Empty `contestants` array → `{ kind: 'allScored', total: 0 }`. (Caller already short-circuits on empty contestants — VotingView renders an error state earlier — but the helper is defined for safety.)
- Empty `categoryNames` → every contestant is *trivially fully scored* (the loop in `scoredCount` runs zero iterations). This degenerate case is handled by the helper without special-casing; the VotingView upstream renders an error state when `categories.length === 0`, so this branch is never reached in practice.
- A contestant marked `missed=true` whose scores object also has all categories filled is classified `missed` — that matches the §9.1 fill convention where `missed=true` is sticky even after auto-fill.

### 2. Component — `src/components/voting/EndOfVotingCard.tsx`

Thin presentational component. Props:

```ts
interface EndOfVotingCardProps {
  state: EndOfVotingState;
  adminDisplayName?: string;          // shown in 'allScored' copy
  onJumpTo: (contestantId: string) => void;
}
```

Renders per SPEC §8.11:

| State | Copy (en) | Decoration |
|---|---|---|
| `allScored` | *"✅ All {count} scored — waiting for {admin} to end voting."* | Green-tinted card. No CTA. |
| `missedSome` | *"⚠️ You marked {count} as missed — they'll be filled with your average. Tap to rescore any."* | List rows: flag + country + **Rescore** button calling `onJumpTo(id)` |
| `unscored` | *"⚠️ {count} still unscored"* + list of `[country]` chips | List rows: flag + country + **Score now** button calling `onJumpTo(id)` |

`adminDisplayName` is optional: when missing, fall back to the admin label without the name (*"…waiting for the host to end voting."*) using the existing `voting.endOfVoting.allScoredFallback` key. (Adding one extra key beyond the five in SPEC §8.11 to avoid an empty `{name}` slot when membership data is racing.)

### 3. Wire-in — `src/components/voting/VotingView.tsx`

Add one optional prop:
```ts
adminDisplayName?: string;
```

Render `<EndOfVotingCard>` between the hot-take field and the nav footer, gated on `idx === sortedContestants.length - 1`. Quick-jump callback: existing `setIdx` lookup by id (same pattern as `JumpToDrawer.onSelect`).

`<EndOfVotingCard>` renders below the contestant card on the last position only — per SPEC §8.11. The "replacing the prev-button slot in the footer" alternative in SPEC §8.11 is not pursued in this slice; the inline card is sufficient and avoids reflowing the four-button nav grid that just landed in PR #35.

### 4. Wire-in — `src/app/room/[id]/page.tsx`

Derive `adminDisplayName` from `phase.memberships`:
```ts
const adminDisplayName = phase.memberships.find(
  (m) => m.userId === phase.room.ownerUserId
)?.displayName;
```
Pass into `<VotingView>`. Falls back to `undefined` if owner is not in the membership list (race during initial fetch — handled by the fallback key).

### 5. Locale keys — `src/locales/en.json`

Adds `voting.endOfVoting`:
```json
{
  "voting": {
    "endOfVoting": {
      "allScored": "✅ All {count} scored — waiting for {admin} to end voting.",
      "allScoredFallback": "✅ All {count} scored — waiting for the host to end voting.",
      "missedSome": "⚠️ You marked {count} as missed — they'll be filled with your average. Tap to rescore any.",
      "unscoredCount": "⚠️ {count} still unscored",
      "rescoreCta": "Rescore",
      "jumpToCta": "Score now"
    }
  }
}
```

## Test plan (TDD order)

1. **`src/lib/voting/endOfVotingState.test.ts`** — table-driven; cover:
   - All scored, no missed → `allScored`
   - All scored except one missed (with scores filled) → `missedSome`
   - All scored except one missed (no scores) → `missedSome`
   - One unscored → `unscored`
   - One unscored + one missed → `unscored` (precedence)
   - Empty contestants → `allScored` with `total: 0`
   - Partial scores (one category null) → counted as unscored
   - Output `unscored`/`missed` lists preserve `runningOrder`-sorted order
2. **`src/components/voting/EndOfVotingCard.test.tsx`** — react-testing-library:
   - Renders all-scored copy with admin name interpolated
   - Renders fallback copy when adminDisplayName undefined
   - Renders missed-some list with one Rescore button per missed contestant; click fires `onJumpTo(id)`
   - Renders unscored list with one Score-now button per unscored contestant; click fires `onJumpTo(id)`
3. **`src/components/voting/VotingView.test.tsx`** (extend existing or add):
   - Card not rendered when `idx < total - 1`
   - Card rendered when `idx === total - 1`
   - Card receives correct state for given scores/missed shape
   - Clicking jump CTA navigates to that contestant (idx changes)
4. **`src/locales/locales.test.ts`** — already enforces key-completeness; passes once new keys are added to `en.json`. (Non-`en` locales follow §21 skip-empty rule.)

## Files touched

New:
- `src/lib/voting/endOfVotingState.ts`
- `src/lib/voting/endOfVotingState.test.ts`
- `src/components/voting/EndOfVotingCard.tsx`
- `src/components/voting/EndOfVotingCard.test.tsx`

Modified:
- `src/components/voting/VotingView.tsx` — render gated card; add `adminDisplayName` prop
- `src/app/room/[id]/page.tsx` — derive + pass `adminDisplayName`
- `src/locales/en.json` — add `voting.endOfVoting.*` keys

Possibly extended:
- Existing VotingView test file (if it tests render output structurally)

## Verification

- `npm run type-check` clean
- `npm test` green
- `npm run dev` smoke: lobby → start voting → swipe to last contestant → see all three states by toggling missed / clearing scores. Confirm Rescore / Score-now navigate correctly. Confirm no card on non-last contestants.

## Out-of-scope follow-ups

- **R3 §8.8** per-contestant `N/M scored` chip on each row (needs `voting_progress` broadcast aggregation) — referenced from the unscored-list rows in SPEC §8.11 but its implementation is its own slice.
- Footer `prev-button` swap variant from SPEC §8.11 — deferred (the inline card is the primary surface).
