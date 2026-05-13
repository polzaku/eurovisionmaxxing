# Pre-existing Playwright + lint rot — fixes design

**Date:** 2026-05-13
**Source:** Surfaced during PR #114's pre-push verification (full Playwright suite + lint).
**Slice:** Cleanup of pre-existing rot on `main`. Two independent fixes that ship as **two separate PRs** so the product-code change reviews independently of the mechanical lint cleanup.

## Problem

Running the full Playwright suite + lint locally against `origin/main` surfaces:

1. **`announce-short-style-chooser.spec.ts:70` fails** — `getByRole('button', { name: /^Live$/ })` returns no element. The locator was authored when `<AnnouncementModeCard>` rendered a single "Live" string in the button. Post-i18n migration, the card now also renders the tagline (`announcementMode.live.tagline`) inside the same `<button>`, so the button's accessible name is now `"Live\nTake turns announcing your points, Eurovision-style."`. The strict regex `/^Live$/` rejects this.

2. **`awards-ceremony.spec.ts:18` fails** — `getByText("Best Vocals")` times out. Underlying cause is a real race condition in `<DoneCeremony>` ([src/components/room/DoneCeremony.tsx](../../../src/components/room/DoneCeremony.tsx)):
   - On mount, `useEffect` kicks off `fetch('/api/results/{id}')` (async).
   - In parallel, `<LeaderboardCeremony>` mounts and starts its cinematic.
   - When `<LeaderboardCeremony>` calls `onAfterSettle()`, the callback reads `sequence` from its closure: `setPhase(sequence.length === 0 ? "ctas" : "awards")`.
   - If `data` is still `null` when the callback fires, `sequence === []` and the phase fast-forwards to `"ctas"` — skipping awards entirely.
   - The Playwright test triggers this by setting `sessionStorage[emx_revealed_{roomId}]` (which makes `<LeaderboardCeremony>` skip its cinematic and fire `onAfterSettle()` synchronously before the fetch returns).
   - Same race documents the skip in [`tests/e2e/your-neighbour-award.spec.ts`](../../../tests/e2e/your-neighbour-award.spec.ts:27-40) — 4 cases skipped pending the fix landed here.

3. **Lint: 4 warnings on `main`**:
   - `src/app/create/page.tsx:149` — `useEffect` missing `'t'` dependency.
   - `src/components/room/AnnouncingView.tsx:386` — `useCallback` missing `'t'` dependency.
   - `src/hooks/useRoomPresence.ts:61` — `supabase.current` may have changed by cleanup time.
   - `src/hooks/useRoomRealtime.ts:30` — same ref-cleanup-timing pattern.

