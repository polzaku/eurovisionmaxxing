# R4 #4 "Re-shuffle order" UI button — design

**Date:** 2026-05-11
**TODO ref:** [TODO.md:267](../../../TODO.md#L267) (Phase R4 §10.2.1)
**SPEC ref:** §10.2.1 lines 973–975 ("Admin re-shuffle of announcement order")
**Slice:** R4 follow-up. Server endpoint shipped on PR #91; this slice ships the deferred UI surface. The R4 cluster (#1–#3) already merged or pending merge; this is post-cluster polish.

## Problem

PR #91 shipped the server side of "re-shuffle order": `PATCH /api/rooms/{id}/announcement-order` + `reshuffleOrder` orchestrator + `patchAnnouncementOrder` client helper + `announcement_order_reshuffled` `RoomEvent` variant. The orchestrator enforces the spec's gate (`results.announced` count must be 0 — no reveal has happened yet) and returns `ANNOUNCE_IN_PROGRESS` 409 otherwise. UI was deliberately deferred — the TODO note read *"Stage 2 (UI button in roster header) deferred — lands after PR #90 merges to avoid concurrent edits to AnnouncerRoster/AnnouncingView."* PR #90 has long merged; the deferral reason is gone.

Today there is no way for an owner to invoke the reshuffle from the UI, and the `announcement_order_reshuffled` broadcast has **zero subscribers** in the client — so even if a hypothetical reshuffle did fire (e.g., from a curl call), the room UI wouldn't pick up the new order until a separate refetch trigger.

## Goals

- **Owner-only "Re-shuffle order" button** in the `<AnnouncerRoster>` header. Tapping calls `patchAnnouncementOrder` (the existing client helper) and broadcasts via the existing server path.
- **Hide the button entirely** outside the narrow pre-first-reveal window. The spec's wording — *"the admin sees a 'Re-shuffle order' button"* — implies conditional visibility, not "always visible but disabled". Showing a permanently-locked button after the first reveal is dead UI.
- **`announcement_order_reshuffled` broadcast handler** in `<AnnouncingView>` so the room's announcement state (active announcer, order, position labels) refetches on reshuffle. Same shape as existing handlers for `status_changed` etc.
- **Inline loading/error state** on the button. No confirmation modal — the action is fast, reversible (re-tap to re-roll), and visible only in a narrow window; a modal is overkill.

## Non-goals

- New endpoints, schema changes, orchestrator changes — none. Server side is fully shipped.
- Animated reshuffle reveal (cards re-ordering visually) — the existing leaderboard rank-shift animation is for points, not announcer order. A future polish slice if anyone notices.
- Owner-can-pick-the-order UI — out of scope. MVP reshuffle is server-randomized only.
- Pre-first-reveal "preview the new order" UX — the action runs in <100 ms and the new order is immediately visible in the roster panel post-broadcast. No preview needed.

## Architecture

Three coordinated additions on existing scaffolding:

### (a) `<AnnouncerRoster>` header button

Mirror the canonical owner-only callback pattern from R4 follow-ups (`onRestore` + `restoringUserId`): three new optional props.

```ts
interface AnnouncerRosterProps {
  ...,
  /** Owner-only callback for re-shuffling the announcement order.
   * When provided, the header renders a "Re-shuffle order" button —
   * but only when canReshuffle is also true. Omit on non-owner views. */
  onReshuffle?: () => void;
  /** True while patchAnnouncementOrder is in flight. Disables the
   * button + flips its copy to "Re-shuffling…". */
  reshuffling?: boolean;
  /** SPEC §10.2.1 — true only before any user has revealed any point.
   * When false, the button is hidden entirely (not greyed out — narrow
   * window means a locked button is dead UI). */
  canReshuffle?: boolean;
}
```

Render the button in the existing `<header>` element (currently containing the "Roster" title + "here now" legend). Right-justified next to the legend.

### (b) `<AnnouncingView>` owner-branch wiring

The owner branch already passes `members`, `presenceUserIds`, `currentAnnouncerId`, etc. to `<AnnouncerRoster>`. Add three more props:

```tsx
<AnnouncerRoster
  ...,
  onReshuffle={isOwner ? handleReshuffle : undefined}
  reshuffling={reshuffling}
  canReshuffle={isOwner && canReshuffle}
/>
```

`canReshuffle` derived locally from announcement state:

```ts
const canReshuffle =
  announcement?.currentAnnounceIdx === 0 &&
  announcement?.announcerPosition === 1 &&
  (announcement?.skippedUserIds ?? []).length === 0 &&
  !room.batchRevealMode;
```

All four conditions ensure "no advance has happened" — `currentAnnounceIdx === 0` (first announcer's queue untouched), `announcerPosition === 1` (still the first announcer, no rotation yet), no skipped users (no cascade has fired either), `!batchRevealMode` (post-cascade-exhaust state is past the reshuffle window).

The server enforces the same gate via `results.announced` count and returns `ANNOUNCE_IN_PROGRESS` 409 if a race slips through. The UI gate is just to prevent doomed clicks.

`handleReshuffle` calls `patchAnnouncementOrder` and tracks loading via local state:

```ts
const [reshuffling, setReshuffling] = useState(false);
const [reshuffleError, setReshuffleError] = useState<string | null>(null);

const handleReshuffle = useCallback(async () => {
  if (reshuffling) return;
  setReshuffling(true);
  setReshuffleError(null);
  try {
    const result = await patchAnnouncementOrder(room.id, currentUserId, {
      fetch: window.fetch.bind(window),
    });
    if (!result.ok) {
      setReshuffleError(
        result.error.code === "ANNOUNCE_IN_PROGRESS"
          ? t("roster.reshuffle.errorInProgress")
          : t("roster.reshuffle.errorGeneric"),
      );
    }
    // On success: the broadcast subscriber (below) handles the refetch.
  } finally {
    setReshuffling(false);
  }
}, [room.id, currentUserId, reshuffling, t]);
```

Error message renders inline in the roster header below the button (small text, accent color, dismissible on next interaction). The error state is local to the owner who tapped — guests don't see it.

### (c) `announcement_order_reshuffled` broadcast handler

In `<AnnouncingView>`'s existing `onMessage` switch, add a new case:

```ts
if (msg.type === "announcement_order_reshuffled") {
  onAnnouncementEnded?.();  // same refetch path as status_changed
}
```

Reuses the existing room-state refetch pattern. The `onAnnouncementEnded` callback name is misleading for this case (the announcement isn't ending — just reshuffling) but the underlying behavior (full room refetch via `loadRoom`) is exactly what we need. Per SPEC §10.2.1 — *"broadcasts `announcement_order_reshuffled`"* — every connected client refetches and renders the new order.

## Components

### 1. `<AnnouncerRoster>` button + props

In [src/components/room/AnnouncerRoster.tsx](../../../src/components/room/AnnouncerRoster.tsx), modify the `<header>` element:

```tsx
<header className="flex items-baseline justify-between gap-2">
  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
    Roster
  </h2>
  <div className="flex items-baseline gap-3">
    <p className="text-[10px] text-muted-foreground">
      <span aria-hidden className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1 align-middle" />
      here now
    </p>
    {onReshuffle && canReshuffle ? (
      <button
        type="button"
        onClick={onReshuffle}
        disabled={reshuffling}
        data-testid="roster-reshuffle"
        aria-label="Re-shuffle the announcement order"
        className="rounded border border-accent/50 bg-accent/5 px-2 py-0.5 text-xs font-medium text-accent transition-colors hover:bg-accent/10 active:scale-[0.98] disabled:opacity-60"
      >
        {reshuffling
          ? t("roster.reshuffle.busyCta")
          : t("roster.reshuffle.idleCta")}
      </button>
    ) : null}
  </div>
</header>
```

The button uses the same accent-color visual language as the `Restore` button on skipped rows — establishes a "owner action" visual category.

### 2. `<AnnouncingView>` wiring

The owner branch in [src/components/room/AnnouncingView.tsx](../../../src/components/room/AnnouncingView.tsx) already mounts `<AnnouncerRoster>`. Add the three new props per §Architecture (b). Add the `handleReshuffle` callback + local state. Add the `announcement_order_reshuffled` case to the `onMessage` switch.

The `reshuffleError` rendering — inline below the button in the roster header is one option, but easier on the existing AnnouncerRoster shape is to surface it in `<AnnouncingView>`'s top-level error display (alongside the existing `mapRoomError` outputs). For MVP, surface it via the existing error state path:

```ts
const [actionError, setActionError] = useState<string | null>(null);
// ... handleReshuffle on error: setActionError(message)
```

If `<AnnouncingView>` doesn't currently have such a path, add one as a one-line render block at the top of the owner branch. Don't over-engineer.

### 3. Locale keys

In [src/locales/en.json](../../../src/locales/en.json), add a new `roster.*` namespace if absent (otherwise extend it):

```json
"roster": {
  "reshuffle": {
    "idleCta": "🎲 Re-shuffle order",
    "busyCta": "Re-shuffling…",
    "errorInProgress": "Reveals have started — re-shuffle is no longer available.",
    "errorGeneric": "Couldn't re-shuffle. Try again?"
  }
}
```

If `locales.test.ts` enforces non-en stubs, add empty `roster.reshuffle.*` to other locale files.

## Tests

### `<AnnouncerRoster>` RTL — 5 new cases

1. **Button renders** when `onReshuffle` provided AND `canReshuffle === true`. Assert `data-testid="roster-reshuffle"` visible.
2. **Button hidden** when `canReshuffle === false` (regression — confirms hide-not-grey UX). Assert `queryByTestId` returns null.
3. **Button hidden** when `onReshuffle` undefined (non-owner view). Assert null.
4. **Button shows busy copy** when `reshuffling === true`. Assert button text matches `roster.reshuffle.busyCta`.
5. **Tapping calls onReshuffle**. Mock callback, click button, assert called once.

### `<AnnouncingView>` RTL — 3 new cases

1. **Owner sees the button when announcement state is fresh.** Mock `currentAnnounceIdx=0`, `announcerPosition=1`, no skipped users, `batchRevealMode=false`. Assert `roster-reshuffle` visible.
2. **Owner doesn't see the button after first reveal.** Mock `currentAnnounceIdx=1` (or any non-zero) → button hidden. Mirror test for `announcerPosition > 1`.
3. **`announcement_order_reshuffled` event triggers refetch.** Mock `onAnnouncementEnded` callback. Fire the broadcast event. Assert `onAnnouncementEnded` called.

### No new orchestrator tests

Server side fully tested in PR #91. UI-only slice.

### No new Playwright

The UI surface is conditional on a narrow window (pre-first-reveal). A multi-window E2E (window 1 reshuffles → window 2 sees the new order) would catch the broadcast subscriber wiring, but the unit test for the broadcast handler covers that. The cost-vs-value isn't there for ship.

## Slice plan (one PR, ~5 tasks)

1. Locale keys (`roster.reshuffle.*`).
2. `<AnnouncerRoster>` props + button + RTL (5 cases).
3. `<AnnouncingView>` `canReshuffle` derivation + `handleReshuffle` callback + props passing + RTL.
4. `<AnnouncingView>` `announcement_order_reshuffled` broadcast handler + RTL.
5. TODO tick + push gate.

Roughly 5 files modified. ~half a day.

## Risks

- **`canReshuffle` derivation drift.** The four conditions in §Architecture (b) need to match the server's gate (`results.announced` count). If the server relaxes its check (e.g., V2 lets reshuffle happen mid-show under some condition), the UI gate must follow. Mitigation: the server is authoritative — UI gate is a guardrail, not a contract. If server allows, button just shows and works.
- **Broadcast handler reuse of `onAnnouncementEnded`.** The callback name implies "announcement ended" (status_changed semantics) but here we're using it for "announcement state changed". Acceptable for MVP — both trigger the same `loadRoom()` action. A future cleanup could rename to `onAnnouncementStateChanged` if more handlers reuse it.
- **No confirmation modal on reshuffle.** A misclick scrambles the order. The order is server-randomized; a misclick can't be undone except by reshuffling again (which produces yet another random order, not the original). Mitigation: the button is only visible in the pre-first-reveal window where the order doesn't carry meaning yet (no one's narrative has been established). If accidental clicks become a real problem, a confirmation modal can be added in a follow-up.
- **Race between the UI gate (`canReshuffle`) and the server gate.** A server-side `announce_next` could fire between the UI render and the user's click. Server returns `ANNOUNCE_IN_PROGRESS` 409 — the inline error message handles it. Self-corrects.
