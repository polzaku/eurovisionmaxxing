# L1 announcer-phone vs guest-phone differentiation — design

**Date:** 2026-05-12
**TODO refs:** [TODO.md:94](../../../TODO.md#L94) (Phase 5 — `/present` `[~]` partial), [TODO.md:162](../../../TODO.md#L162) (Phase U L1 — three-surface reveal matrix)
**SPEC ref:** §10.2 (Live announcement — three-surface reveal matrix), §10.2.0 (Implementation status), §10.2.2 (Short reveal style)
**Slice:** Closes the L1 three-surface matrix. TV column already shipped on `feat/l1-present-route-foundation` (PresentScreen with FLIP rank-shift, position label, Up-next card, fullscreen prompt, force-dark). This slice differentiates the remaining two columns — announcer's phone vs guest's phone — so they stop rendering the same surface.

## Problem

`<AnnouncingView>` currently renders the same heavyweight surface for everyone in `announcing` status:

- A 4.5 s `JustRevealedFlash` card (border-2 primary, 3xl bold points, 2xl flag + country) — fires on every `announce_next` for every viewer, including the announcer *and* every guest watching at home.
- The same full-density leaderboard (`py-2`, `w-6 h-6` rank chip, `text-sm` country) for both the announcer who's narrating and the guest who's just watching the totals shift.
- No per-turn "what's left for the current announcer to give" affordance — the driver sees only `pendingReveal` (the very next point).

SPEC §10.2 explicitly prescribes three distinct surfaces:

| Surface | Top | Middle | Bottom |
|---|---|---|---|
| Announcer's phone | *"Still to give: 7, 8, 10, 12"* | reveal line | Full leaderboard with rank-shift |
| Present (TV) | *"[User] is announcing"* + avatar | Large overlay, fades after 3 s | Full leaderboard with rank-shift |
| Other guests' phones | *"[User] is announcing"* | Toast auto-dismissing after 3 s | **Compact** live leaderboard |

The TV column is feature-complete. This slice closes the announcer-phone vs guest-phone delta:

1. Guests currently see the same big inline flash card as the announcer — overstating the moment. Spec says guests get a transient *toast*.
2. The announcer has no "Still to give" overview for full-style reveals — only the next point is visible.
3. The watcher leaderboard is the same density as the driver's. Spec says *compact* for guests.

## Goals

- **Guest phones receive a top-of-screen toast** (`<RevealToast>`) on every `announce_next` where the current user is not the announcer. The toast carries `points: number` so it renders correctly for both full style (`"gave 5 to 🇸🇪 Sweden"`) and short style (`"gave 12 to 🇸🇪 Sweden"`).
- **Active driver no longer fires a toast for self** and **keeps** the big `JustRevealedFlash` card. Drivers and watchers diverge cleanly.
- **Full-style active driver sees `<StillToGiveLine>`**: a single-line monospace strip of all 10 points (`1 · 2 · 3 · 4 · 5 · 6 · 7 · 8 · 10 · 12`) with already-given values rendered with `line-through text-muted-foreground/40` and remaining values in `text-foreground font-semibold`. Suppressed in short style (degenerate — short style is always one reveal per announcer).
- **Watcher modes get a compact leaderboard density** — same content, halved padding + smaller rank chip + smaller text. Drivers keep full density.
- **No schema change, no API change, no realtime payload change.** All work is presentational.

## Non-goals

- The auto-advance + sticky "Hold" control from SPEC §10.2 step 4. Already deferred to V1.1 per the comment block in `AnnouncingView.tsx:546-549` — default-on auto-advance can cut narrators off mid-sentence on TV; default-off ships dead code.
- A separate component for the watcher view. The 5-mode `pickMode()` split inside `<AnnouncingView>` is the existing seam; a new derived `surface = isActiveDriver ? 'driver' : 'watcher'` boolean is enough to gate the three behavioural deltas. Splitting into `<AnnouncerView>` / `<WatcherView>` files would duplicate the shared header / progress bar / cascade-exhaust / roster paths without a corresponding readability win.
- Server-side reordering of the points sequence. The full-style canonical order `[1, 2, 3, 4, 5, 6, 7, 8, 10, 12]` is assumed from the spec — `<StillToGiveLine>` reads from a constant, not from server state. If a future server change ever emits a different sequence, the helper degrades to a slightly wrong overview but no functional regression (the actual reveal is driven by `pendingReveal.points`, not the line).
- Backfilling Playwright coverage for the toast watcher path. RTL on `<AnnouncingView>` + `<RevealToast>` is sufficient; Playwright slot stays optional pending the Phase 0 multi-window infra.
- Restyling the active-driver surface. The big flash card + reveal CTA + tap-anywhere zone stay as-is.

## Architecture

Three coordinated changes inside `<AnnouncingView>` plus two file moves:

### 1. Derived `surface` flag (in `AnnouncingView.tsx`)

```ts
const isActiveDriver = !!announcement && (isDelegate || (isAnnouncer && !adminHasTakenControl));
const surface: 'driver' | 'watcher' = isActiveDriver ? 'driver' : 'watcher';
```

Used to gate: `JustRevealedFlash` (driver only), toast firing (watcher only), `<LeaderboardRow density>` prop (driver = full, watcher = compact).

The 5-mode `pickMode()` stays — it drives the `<HeaderCard>` copy variant (active-announcer / active-delegate / passive-announcer / owner-watching / guest-watching) and remains the source of truth for *which* narrative copy renders. `surface` is purely a presentational toggle that piggybacks on the existing driver-vs-not split.

### 2. `<RevealToast>` (rename + extend `TwelvePointToast`)

`src/components/room/TwelvePointToast.tsx` → `src/components/room/RevealToast.tsx`. Component export renames `TwelvePointToast` → `RevealToast`. The `ToastEvent` type gains a `points: number` field.

Render copy (single line, top-of-screen pill):

```
{announcingUserDisplayName} gave {points} to {flag} {country}
```

ICU placeholder shape: `announce.revealToast = "{name} gave {points} to {flag} {country}"`. Existing 12-point call sites in short-style flow pass `points: 12` — no behavioural regression.

The existing queueing + 3 s auto-dismiss + stacking behaviour is preserved. The component already handles >1 simultaneous toasts via the events array; full-style reveals can fire as fast as the announcer taps, so the queue earns its keep.

Fire condition in `<AnnouncingView>` updates from:

```ts
// before — short style only
if (announcementStyle === "short" && currentUserId !== event.announcingUserId) { ... }
```

to:

```ts
// after — any style, watcher only
if (currentUserId !== event.announcingUserId) {
  setToastEvents((prev) => [
    ...prev,
    {
      id: `toast-${event.announcingUserId}-${Date.now()}`,
      announcingUserDisplayName: announcerName,
      country: contestant.country,
      flagEmoji: contestant.flagEmoji,
      points: event.points,
      at: Date.now(),
    },
  ]);
}
```

### 3. `<StillToGiveLine>` (new component) + `stillToGive` helper

**Pure helper** `src/lib/announce/stillToGive.ts`:

```ts
export const FULL_REVEAL_POINTS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12] as const;

export interface StillToGiveSplit {
  given: readonly number[];
  remaining: readonly number[];
}

export function stillToGive(currentAnnounceIdx: number): StillToGiveSplit {
  const clamped = Math.max(0, Math.min(currentAnnounceIdx, FULL_REVEAL_POINTS.length));
  return {
    given: FULL_REVEAL_POINTS.slice(0, clamped),
    remaining: FULL_REVEAL_POINTS.slice(clamped),
  };
}
```

**Component** `src/components/room/StillToGiveLine.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { stillToGive } from "@/lib/announce/stillToGive";

export interface StillToGiveLineProps {
  currentAnnounceIdx: number;
}

export default function StillToGiveLine({ currentAnnounceIdx }: StillToGiveLineProps) {
  const t = useTranslations("announcing.stillToGive");
  const { given, remaining } = stillToGive(currentAnnounceIdx);
  return (
    <p
      className="font-mono text-xs tabular-nums text-muted-foreground text-center"
      aria-label={t("aria", { remaining: remaining.join(", ") })}
    >
      <span className="mr-2 text-[10px] uppercase tracking-wider">{t("label")}</span>
      {given.map((p) => (
        <span key={`g-${p}`} className="mx-0.5 line-through text-muted-foreground/40">
          {p}
        </span>
      ))}
      {remaining.map((p) => (
        <span key={`r-${p}`} className="mx-0.5 font-semibold text-foreground">
          {p}
        </span>
      ))}
    </p>
  );
}
```

**Mount site** in `<AnnouncingView>`: between the `<header>` block (lines 486-517) and the `JustRevealedFlash` block (line 519), gated on `isActiveDriver && announcementStyle === 'full' && announcement?.queueLength === 10`. The `queueLength === 10` guard is defensive — short style has `queueLength === 1`, and a future style with a different queue length skips the line entirely rather than rendering a misleading overview.

### 4. `<LeaderboardRow>` extract (inline in `AnnouncingView.tsx`)

Pull the 18-line leaderboard `<li>` JSX (lines 716-733) into a local component within the same file:

```tsx
type Density = 'driver' | 'watcher';

function LeaderboardRow({ entry, contestant, density }: {
  entry: LeaderboardEntry;
  contestant: Contestant | undefined;
  density: Density;
}) {
  const country = contestant?.country ?? entry.contestantId;
  const flag = contestant?.flagEmoji ?? "🏳️";
  const rowCls = density === 'watcher'
    ? "flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1"
    : "flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2";
  const rankCls = density === 'watcher'
    ? "inline-flex items-center justify-center w-5 h-5 rounded-full bg-background text-[10px] font-semibold text-muted-foreground"
    : "inline-flex items-center justify-center w-6 h-6 rounded-full bg-background text-xs font-semibold text-muted-foreground";
  const countryCls = density === 'watcher' ? "text-xs font-medium" : "text-sm font-medium";
  const pointsCls = density === 'watcher'
    ? "font-mono text-xs font-bold tabular-nums"
    : "font-mono text-sm font-bold tabular-nums";

  return (
    <li className={rowCls}>
      <div className="flex items-center gap-2">
        <span className={rankCls}>{entry.rank}</span>
        <span className={density === 'watcher' ? "text-base" : "text-xl"} aria-hidden>{flag}</span>
        <span className={countryCls}>{country}</span>
      </div>
      <span className={pointsCls}>{entry.totalPoints}</span>
    </li>
  );
}
```

The map call inside the leaderboard section becomes:

```tsx
{leaderboard.map((entry) => (
  <LeaderboardRow
    key={entry.contestantId}
    entry={entry}
    contestant={contestantById.current.get(entry.contestantId)}
    density={surface}
  />
))}
```

### 5. `JustRevealedFlash` gate

Wrap the existing flash card block (`AnnouncingView.tsx:519-536`) in `{isActiveDriver && justRevealed ? (...) : null}` instead of `{justRevealed ? (...) : null}`. Watchers no longer see the big card; they see the toast.

Active drivers keep the flash card in **both** styles. In short style the driver also sees the `<TwelvePointSplash>` inside `<ShortStyleRevealCard>` — these two surfaces coexist already and are unchanged by this slice. The slice only removes the watcher-side rendering of the flash card; the pre-existing short-style driver duplication is left as-is (separate polish item, not part of the matrix completion).

The `justRevealed` state itself stays bound to every viewer (the broadcast subscriber runs for all clients) — only the *rendering* is driver-only. This keeps the existing `setTimeout` clear path simple; no need to gate the `setJustRevealed` call site.

**Side-benefit for short-style watchers**: today they see both the `TwelvePointToast` *and* the `JustRevealedFlash` card on every 12-point reveal — the double-surface this slice exists to fix. After this change, short-style watchers see only the toast, matching full-style watcher behaviour.

## Data flow

Single broadcast (`announce_next`) fans out to all subscribers via the existing `useRoomRealtime` hook. Each client locally decides what to render based on `currentUserId === event.announcingUserId`:

```
              announce_next broadcast
                       │
       ┌───────────────┼──────────────────────┐
       │               │                       │
  Active driver    Watcher              Active driver
  (announcer or    (everyone           refetches /api/results
  delegate)        else)                → currentAnnounceIdx bumps
       │               │                → StillToGiveLine re-renders
       │               │
       ▼               ▼
  JustRevealedFlash   RevealToast
  (big card 4.5 s)    (3 s pill, top)
```

No new state, no new fetch path, no new event variant.

## Edge cases

- **Cascade-exhaust state** (all remaining announcers absent). The cascade-exhaust branch returns *before* the toast / flash-card / still-to-give render paths, so no interaction needed. Confirmed by [src/components/room/AnnouncingView.tsx:431-460](../../../src/components/room/AnnouncingView.tsx#L431-L460).
- **Batch reveal mode** (host driving as proxy). Owner is the active driver — `isActiveDriver === true`, so they see the big flash card + `<StillToGiveLine>` if full style. Other watchers get toasts. No special-case branch needed.
- **Active delegate** (owner has taken over for a user). `isDelegate === true` → `isActiveDriver === true`. Treated as a driver for surface purposes. The original announcer (now passive) renders as a watcher and receives toasts.
- **Passive announcer** (admin took over, original announcer is watching). `isActiveDriver === false` → watcher surface. Sees toast + compact leaderboard, no big flash card. Matches the passive-announcer header-card copy.
- **Owner watching** (no delegate, owner not announcer). `isActiveDriver === false` → watcher. Owner has additional Take-control + Skip CTAs above the leaderboard (existing block at `AnnouncingView.tsx:637-683`); those stay full-density since they're admin controls, not leaderboard rows. Owner is treated as a guest for *leaderboard density* but keeps full admin chrome.
- **`currentAnnounceIdx` out of bounds**. `stillToGive()` clamps to `[0, FULL_REVEAL_POINTS.length]`. An out-of-range value renders an empty-remaining line, which is fine — the announcer is between turns anyway.
- **Toast fired faster than the 3 s auto-dismiss**. Existing `<RevealToast>` queueing handles it — toasts stack vertically (already implemented for short style). Full style can fire ~10 toasts in 30 s if a fast announcer rattles through; the stacking handles it.
- **Watcher reconnects mid-announcement**. The existing `<CatchingUpPill>` (1 s flash, SPEC §10.2 step "Rejoin during announcing") still renders. The watcher misses any in-flight toasts (they fired while disconnected). The leaderboard refetch on reconnect catches them up. Acceptable per spec — the toast is transient by design.

## Testing

### Unit (vitest, node env)

`src/lib/announce/stillToGive.test.ts` — new. Table-driven on `currentAnnounceIdx`:

| Input | Expected `given` | Expected `remaining` |
|---|---|---|
| 0 | `[]` | `[1,2,3,4,5,6,7,8,10,12]` |
| 1 | `[1]` | `[2,3,4,5,6,7,8,10,12]` |
| 5 | `[1,2,3,4,5]` | `[6,7,8,10,12]` |
| 9 | `[1,2,3,4,5,6,7,8,10]` | `[12]` |
| 10 | `[1,2,3,4,5,6,7,8,10,12]` | `[]` |
| -1 (clamp) | `[]` | full |
| 99 (clamp) | full | `[]` |

### RTL component (vitest, jsdom)

`src/components/room/StillToGiveLine.test.tsx` — new:
- Renders `text-foreground font-semibold` on remaining values
- Renders `line-through` on given values
- aria-label includes remaining values comma-separated
- Locale-key shape matches `announcing.stillToGive.{label,aria}`

`src/components/room/RevealToast.test.tsx` — adapted from `TwelvePointToast.test.tsx`:
- Renders `gave 12 to 🇸🇪 Sweden` for `points: 12` (regression for short style)
- Renders `gave 5 to 🇸🇪 Sweden` for `points: 5` (new full-style case)
- Queues multiple toasts; oldest auto-dismisses first
- 3 s auto-dismiss timer (fake-timer driven)
- Renames don't break import paths from `<AnnouncingView>` (smoke import test)

`src/components/room/AnnouncingView.test.tsx` — extend the existing 22 cases with the watcher/driver split:
1. Full-style active announcer: `<StillToGiveLine>` renders with `currentAnnounceIdx = 3`, given = [1,2,3], remaining = [4,5,6,7,8,10,12]
2. Full-style active announcer receives `announce_next` for own contestant → big flash card renders; toast does NOT fire (assertion: `queryByRole('status', { name: /gave/i })` is null)
3. Full-style guest-watching receives `announce_next` → toast renders; big flash card does NOT render (assertion: `queryByText(/just revealed/i)` is null)
4. Short-style: `<StillToGiveLine>` is suppressed (`queryByText(/still to give/i)` is null)
5. Watcher leaderboard rows carry compact classes (`py-1`, `w-5`, `text-xs`); driver rows carry full classes (`py-2`, `w-6`, `text-sm`)
6. Owner-watching (admin not driving) gets compact leaderboard rows, full-density admin CTA panel above

### Manual smoke (mandatory before merge)

- Open the same room in three browser windows (active announcer / owner-watching / guest-watching), full style, 3-contestant test fixture room.
- Advance through 3 reveals. Confirm:
  - Active announcer sees: still-to-give line at top with strike-through progressing, big flash card on each reveal, full-density leaderboard.
  - Owner-watching sees: no still-to-give line, top-of-screen toast on each reveal (3 s auto-dismiss), compact leaderboard, admin CTA panel still full-density.
  - Guest-watching sees: no still-to-give line, top-of-screen toast, compact leaderboard, no admin chrome.
- Repeat in short style. Confirm `<StillToGiveLine>` is absent in all three windows; toast still fires for watchers on the 12-point reveal.

## Files touched

- `src/components/room/AnnouncingView.tsx` — derived `surface`, mount `<StillToGiveLine>`, extract `<LeaderboardRow>`, gate `JustRevealedFlash` on `isActiveDriver`, update toast fire condition
- `src/components/room/TwelvePointToast.tsx` → **rename** `RevealToast.tsx`; `ToastEvent` gains `points: number`; copy updated to `{name} gave {points} to {flag} {country}`
- `src/components/room/TwelvePointToast.test.tsx` → **rename** `RevealToast.test.tsx`; add `points`-parametric cases
- `src/components/room/StillToGiveLine.tsx` + `.test.tsx` — **new**
- `src/lib/announce/stillToGive.ts` + `.test.ts` — **new**
- `src/components/room/AnnouncingView.test.tsx` — extend with 6 new cases per §Testing
- `src/locales/en.json` — add `announcing.stillToGive.{label,aria}`; rename existing `announce.shortReveal.toast` key → `announce.revealToast`; update ICU shape to `"{name} gave {points} to {flag} {country}"`
- `src/locales/{es,uk,fr,de}.json` — same key shape additions; L3 translations follow the existing pattern (es/uk/fr/de were just populated in PR #108)

## Locale key changes

```jsonc
// en.json — additions
{
  "announcing": {
    "stillToGive": {
      "label": "Still to give:",
      "aria": "Remaining points to award: {remaining}"
    }
  },
  "announce": {
    "revealToast": "{name} gave {points} to {flag} {country}"
  }
}
```

Old key `announce.shortReveal.toast` is removed in this slice. Short-style call sites switch to `announce.revealToast` with `points: 12` — same rendered string, single source of truth.

## Rollback notes

Pure presentational change. If a dry-run reveals a regression, revert the single PR; `announce_next` broadcast shape, server state, and stored data are untouched.
