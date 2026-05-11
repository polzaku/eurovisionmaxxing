# PR B — Short live reveal surfaces (announcer phone + present TV + guest toast) — Implementation Design

**Slice:** PR B of 3. PR A (foundation + server) shipped — `announcement_style` exists on `rooms`, `runScoring` and `advanceAnnouncement` already branch on it, and `score_batch_revealed` already broadcasts. PR B exposes the user-facing live surfaces: the announcer's compressed "Reveal 12 points" CTA, the TV splash, the guest toast. PR C (last) adds the wizard / lobby-edit chooser so admins can opt in through normal UI.

**Settable for now:** still via direct DB write only (`UPDATE rooms SET announcement_style='short'`). After PR B merges + an operator flips a test room, the live experience is fully visible. PR C makes it admin-discoverable.

**Product spec of record:** SPEC §10.2.2 (the three-surface table at line 1004 + post-tap behaviour + guest toast).

---

## Three surfaces, three render paths

| Surface | When | Component | New in PR B |
|---|---|---|---|
| **Announcer phone (active driver)** | They are the current announcer under short style, before tap | `AnnouncingView` short-style branch | Single full-width "Reveal 12 points" CTA + microcopy `Tap when you say it`. Replaces the existing tap-zone with `Up next` |
| **Announcer phone (active driver, post-tap)** | Immediately after their tap, ~3s | `TwelvePointSplash` (full-card) inside `AnnouncingView` | Large flag/country/artist/song splash, replaces the CTA card. Auto-dismisses on next turn rotation (the existing announce_next refetch + the natural state advance) |
| **Present TV** | `/present` route, room status = announcing, style = short | `PresentScreen` short-style branch | Bottom ticker "Awaiting their 12 points…" between turns. On 12pt broadcast: `TwelvePointSplash` overlay fills centre for 3s, leaderboard pushes to a smaller strip |
| **Guest phone (non-announcer, non-owner-watching)** | They're watching, room status = announcing, style = short, after 12pt broadcast | `TwelvePointToast` inside `AnnouncingView` | Small transient toast at top of screen: `{User} gave 12 to {Country} {flag}`. Auto-dismisses 3s |
| **Auto-batch (all surfaces)** | `score_batch_revealed` broadcast lands | `AnnouncingView` + `PresentScreen` listeners | Refetch leaderboard. No animation — just inline rank shifts via the existing leaderboard re-render |

## What does NOT change in PR B

- Owner-watching mode renders the same as a guest (no spoilers — already true today).
- Cascade-exhaust / "Finish the show" admin CTA behaviour unchanged.
- Skip banner queue unchanged.
- Announcer roster panel unchanged.
- Batch-reveal-mode under short style: handled server-side (PR A); admin sees the same single-tap UI; the CTA copy already reads "Reveal next point" so we keep it (the admin is revealing on behalf of all absent users). The spec's "Reveal 12 points" copy is only for the genuine first-person announcer. Under batch-reveal the admin is a delegate-of-absent, and the existing tap-zone serves.
  - **Refinement:** under `batchRevealMode && announcementStyle === 'short'`, the admin's active-driver card still shows ONE tap that fires the auto-batch + 12pt in one server call. The card's copy can stay "Reveal next point" — works for both styles. No new branch needed for batch-reveal short. Test: confirm the existing card renders under that state.

## Files touched

