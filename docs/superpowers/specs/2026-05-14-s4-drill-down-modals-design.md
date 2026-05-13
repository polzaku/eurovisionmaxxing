## S4 §12.6 — Interactive drill-down sheets on `/results/[id]` — design

**Date:** 2026-05-14
**TODO refs:** [TODO.md:393-399](../../../TODO.md#L393) (Phase S4 — drill-downs)
**SPEC refs:** §12.6 (overview), §12.6.1 (contestant), §12.6.2 (participant), §12.6.3 (category), §12.6.4 (implementation notes)
**Branch:** `feat/s4-drill-down-modals` (off `feat/r5-html-export` — depends on the `voteDetails` + `categories` payload extension from PR #117).
**Slice:** Adds three interactive bottom-sheet drill-downs on `/results/[id]` once `rooms.status = 'done'`. Read-only; no schema change, no new endpoint. Country drill-down stage 1 (the inline `<details>` voter-list expansion in `<LeaderboardWithDrillDown>`) stays intact — this slice adds a "Full breakdown" link inside the open details body that opens the rich §12.6.1 sheet. The other two surfaces (§12.6.2 participant via avatar tap, §12.6.3 category via "Full ranking" link in award cards) are new.

## Problem

The post-show conversation has two recurring questions the current `/results/[id]` page doesn't answer:

1. *"Why did Sweden win?"* — the leaderboard shows totals; the existing stage 1 inline drill-down ([LeaderboardWithDrillDown.tsx](../../../src/components/results/LeaderboardWithDrillDown.tsx)) shows points-per-voter but not *how* they voted (per-category breakdown, weighted score, hot-take).
2. *"Who did Anna give her 12 to, and was she stingy with everyone?"* — the existing `<Breakdowns>` section ([page.tsx:326-375](../../../src/app/results/[id]/page.tsx#L326-L375)) lists picks but exposes no aggregates (mean / harshness / room alignment) and no per-category breakdown.

SPEC §12.6 specifies three drill-down surfaces that fill these gaps. The data dependency landed in PR #117 (`voteDetails` + `categories` on the `loadResults` `done` payload); this slice ships the UI.

A third surface (§12.6.3 category drill-down — "What was the room's vocals ranking?") is included for completeness — it leverages the same shell and the same data and lets users ask "did Sweden win on vocals alone?".

## Goals

- Tap a leaderboard row's open-details "Full breakdown" link → opens **contestant sheet** with per-voter rows: avatar + name + per-category chips + weighted score + points pill + inline hot-take. Aggregates pinned at the top: mean, median, highest scorer, lowest scorer.
- Tap a participant avatar in the per-user breakdowns section → opens **participant sheet** with per-contestant rows sorted by that user's weighted score: flag + country + per-category chips + weighted score + points pill + inline hot-take. Aggregates: mean given, harshness vs group, Spearman alignment vs leaderboard.
- Tap "Full ranking" link inside a category-award card → opens **category sheet** with all contestants ranked by their mean score in that one category: flag + country + mean (1 decimal) + spread sparkline (min / median / max) + voter count chip. Aggregates: highest single vote (who), lowest single vote (who), mean of means.
- Only one sheet open at any time (single page-level state machine).
- Read-only and only when `rooms.status = 'done'`.
- Bottom-sheet pattern matches [ScaleAnchorsSheet.tsx](../../../src/components/voting/ScaleAnchorsSheet.tsx) verbatim for dialog mechanics: backdrop click closes, ESC closes, focus moves into the dialog on open and restores on close, `role="dialog"` + `aria-modal="true"` + `aria-labelledby`.

## Non-goals

- **URL state.** No hash-fragment sync; opening a sheet is purely component-local state. Brainstorming Q2 — deep-linkable drill-downs are a clean follow-on if users ask.
- **Stage 1 inline `<details>` replacement.** `<LeaderboardWithDrillDown>` keeps its current behavior — the "Full breakdown" link is *added* inside the open details body, not in place of it. Existing tests stay green; existing keyboard / no-JS accessibility unchanged.
- **In-cinematic-reveal drill-down.** SPEC §12.6 explicitly says drill-downs are suppressed while `rooms.status = 'announcing'`. The cinematic awards reveal (Phase 6.2) also stays unmodified — the tap-targets only exist on the static `/results/[id]` page when the room is done. No follow-on planned.
- **Animation polish.** Re-uses the existing `motion-safe:animate-fade-in` utility. No new keyframes, no FLIP transitions.
- **Schema, API, or realtime changes.** Pure client + page-component composition. Data flow stays exactly as PR #117 left it.
- **L3 translations.** New `results.drillDown.*` keys ship in `en.json`; the other four locales get English-text stubs (keeps `locales.test.ts` parity green; Phase L L3 follow-on slice translates).

## Architecture

One shared dialog shell + three discrete body components + a tiny state reducer + three trigger surfaces wired into the page.

```
src/components/results/drill-down/
  DrillDownSheet.tsx               [shell: backdrop / focus / ESC / X / aria]
  DrillDownSheet.test.tsx
  ContestantDrillDownBody.tsx      [§12.6.1 — per-voter rows + aggregates]
  ContestantDrillDownBody.test.tsx
  ParticipantDrillDownBody.tsx     [§12.6.2 — per-contestant rows + aggregates]
  ParticipantDrillDownBody.test.tsx
  CategoryDrillDownBody.tsx        [§12.6.3 — per-contestant mean + spread sparkline]
  CategoryDrillDownBody.test.tsx
  drillDownState.ts                [pure reducer + open/close helpers]
  drillDownState.test.ts
  buildContestantDrillDown.ts      [pure: derive per-voter rows + aggregates from done payload]
  buildContestantDrillDown.test.ts
  buildParticipantDrillDown.ts     [pure: derive per-contestant rows + aggregates for one user]
  buildParticipantDrillDown.test.ts
  buildCategoryDrillDown.ts        [pure: derive per-contestant mean + spread + aggregates for one category]
  buildCategoryDrillDown.test.ts

src/components/results/
  LeaderboardWithDrillDown.tsx     [modify: add `onOpenFullBreakdown` slot + "Full breakdown" link inside open <details>]
  Breakdowns.tsx                   [extract from page.tsx — was inline; needs avatar render + onOpenParticipant tap target]
  Breakdowns.test.tsx              [new]
  AwardsSection.tsx                [modify: add "Full ranking" link to category-award cards only; pass onOpenCategory slot]

src/app/results/[id]/
  page.tsx                         [modify: extract a new <DrillDownClient> client component wrapping DoneBody and owning sheet state]
  DrillDownClient.tsx              [new client component: owns drillDownState, mounts the three sheets, threads onOpen* callbacks into children]
  DrillDownClient.test.tsx         [new: integration test verifying one sheet open at a time and trigger wiring]

src/locales/{en,es,uk,fr,de}.json  [add results.drillDown.* namespace; en authoritative, four others stub]
tests/e2e/
  results-drill-downs.spec.ts      [Playwright: full E2E on seeded done-with-awards room]
```

### 1. `<DrillDownSheet>` — the shared shell

Owns:
- The fixed-position dialog container (`<div role="dialog" aria-modal="true" aria-labelledby={titleId}>`)
- Backdrop click handler (closes via `onClose`)
- ESC handler installed on `document` while open
- Focus: capture `previouslyFocused` on mount, move focus to the close button, restore on unmount
- `motion-safe:animate-fade-in` on the panel
- A close button (✕) in the top-right of the header strip
- A scrollable `<main>` region for the body content (`max-h-[80vh] overflow-y-auto` on desktop; full-height with safe-area padding on iOS)

Props:
```ts
interface DrillDownSheetProps {
  open: boolean;
  onClose: () => void;
  titleId: string;     // id of the heading element inside `children` for aria-labelledby
  closeAriaLabel: string;
  children: React.ReactNode;
}
```

The body components emit their own `<h2 id={titleId}>` as the first child, so the shell doesn't have to know about variant-specific header content.

### 2. `<ContestantDrillDownBody>` — §12.6.1

Props:
```ts
interface ContestantDrillDownBodyProps {
  contestantId: string;
  data: Extract<ResultsData, { status: "done" }>;
  labels: { /* localized strings — see "Locale keys" below */ };
}
```

Renders:
- `<header>`: flag · country · song · artist · `{totalPoints} pts` (heading uses `titleId`).
- `<dl>` aggregates row (4 stats): mean, median, highest (avatar + value), lowest (avatar + value).
- `<ol>` body rows, one per room member (via `data.members`), sorted by `pointsAwarded` desc for this contestant (using `data.voteDetails` lookup):
  - Avatar (DiceBear `<Avatar>` 32px)
  - Display name
  - Per-category chips: `Vocals 8 · Music 7 · …`, missed entries dimmed with `~` prefix (re-uses chip CSS from §8.2 voting card convention)
  - Weighted score: `8.2`
  - Points-awarded pill (medal-style; 12 highlighted gold)
  - Hot-take inline below the row when non-null, with `(edited)` tag when `hotTakeEditedAt` is non-null

Empty state: when no member voted on this contestant (degenerate — a contestant on the field that the entire room missed), render the SPEC §12.6.1 fallback "No room member rated this contestant." copy.

Data derivation: a pure helper `buildContestantDrillDown(contestantId, data) → { aggregates, rows }` so the rendering is a thin layout layer over computed data. Helper unit-tested independently.

### 3. `<ParticipantDrillDownBody>` — §12.6.2

Props:
```ts
interface ParticipantDrillDownBodyProps {
  userId: string;
  data: Extract<ResultsData, { status: "done" }>;
  labels: { /* … */ };
}
```

Renders:
- `<header>`: avatar (48px) · display name · `Σ points_awarded` (fixed across users per §9.3 but rendered for symmetry) · hot-take count.
- `<dl>` aggregates row: mean given (1 decimal), harshness vs group (signed delta — `+0.4` means harsher than room average; sign + colour-coded), Spearman alignment vs leaderboard (1 decimal, in the same `[-1, 1]` range the awards engine already uses).
- `<ol>` body rows, one per contestant this user voted on (via `voteDetails.filter(v => v.userId === userId)`), sorted by user's weighted score desc:
  - Flag · country · song
  - Per-category chips
  - Weighted score
  - Points-awarded pill
  - Inline hot-take with `(edited)` tag when applicable

Data derivation: `buildParticipantDrillDown(userId, data) → { aggregates, rows }`. The Spearman/harshness math reuses primitives from `src/lib/scoring.ts` — no new math. Unit-tested.

### 4. `<CategoryDrillDownBody>` — §12.6.3

Props:
```ts
interface CategoryDrillDownBodyProps {
  categoryKey: string; // matches one of data.categories[*].key (falls back to name when key absent)
  data: Extract<ResultsData, { status: "done" }>;
  labels: { /* … */ };
}
```

Renders:
- `<header>`: `Best {categoryName}` + winner flag/country/song from the corresponding category award row.
- `<dl>` aggregates row: highest single vote (who gave it), lowest single vote (who), mean of means (1 decimal).
- `<ol>` body rows, one per contestant in `data.contestants`, sorted by mean score (across non-missed votes) for this category desc:
  - Flag · country · song
  - Mean (1 decimal) as the primary number
  - Spread sparkline: inline horizontal bar normalised 1–10 with three ticks at min / median / max positions (HTML/CSS only — `<div class="sparkline">` with three positioned children). `role="img"` with `aria-label="Min 4, median 7, max 9 out of 10"` so the bar is screen-reader-meaningful.
  - Voter count chip: `N/M voted` (accounting for missed entries).

Spec acknowledges this view as "single-axis" vs the per-user view of §12.6.1 — same scaffold, simpler body.

### 5. `drillDownState.ts` — page-level reducer

```ts
export type DrillDownOpen =
  | { kind: "contestant"; contestantId: string }
  | { kind: "participant"; userId: string }
  | { kind: "category"; categoryKey: string };

export type DrillDownState = DrillDownOpen | null;

export type DrillDownAction =
  | { type: "open"; payload: DrillDownOpen }
  | { type: "close" };

export function drillDownReducer(
  state: DrillDownState,
  action: DrillDownAction,
): DrillDownState {
  switch (action.type) {
    case "open":
      return action.payload;
    case "close":
      return null;
  }
}
```

Tests: opening any kind from `null` returns the payload; opening a new kind while another is open replaces (only one open at a time); close returns null; close from null is a no-op.

### 6. `<DrillDownClient>` — page-level client component

The `/results/[id]` page is a Server Component. We need page-local state, so we extract a client wrapper. `<DrillDownClient>` receives the loaded `done` payload + roomId + labels as props, renders the existing leaderboard + awards + breakdowns + hot-takes sections, owns the `drillDownState`, and passes `onOpen*` callbacks down to the trigger surfaces.

```tsx
"use client";
import { useReducer } from "react";
import { drillDownReducer, type DrillDownState } from "@/components/results/drill-down/drillDownState";

export default function DrillDownClient({ data, roomId, labels }: Props) {
  const [state, dispatch] = useReducer(drillDownReducer, null as DrillDownState);
  return (
    <>
      <LeaderboardWithDrillDown
        ...
        onOpenFullBreakdown={(contestantId) =>
          dispatch({ type: "open", payload: { kind: "contestant", contestantId } })
        }
      />
      <AwardsSection
        ...
        onOpenCategoryRanking={(categoryKey) =>
          dispatch({ type: "open", payload: { kind: "category", categoryKey } })
        }
      />
      <Breakdowns
        ...
        onOpenParticipant={(userId) =>
          dispatch({ type: "open", payload: { kind: "participant", userId } })
        }
      />
      {state?.kind === "contestant" && (
        <DrillDownSheet open onClose={() => dispatch({ type: "close" })} titleId="drill-contestant" closeAriaLabel={labels.closeAria}>
          <ContestantDrillDownBody contestantId={state.contestantId} data={data} labels={labels.contestant} />
        </DrillDownSheet>
      )}
      {state?.kind === "participant" && ( /* same pattern */ )}
      {state?.kind === "category" && ( /* same pattern */ )}
    </>
  );
}
```

The existing `<DoneBody>` server component in [page.tsx:198-281](../../../src/app/results/[id]/page.tsx#L198-L281) becomes a thin orchestrator: it loads data, computes labels via `getTranslations`, and renders `<DrillDownClient>` with those props. All sections that previously lived inside `<DoneBody>` move into `<DrillDownClient>` (existing markup unchanged — just hoisted into a client boundary).

### 7. Trigger surfaces

**Leaderboard ("Full breakdown" link).** `<LeaderboardWithDrillDown>` gains an optional `onOpenFullBreakdown?: (contestantId: string) => void` prop. When set, the open-details body renders a button at the bottom of the voter list: `<button onClick={() => onOpenFullBreakdown(contestantId)} className="text-sm font-medium text-primary underline">{labels.openFullBreakdown}</button>`. When the prop is undefined (e.g. HTML export — which doesn't import this component anyway — or any future SSR-only consumer), the button is suppressed. Existing tests stay green because the prop is additive.

**Breakdowns avatar.** The existing inline `<Breakdowns>` markup ([page.tsx:326-375](../../../src/app/results/[id]/page.tsx#L326-L375)) is extracted into `src/components/results/Breakdowns.tsx` (no behaviour change — just lifted from a private inline function to a typed component). The component gains:
- Avatar rendering: `<Avatar seed={b.avatarSeed} size={32} />` inside each `<summary>` left-of the display name.
- The avatar is wrapped in `<button type="button" onClick={(e) => { e.stopPropagation(); onOpenParticipant(b.userId); }} aria-label={labels.openParticipantAria(b.displayName)}>`. The button itself has a focus ring; tapping the rest of the summary still toggles the `<details>`.

This keeps the "tap to peek at picks list" interaction *and* introduces a separate "tap avatar for the full breakdown" interaction — two adjacent, complementary affordances.

**Category-award card "Full ranking" link.** `<AwardsSection>` gains an optional `onOpenCategoryRanking?: (categoryKey: string) => void`. When set, each *category-award* card (i.e. award rows with `winnerContestantId` non-null, distinguishing them from personality awards) renders an extra `<button>` below the existing `<AwardExplainer>` accordion: "Full ranking →". Personality-award cards (e.g. Harshest Critic, Neighbourhood Voters) do not render the link — the per-user view for those lives in `<ParticipantDrillDownBody>` triggered from the breakdowns section.

The button click does **not** toggle the `<AwardExplainer>` `<details>` because they're sibling DOM elements. No conflict.

### 8. Locale keys

New namespace `results.drillDown.*` in `en.json`:

```json
"drillDown": {
  "common": {
    "closeAria": "Close drill-down",
    "missed": "Missed",
    "edited": "(edited)",
    "weightedScore": "Weighted {value}",
    "mean": "Mean",
    "median": "Median",
    "highest": "Highest",
    "lowest": "Lowest"
  },
  "contestant": {
    "openLink": "Full breakdown →",
    "title": "{country} — {points} pts",
    "empty": "No room member rated this contestant.",
    "voterRow": "{name}",
    "hotTakeLabel": "Hot take from {name}"
  },
  "participant": {
    "openAria": "Open {name}'s full vote",
    "title": "{name}'s vote",
    "totalAwarded": "{points} pts given",
    "hotTakeCount": "{count, plural, one {# hot take} other {# hot takes}}",
    "harshness": "Harshness {value}",
    "harshnessHelp": "Compared to the room average. Negative is harsher.",
    "alignment": "Alignment {value}",
    "alignmentHelp": "Spearman correlation with the room leaderboard."
  },
  "category": {
    "openLink": "Full ranking →",
    "title": "Best {category} — full ranking",
    "meanLabel": "Mean {value}",
    "voterCount": "{voted}/{total} voted",
    "sparklineAria": "Min {min}, median {median}, max {max} out of 10",
    "highestSingle": "Highest: {value} from {name}",
    "lowestSingle": "Lowest: {value} from {name}",
    "meanOfMeans": "Room mean: {value}"
  }
}
```

en authoritative; the same JSON copied as stubs into `es/uk/fr/de` so `locales.test.ts` stays green. L3 translation is a Phase L follow-on.

### 9. Testing

**RTL — `DrillDownSheet.test.tsx` (dialog mechanics, ~8 cases):**
- Renders nothing when `open={false}`.
- Renders dialog with `role="dialog"`, `aria-modal="true"`, `aria-labelledby={titleId}` when `open={true}`.
- ESC key calls `onClose`.
- Backdrop click calls `onClose`; clicks on the panel itself do not.
- X-button click calls `onClose`.
- Focus moves to the close button on open.
- Focus restores to the previously-focused element on close.
- `motion-safe:animate-fade-in` class present on the panel.

**RTL — `ContestantDrillDownBody.test.tsx` (~7 cases):**
- Header renders contestant flag · country · song · artist · totalPoints.
- Aggregates row renders mean / median / highest (avatar + value) / lowest (avatar + value).
- Body rows sorted by points awarded desc.
- Missed entry renders `chip--missed` class + `~` prefix.
- Hot-take rendered inline with `(edited)` tag when `hotTakeEditedAt` non-null.
- Empty state copy when no member voted (degenerate edge — a never-voted contestant in the field).
- Joint highest scorer (two voters tied at the top) — both avatars rendered.

**RTL — `ParticipantDrillDownBody.test.tsx` (~7 cases):**
- Header renders avatar · name · total given · hot-take count.
- Aggregates render mean / harshness (sign + colour) / Spearman alignment.
- Body rows sorted by user's weighted score desc.
- Missed entries dimmed.
- Hot-takes rendered with edited tag.
- Empty state when user voted on zero contestants (degenerate).
- User with all-missed votes — harshness rendered as N/A.

**RTL — `CategoryDrillDownBody.test.tsx` (~6 cases):**
- Header renders `Best {category}` + winner contestant.
- Aggregates render highest single / lowest single / mean of means.
- Body rows sorted by category mean desc.
- Spread sparkline has correct `aria-label` (min / median / max values out of 10).
- Voter count chip shows `N/M voted` accounting for missed entries.
- Empty category (no votes recorded — degenerate) renders fallback copy.

**RTL — `Breakdowns.test.tsx` (~5 cases):** [extracted component, mostly regression]
- Renders inline `<details>` per user with display name + picks count (unchanged).
- Renders avatar inside each summary.
- Avatar is a `<button>` with correct `aria-label`.
- Avatar click calls `onOpenParticipant(userId)` and does *not* toggle the `<details>`.
- Summary text click toggles the `<details>` (unchanged stage-1 behaviour).

**Unit — `drillDownState.test.ts` (~5 cases):**
- Initial state is `null`.
- Open `contestant` from `null` returns the contestant state.
- Open `participant` while contestant is open replaces (only one open at a time).
- Close from any open state returns `null`.
- Close from `null` is a no-op (returns `null` unchanged).

**Unit — `buildContestantDrillDown.test.ts` / `buildParticipantDrillDown.test.ts` / `buildCategoryDrillDown.test.ts` (~6 cases each):**
- Pure computation: aggregates correct on a fixture room (mean, median, highest, lowest match hand-computed expectations).
- Sort orders correct.
- Missed votes excluded from aggregates correctly.
- Harshness sign correct (negative when above-average).
- Spearman matches the existing scoring lib output on a tied fixture.
- Spread (min / median / max) correct for an odd-count and even-count case.

**RTL — `DrillDownClient.test.tsx` (page-level integration, ~6 cases):**
- Renders all five existing sections (copy summary, leaderboard, awards, breakdowns, hot-takes).
- Clicking "Full breakdown" link in leaderboard opens contestant sheet with correct contestantId.
- Clicking avatar in breakdowns opens participant sheet with correct userId.
- Clicking "Full ranking" in category award opens category sheet with correct categoryKey.
- Only one sheet open at a time (opening B while A is open replaces A).
- Closing any sheet returns to no-sheet-open state.

**Playwright — `tests/e2e/results-drill-downs.spec.ts`:**
Seed a `done-with-awards` room via `npm run seed:room -- done-with-awards`. New spec covers:
- Navigate to `/results/{roomId}`, verify all sections render.
- Open contestant sheet via leaderboard "Full breakdown" → verify header + aggregates + at least one body row → close via X → verify sheet removed.
- Open participant sheet via avatar tap → verify header + aggregates → close via ESC → verify sheet removed.
- Open category sheet via "Full ranking" → verify header + spread sparkline visible → close via backdrop click.
- Opening a second sheet while one is open: replaces (only one visible at a time).
- Reduced-motion run via `await page.emulateMedia({ reducedMotion: 'reduce' })` — verify sheets still open and close (just no fade animation).
- Keyboard navigation: Tab to "Full breakdown" → Enter → sheet opens with focus on close button → Tab cycles inside the sheet → ESC closes → focus returns to the trigger button.

## Data flow

```
loadResults (done) → page.tsx (server) → DrillDownClient (client)
                                         │
                                         ├─ useReducer(drillDownReducer, null)
                                         │
                                         ├── <LeaderboardWithDrillDown onOpenFullBreakdown={…} />
                                         │   └── inside open <details>: <button onClick> → dispatch({type:"open", payload:{kind:"contestant",contestantId}})
                                         │
                                         ├── <AwardsSection onOpenCategoryRanking={…} />
                                         │   └── inside category-award card: <button> → dispatch({type:"open", payload:{kind:"category",categoryKey}})
                                         │
                                         ├── <Breakdowns onOpenParticipant={…} />
                                         │   └── avatar <button stopPropagation onClick> → dispatch({type:"open", payload:{kind:"participant",userId}})
                                         │
                                         └── state !== null && <DrillDownSheet>
                                              ├── kind="contestant" → <ContestantDrillDownBody contestantId={…} data={…} />
                                              ├── kind="participant" → <ParticipantDrillDownBody userId={…} data={…} />
                                              └── kind="category" → <CategoryDrillDownBody categoryKey={…} data={…} />
```

## Risks

- **Page.tsx server-to-client boundary refactor.** Hoisting `DoneBody`'s sections into a client component changes Server Component / Client Component split. Verify the page still renders awards / hot-takes correctly under SSR (no hydration mismatches, no client-only data leaks). The existing `<HotTakesSection>` is already a Client Component, so the boundary already crosses there — `DrillDownClient` becomes the wrapper that owns the full done body. Mitigation: page integration tests + Playwright smoke verify rendering.

- **Breakdowns extraction.** The inline `<Breakdowns>` function in [page.tsx:326-375](../../../src/app/results/[id]/page.tsx#L326-L375) becomes a typed component file. Pure mechanical refactor — same JSX. Risk is low but verify the existing `done`-branch render output is byte-equivalent (no markup churn) via the existing page-render expectations.

- **Avatar tap target conflict with `<details>` toggle.** The avatar `<button>` is *inside* the `<summary>` element. Without `e.stopPropagation()` on the avatar click handler, the browser would also toggle the `<details>`. Mitigation: explicit stopPropagation + an RTL test that asserts the click does *not* toggle.

- **Award-card "Full ranking" gating to category awards.** Personality awards (`harshest_critic`, `neighbourhood_voters`, etc.) have `winnerContestantId === null` and `winnerUserId !== null`. Only category awards (`best_vocals` and similar) have `winnerContestantId !== null`. The check `award.winnerContestantId !== null` is the discriminator. Mitigation: RTL test renders both award types and asserts the link appears only on the category card.

- **Spearman / harshness math reuse.** The participant sheet's aggregates should match the values the existing awards engine computes for `hive_mind_master` (Spearman) and `harshest_critic` (harshness). Drift here would confuse users ("the award says Alice is harshest but the drill-down disagrees"). Mitigation: `buildParticipantDrillDown` imports from `src/lib/scoring.ts` directly; unit test pins the output against a fixture room where the awards' computed values are known.

- **Locale `results.drillDown.harshness` sign.** Harshness is currently displayed in awards as a positive number (the magnitude of the gap). The participant drill-down spec uses signed delta (`+0.4` = harsher). This is a deliberate divergence — the *award* names the harshest critic; the *drill-down* explains where every user sits. Mitigation: include the sign in the displayed value with `+` prefix for above-average users; document this divergence in the en.json copy ("Compared to the room average. Negative is harsher.").

## Rollout

Single PR after #117 (HTML export) merges. No schema migration, no env-var changes, no feature flag. Safe to merge any time.

Follow-on slices (not in scope):

1. **Hash-fragment URL state** for deep-linkable drill-downs — only if usage proves users want to share specific views.
2. **Cinematic awards drill-down** — extend the same sheets to be openable from the Phase 6.2 awards reveal screen once an award has been revealed (currently they're suppressed during `announcing`).
3. **L3 translation pass** of `results.drillDown.*` across `es/uk/fr/de` — same workflow as every prior namespace.
4. **`<details>` keyboard refinement** — the leaderboard "Full breakdown" link inside an open `<details>` is keyboard-accessible by default but a Tab order audit would polish the flow.

## Open questions

None blocking.