CI runs vitest + type-check + lint but **not Playwright** ([`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml)) — so the 2 Playwright failures and the 4 lint warnings rotted silently until full local runs uncovered them.

## Goals

- Awards-ceremony Playwright test passes reliably. The underlying race condition stops leaking awards-skip into production.
- Short-style chooser Playwright test passes with a locator robust to the multiline button accessible name.
- Lint reports 0 warnings on the touched files (no behavioural regression).
- After-ship-floor moment: full Playwright suite green from a cold dev server.

## Non-goals

- Adding Playwright to CI. Separate slice (own design space — needs Supabase env handling, time budgets, retry policy).
- Fixing other potential races in the awards / leaderboard flow. The fix is targeted at the single observable race in `<DoneCeremony>`'s phase transition.
- Refactoring `<LeaderboardCeremony>`'s data flow. The change stays inside `<DoneCeremony>`.
- Touching `your-neighbour-award.spec.ts`'s skip block in this slice. Once the race fix lands, that block can be unskipped in a follow-up (probably the same PR or the next), but the unskip is mechanical and out of this slice's scope.

## Two-PR split

PR boundaries are drawn around **risk and review cadence**:

| PR | Scope | Risk | Files | Reviewer focus |
|---|---|---|---|---|
| **PR 1** — `fix/playwright-pre-existing-failures` | DoneCeremony race + chooser test locator | Product-code change to cinematic awards reveal | `DoneCeremony.tsx`, `DoneCeremony.test.tsx`, `announce-short-style-chooser.spec.ts` | The two-signal coordination logic + RTL coverage of the deferred-transition path |
| **PR 2** — `chore/lint-rot-fixes` | 4 lint warnings (deps + ref cleanup) | Near-zero — type-check enforces no behavioural change | `page.tsx`, `AnnouncingView.tsx`, `useRoomPresence.ts`, `useRoomRealtime.ts` | "no surprise diff" review |

Both branch from latest `origin/main` independently. PR 1 lands first; PR 2 follows.

## Architecture — PR 1 (race + chooser)

### Race fix in `<DoneCeremony>`

Replace the single inline `onAfterSettle` with a **two-signal coordination**:

```tsx
// New state — one-way flag flipped by <LeaderboardCeremony>'s onAfterSettle
const [settled, setSettled] = useState(false);

// useEffect waits for BOTH `settled` and `data` before deciding the
// next phase. Once data lands, sequence is recomputed via the existing
// useMemo (no change there); we read its current value safely here.
useEffect(() => {
  if (!settled) return;
  if (phase !== "leaderboard") return;
  if (!data) return; // still fetching — defer
  setPhase(sequence.length === 0 ? "ctas" : "awards");
}, [settled, data, sequence, phase]);
```

The `<LeaderboardCeremony>` callback becomes a trivial setter:

```tsx
<LeaderboardCeremony
  roomId={roomId}
  onAfterSettle={() => setSettled(true)}
/>
```

`sequence` continues to be derived via `useMemo` from `data + categories + viewerUserId`. The `useEffect` re-runs whenever any of (settled, data, sequence, phase) changes, so:

- If data lands BEFORE LeaderboardCeremony settles → `settled` flip drives the transition with sequence populated.
- If data lands AFTER LeaderboardCeremony settles → the data state-update triggers a re-render, the new `sequence` propagates, the `useEffect` runs again, and we transition correctly.
- If data never lands (network failure) → user is stuck on a "settled but no awards" leaderboard view. This matches the existing failure mode (`data` was previously also a hard precondition); the fix doesn't worsen it.

### Chooser test locator fix

Single-line edit in `tests/e2e/announce-short-style-chooser.spec.ts`:

```ts
// Old:
await expect(page.getByRole("button", { name: /^Live$/ })).toBeVisible({ ... });
await page.getByRole("button", { name: /^Live$/ }).click();

// New:
const liveCard = page.getByRole("button", { name: /^Live\b/ });
await expect(liveCard).toBeVisible({ timeout: 10_000 });
await liveCard.click();
```

`/^Live\b/` matches an accessible name **starting with** "Live" followed by a word boundary — accepts both `"Live"` and `"Live\nTake turns…"`. Doesn't match `"Reveal 12 points"` or `"Instant"`. Doesn't match `"Live updates"` (would, but no such button exists).

Alternative considered: `getByText("Live", { exact: true })` scoped to the card. Rejected — multiple `<p>` tags share the card's container, and "Live" exact-match would still need the button-role parent to be clickable; the role-based locator is more direct.

## Architecture — PR 2 (lint)

Four surgical edits. No behavioural change.

### Fix 1: `src/app/create/page.tsx:149`

The `useEffect` calls `t("create.eventSelection.error")` inside the contestants-fetch error branch. ESLint flags `t` as missing. `t` from `useTranslations()` is referentially stable across renders per next-intl's contract, so adding it to deps is a no-op behaviourally. Add `t` to the dependency array.

### Fix 2: `src/components/room/AnnouncingView.tsx:386`

The `handleReshuffle` `useCallback` calls `t("announcing.roster.reshuffleErrorInProgress")` and `t("announcing.roster.reshuffleErrorGeneric")`. Same fix: add `t` to the dependency array.

### Fix 3: `src/hooks/useRoomPresence.ts:61`

The cleanup function uses `supabase.current.removeChannel(channel)`. ESLint flags `supabase.current` as a moving target across the effect's lifetime. Copy the ref to a local variable at effect-entry:

```ts
useEffect(() => {
  const client = supabase.current;
  // ... existing setup using `client` instead of `supabase.current` ...
  return () => {
    void client.removeChannel(channel);
  };
}, [roomId, userId]);
```

### Fix 4: `src/hooks/useRoomRealtime.ts:30`

Same pattern. Copy `supabase.current` to a local `client` at effect-entry; use `client` in setup and cleanup.

## Testing

### PR 1

**RTL** (`DoneCeremony.test.tsx`): add two cases that pin the two-signal coordination:

1. `"defers phase transition when LeaderboardCeremony settles before data arrives"` — mock the fetch to delay; trigger `onAfterSettle` first; assert phase stays `"leaderboard"`; resolve the fetch; assert phase advances to `"awards"` (or `"ctas"` for empty sequence).
2. `"transitions immediately when data arrives before LeaderboardCeremony settles"` — mock the fetch to resolve fast; trigger `onAfterSettle` after data; assert phase advances correctly.

**Playwright**: the existing `awards-ceremony.spec.ts` case starts passing. The 4 skipped `your-neighbour-award.spec.ts` cases also start passing — leave the `test.describe.skip(...)` removal as a follow-up PR (out of this slice's scope; the skip block annotates the race, and removing it is mechanical).

**Chooser locator**: `announce-short-style-chooser.spec.ts` case starts passing. No new tests needed.

### PR 2

**Vitest + lint**: existing suite continues to pass. Lint reports 0 warnings on the touched files.

**RTL**: no new cases — the `t`-deps changes are referentially stable; the ref-cleanup changes don't affect observable behaviour.

## Verification — both PRs

Before push:
1. `npm test` — full vitest, all PASS.
2. `npm run dev -- --port 3457` background; wait for `/api/health` 200.
3. `npx playwright test` — full Playwright. PR 1 must take **awards-ceremony** + **chooser** from RED to GREEN; PR 2 must leave the suite green (no regression).
4. `npm run type-check && npm run lint` — both PRs must report 0 NEW warnings; PR 2's main goal is bringing the touched files to 0 warnings.

## Files touched

### PR 1
- `src/components/room/DoneCeremony.tsx` — modify (race fix)
- `src/components/room/DoneCeremony.test.tsx` — extend with 2 new cases
- `tests/e2e/announce-short-style-chooser.spec.ts` — 1-line locator fix

### PR 2
- `src/app/create/page.tsx` — add `t` to useEffect deps (line 149)
- `src/components/room/AnnouncingView.tsx` — add `t` to useCallback deps (line 386)
- `src/hooks/useRoomPresence.ts` — copy `supabase.current` to local in effect
- `src/hooks/useRoomRealtime.ts` — same pattern

## Rollback notes

Both PRs are independent. PR 2 is trivially revertible (mechanical lint fixes). PR 1's race fix introduces a `settled` state but the data flow is otherwise unchanged — if a regression surfaces, revert is single-commit. The two-signal coordination preserves the previous happy-path behaviour byte-for-byte (when data lands fast).