| File | Action | What changes |
|---|---|---|
| `src/lib/room/api.ts` (or `fetchRoomData`) | verify | confirm `announcementStyle` is part of the Room payload returned to the page (PR A already wired this in `get.ts` / `mapRoom`) |
| `src/app/room/[id]/page.tsx` | modify | pass `announcementStyle` through to `<AnnouncingView />` |
| `src/app/room/[id]/present/page.tsx` | modify | extend `RoomShape` interface, pass `announcementStyle` to `<PresentScreen />` |
| `src/components/room/AnnouncingView.tsx` | modify | (a) new prop `announcementStyle`; (b) new "active-announcer + short" render mode with compressed CTA; (c) listen for `score_batch_revealed`; (d) emit guest toast on `announce_next` when not active driver + style=short |
| `src/components/room/AnnouncingView.test.tsx` | modify | new short-style cases |
| `src/components/present/PresentScreen.tsx` | modify | (a) new prop `announcementStyle`; (b) ticker "Awaiting their 12 points…" under short; (c) listen for splash trigger (the page passes a `justRevealed` prop fed from `useRoomRealtime`); (d) render `<TwelvePointSplash>` overlay |
| `src/components/present/PresentScreen.test.tsx` | modify | new short-style cases |
| `src/components/room/TwelvePointSplash.tsx` | create | shared splash: flag + country + artist + song. Variants: `size: 'fullscreen' \| 'card'` |
| `src/components/room/TwelvePointSplash.test.tsx` | create | unit tests for both size variants |
| `src/components/room/TwelvePointToast.tsx` | create | guest transient toast |
| `src/components/room/TwelvePointToast.test.tsx` | create | tests for auto-dismiss + visibility |
| `src/locales/en.json` | modify | new keys (see Locale section) |
| `src/locales/{es,uk,fr,de}.json` | modify | empty stubs matching the en key shape |

## Locale keys (new)

```json
{
  "announce": {
    "shortReveal": {
      "cta": "Reveal 12 points",
      "ctaMicrocopy": "Tap when you say it",
      "revealed": "Revealed ✓",
      "awaitingTwelve": "Awaiting their 12 points…",
      "guestToast": "{name} gave 12 to {country} {flag}"
    }
  }
}
```

Five new strings. Stubbed in es/uk/fr/de (empty string values — `locales.test.ts` parity check passes; L3 translation pass deferred).

## Realtime event handling

`AnnouncingView` already subscribes via `useRoomRealtime`. The orchestrator already broadcasts `score_batch_revealed` from PR A. PR B adds:

- **`score_batch_revealed` handler** in `AnnouncingView`: just `void refetch()`. The new event also implicitly catches the "next announcer's auto-batch fired" signal — refetch picks up the new `announcing_user_id` and the updated leaderboard simultaneously.
- **Toast trigger** in `AnnouncingView`: when `announce_next` arrives AND `style === 'short'` AND current user is NOT the active driver, push the toast onto a 3-second-dismiss queue. (Reuse the existing `justRevealed` flash mechanism — it already auto-dismisses; just retarget when style=short for non-driver users.)

`PresentScreen` doesn't subscribe directly — the page subscribes and passes data down. The page (`/present/page.tsx`) needs to additionally:
- On `announce_next` event under short style: pass a `splashEvent: { contestantId, points }` prop to `PresentScreen` with a key bumping every emit so the splash remounts on each tap.
- The splash component holds its own 3-second auto-dismiss timer via `useEffect`.

## TwelvePointSplash component

```tsx
interface TwelvePointSplashProps {
  contestant: Contestant; // flag, country, artist, song from existing type
  size: 'fullscreen' | 'card'; // fullscreen = /present TV; card = announcer phone
  /** ISO timestamp or counter that increments per emit; remounts the splash. */
  triggerKey?: string | number;
}
```

Renders a centered block with the country flag emoji at large display size, country name as a primary heading, artist + song stacked below. Includes a `motion-safe:animate-fade-in` and an internal `useEffect` to call an optional `onDismiss` after 3000ms (the parent doesn't have to unmount it for the auto-dismiss; visual fade-out fires regardless).

CSS: tailwind utility classes; no new `.emx-*` rules needed unless rendered animation deviates from existing patterns.

## TwelvePointToast component

```tsx
interface TwelvePointToastProps {
  events: Array<{
    id: string;
    announcingUserDisplayName: string;
    country: string;
    flagEmoji: string;
    at: number;
  }>;
  dismissAfterMs?: number; // default 3000
}
```

Top-of-screen sticky toast train. Reuses the same dismissal pattern as `SkipBannerQueue`. Renders the most recent event; new events replace.

## Render mode pickup in AnnouncingView

Inside the existing `pickMode` switch, add a sub-branch only on the "active-announcer" and "active-delegate" paths: when `announcementStyle === 'short'`, render the compressed CTA card instead of the verbose tap-zone. The pickMode function itself doesn't change — instead, the JSX that follows checks `announcementStyle` and renders the short-style block when applicable.

```tsx
{isActiveDriver && announcement?.pendingReveal && announcementStyle === 'short' ? (
  <ShortStyleRevealCard
    onReveal={handleReveal}
    submitting={advanceState.kind === 'submitting'}
    error={advanceState.error}
    contestant={pendingContestant}
    justRevealed={justRevealed}
  />
) : isActiveDriver && announcement?.pendingReveal ? (
  /* existing full-style tap-zone */
) : null}
```

`ShortStyleRevealCard` is an internal sub-component (~40 LOC) — defined inline in `AnnouncingView.tsx` rather than its own file. After tap (when `justRevealed` lands), it swaps the CTA for `<TwelvePointSplash size="card" />` plus the "Revealed ✓" confirmed-state label.

## Test plan

- **`TwelvePointSplash.test.tsx`** — 4 cases: renders flag/country/artist/song for `size: 'fullscreen'`, renders same for `size: 'card'`, auto-dismisses via callback after 3s, missing `artist`/`song` falls back gracefully.
- **`TwelvePointToast.test.tsx`** — 3 cases: renders most recent event, auto-dismisses after 3s, handles multiple events in rapid succession.
- **`AnnouncingView.test.tsx`** — 5 new cases:
  - Active announcer + style='short': renders "Reveal 12 points" CTA + microcopy, does NOT render the verbose tap-zone.
  - Active announcer + style='full' (control): renders the existing tap-zone, no short CTA.
  - Active announcer + style='short' + `justRevealed`: renders `TwelvePointSplash` size=card replacing the CTA.
  - Guest + style='short' + announce_next broadcast: renders `TwelvePointToast` with the correct copy.
  - Guest + style='full' (control): does NOT render the toast.
- **`PresentScreen.test.tsx`** — 4 new cases:
  - announcing + style='short' + active announcer present, no splash: renders "Awaiting their 12 points…" ticker.
  - announcing + style='short' + `splashEvent` set: renders `TwelvePointSplash` size=fullscreen with the right contestant.
  - announcing + style='full' (control): does NOT render the short ticker or splash.
  - score_batch_revealed broadcast → refetch fires (mock check).

- **Locale parity:** the existing `locales.test.ts` runs across the 5 files and verifies key shape. Adding new keys requires all 5 to gain matching keys; the parity test enforces this.

## What I deliberately left out of PR B

- E2E Playwright spec (deferred to PR C or post-PR-C).
- Hide the toast on the announcer's phone — they already see the splash, but they shouldn't ALSO see the toast. Guarded by `!isActiveDriver` so this is implicit.
- Reduced-motion fallback for the splash. Use existing `motion-safe:` and `motion-reduce:` Tailwind utilities; the splash works without animation under reduced-motion (just appears instantly).
- Localisation of the splash microcopy beyond what's in en.json. The L3 translation pass for these strings happens separately (Phase L).

## Rollout

1. Merge PR B.
2. (Optional, recommended) Operator UPDATEs a test room to `announcement_style = 'short'`, opens `/room/{id}` and `/room/{id}/present`, steps through a turn to QA.
3. PR C ships the wizard + lobby-edit chooser → feature becomes admin-discoverable.

Backwards compatibility: `announcementStyle` defaults to `'full'`. Every existing live-mode room continues to use today's 1→12 reveal. The short-style code paths only activate when explicitly set.

## Risk

- The `useRoomRealtime` subscriber pattern is already battle-tested. Adding two new event handlers (one for `score_batch_revealed`, one for the short-style toast trigger off `announce_next`) is mechanically safe.
- The splash/toast components are self-contained UI with auto-dismiss timers. The most likely bug: timer cleanup on unmount. Tests cover that.
- Edge case: announcer disconnects mid-splash. The splash dismisses naturally after 3s; the next turn's auto-batch fires on the rotation server-side; the next announcer (or admin in batch-reveal) drives forward. No new code needed.

## What this PR explicitly does NOT promise

- That the splash looks pixel-perfect on every TV aspect ratio. Sized via `vw`/`vh` units; tested at 16:9 and 4:3 in the existing /present styling. Phone variant uses card width. If the TV looks wonky in operator QA, polish lands in PR C or a follow-up commit.
- That guest toast copy is L3-translated. en.json only; the parity test passes because stubs ship in es/uk/fr/de.
