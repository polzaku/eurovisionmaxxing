# R4 #3 `/present` "Awaiting an admin to continue…" + TV SkipBannerQueue — design

**Date:** 2026-05-11
**TODO ref:** [TODO.md:269](../../../TODO.md#L269) (Phase R4 §10.2.1)
**SPEC ref:** §10.2.1 line 982 ("If the admin is themselves absent at this moment…") + §10.3 (presentation screen)
**Slice:** R4 stage 3 of 3. Closes the R4 cluster. Builds on R4 #1 (cascade-exhaust sentinel, PR #95) and R4 #2 (batch-reveal mode, PR #96).

## Problem

The `/room/[id]/present` TV surface today renders the leaderboard + announcer header for `announcing` and `done` states. After R4 #1 + R4 #2 introduced two new sub-states of `announcing`, the TV has no representation of either:

1. **Cascade-exhausted** (`status='announcing' AND announcing_user_id=null AND batch_reveal_mode=false`): R4 #1 leaves the room here when every remaining announcer is absent. On guest phones (`<AnnouncingView>`), guests see "Waiting for the host to continue…". The TV currently renders the leaderboard with a blank announcer slot — no explanation. SPEC §10.2.1 line 982: *"the `/present` screen renders 'Awaiting an admin to continue…' until then."*

2. **Batch-reveal active** (`batch_reveal_mode=true`): R4 #2 introduced this state. On guest phones, the announcer header gets a "Host is finishing the show" chip. The TV currently renders the leaderboard + announcer header with no chip — guests reading the room can't tell whether the announcer is live or being driven by the admin.

Plus a TODO comment was placed in `PresentScreen.tsx:74` during R4 #1 for the TV-side `<SkipBannerQueue>` subscriber. Today, when cascade-skip emits `announce_skip` events, only the room-page `<AnnouncingView>` shows them — the TV stays silent, leaving guests watching the TV unaware why the show paused.

## Goals

- **TV cascade-exhaust copy.** Centered "Awaiting an admin to continue…" copy when the room is in cascade-exhaust state. Suppress the leaderboard and announcer header in this branch (the leaderboard is frozen anyway and the absence of an announcer is the headline message).
- **TV batch-reveal chip.** When `batch_reveal_mode=true`, render the existing leaderboard + announcer header + a new "Host is finishing the show" chip near the announcer name (mirror of R4 #2's `<AnnouncingView>` chip).
- **TV skip banners.** Mount `<SkipBannerQueue>` (already shipped in R4 #1) on the TV. Subscribe to `announce_skip` broadcasts via the existing `useRoomRealtime` hook on `PresentPage`. Banner queue uses the same coalescing rules from R4 #1.
- **Realtime swing into batch-reveal.** Subscribe to the `batch_reveal_started` event on the TV and refetch room state so the TV transitions cleanly out of the waiting screen into batch-reveal active.

## Non-goals

- New endpoints, schema changes, orchestrator changes — none.
- Owner-vs-guest distinction on the TV — the present screen has no owner concept; the cascade-exhaust copy is the same for everyone watching.
- Three-surface differentiation (announcer phone vs guest phone vs TV with different per-reveal content) — out of scope; tracked as the broader L1 follow-up.
- Multi-window Playwright coverage — UI-only slice; RTL is sufficient for ship.

## Architecture

The TV's data flow already has both polling and broadcast subscription:

- **Polling** (`/api/results/{id}` every 2 s): picks up the cascade-exhaust state via `results.announcement === null` (`loadResults` returns null for the announcement block when `announcing_user_id` is null).
- **Broadcasts** (`useRoomRealtime` already mounted): currently handles `status_changed` and `voting_ending` to trigger a full room refetch.

This slice extends the broadcast callback with two new handlers:
- `announce_skip` → push to local `skipEvents` state. The mounted `<SkipBannerQueue>` consumes the array.
- `batch_reveal_started` → trigger `load()` so the TV picks up `batchRevealMode=true` and the new `announcing_user_id` from the full room fetch.

The cascade-exhaust state itself does NOT need a new broadcast type. When `advanceAnnouncement` cascade exhausts, the existing `announce_skip` broadcasts emit; the TV pushes them into the queue (banner train) AND the polling cycle picks up `announcement: null` within 2 s, swinging the TV into the cascade-exhaust copy.

`<PresentScreen>` is a prop-driven component. The new branches are render-only — no new hooks, no new fetches inside the component itself.

## Components

### 1. `PresentPage` ([src/app/room/[id]/present/page.tsx](../../../src/app/room/[id]/present/page.tsx))

**Add to `RoomShape`:**
```ts
interface RoomShape {
  ...,
  batchRevealMode: boolean;
}
```

`fetchRoomData` already returns the full `Room` domain type (`mapRoom` was extended with `batchRevealMode` in R4 #2 Task 1). The page just needs to surface it.

**Add `skipEvents` state** (mirror of `<AnnouncingView>`'s pattern from R4 #1):
```ts
const [skipEvents, setSkipEvents] = useState<SkipEvent[]>([]);
```

**Extend the `useRoomRealtime` callback:**
```ts
useRoomRealtime(roomId, (event) => {
  if (event.type === "status_changed" || event.type === "voting_ending") {
    void load();
  } else if (event.type === "batch_reveal_started") {
    void load();
  } else if (event.type === "announce_skip") {
    setSkipEvents((prev) => [
      ...prev,
      {
        id: `${event.userId}-${Date.now()}`,
        userId: event.userId,
        displayName: event.displayName,
        at: Date.now(),
      },
    ]);
  }
});
```

**Pass new props to `<PresentScreen>`:**
```tsx
<PresentScreen
  ...,
  batchRevealMode={phase.room.batchRevealMode}
  skipEvents={skipEvents}
/>
```

### 2. `<PresentScreen>` ([src/components/present/PresentScreen.tsx](../../../src/components/present/PresentScreen.tsx))

**Update props:**
```ts
interface PresentScreenProps {
  ...,
  batchRevealMode?: boolean;
  skipEvents?: SkipEvent[];
}
```

**Add derived state at the top of the component:**
```ts
const isCascadeExhausted =
  status === "announcing" &&
  !announcerDisplayName &&
  !batchRevealMode;
const isBatchReveal = batchRevealMode === true;
```

(Using `announcerDisplayName` as the proxy for "no active announcer" — it's only set when `announcing_user_id` resolves to a user. This matches the existing PresentPage `announcerDisplayName` derivation.)

**Add cascade-exhaust render branch** (place BEFORE the existing `announcing | done` branch):
```tsx
if (isCascadeExhausted) {
  return (
    <main
      data-testid="present-screen"
      data-status="announcing"
      data-cascade-exhausted="true"
      className="flex min-h-screen flex-col items-center justify-center px-12 py-12 text-center"
    >
      <p className="text-2xl text-muted-foreground">
        {t("present.cascadeExhausted.subtitle")}
      </p>
      <p className="mt-6 text-7xl font-bold">
        {t("present.cascadeExhausted.title")}
      </p>
      {skipEvents && skipEvents.length > 0 ? (
        <SkipBannerQueue events={skipEvents} />
      ) : null}
    </main>
  );
}
```

The `<SkipBannerQueue>` overlay also renders here so any banners that fired during the transition into exhaust still play out on the TV.

**Mount `<SkipBannerQueue>` overlay on the announcing-leaderboard branch.** It's harmless when `skipEvents` is empty (the component returns null). Place it as the first child of the leaderboard `<main>` so it renders above everything:

```tsx
return (
  <PresentLeaderboard ...>
    {/* Existing contents */}
    {skipEvents && skipEvents.length > 0 ? (
      <SkipBannerQueue events={skipEvents} />
    ) : null}
  </PresentLeaderboard>
);
```

(Or pass `skipEvents` as a prop into `<PresentLeaderboard>` and render the queue inside it — pick whichever is cleanest in the component file.)

**Render the batch-reveal chip in the announcer header** of `<PresentLeaderboard>`. The header currently renders `announcerLabel` (display name) + `positionLabel`. Add a chip beneath/beside the announcer label when `isBatchReveal`:

```tsx
{announcerDisplayName && status === "announcing" ? (
  <div className="flex flex-col items-end gap-1">
    <p className="text-2xl text-muted-foreground">{announcerLabel}</p>
    {isBatchReveal ? (
      <p
        data-testid="present-batch-reveal-chip"
        className="text-base text-accent"
        aria-live="polite"
      >
        {t("present.batchReveal.chip")}
      </p>
    ) : null}
  </div>
) : null}
```

The `isBatchReveal` flag has to be passed through to `<PresentLeaderboard>` (or computed inside it from a new prop). Choose whichever wiring is cleaner.

### 3. Locale keys ([src/locales/en.json](../../../src/locales/en.json))

Under the existing `present.*` namespace:

```json
"present": {
  ...,
  "cascadeExhausted": {
    "title": "Awaiting an admin to continue…",
    "subtitle": "All announcers are away. The host will resume when they're back."
  },
  "batchReveal": {
    "chip": "Host is finishing the show"
  }
}
```

If `locales.test.ts` enforces empty stubs in non-en files, add the same nested structure with empty strings to `es.json`, `uk.json`, `fr.json`, `de.json`. Read `locales.test.ts` first to confirm.

## Tests

### RTL — `src/components/present/PresentScreen.test.tsx`

5 new cases inside the existing test file:

1. **Cascade-exhausted state renders waiting copy.** `status='announcing'`, `announcerDisplayName=undefined`, `batchRevealMode=false` → assert "Awaiting an admin" title visible, leaderboard NOT rendered, no announcer position label.
2. **Batch-reveal active renders chip.** `status='announcing'`, `announcerDisplayName='Alice'`, `batchRevealMode=true` → assert "Host is finishing the show" chip visible, leaderboard rendered, announcer label "Alice" visible.
3. **Normal announcing (regression).** `status='announcing'`, `announcerDisplayName='Bob'`, `batchRevealMode=false` → leaderboard + announcer label render, NO chip, NO waiting copy.
4. **`<SkipBannerQueue>` renders when `skipEvents` non-empty.** Pass a single skip event → assert the banner status role appears.
5. **`<SkipBannerQueue>` does not render when `skipEvents` empty/undefined.** No banner status role in DOM.

Plus regression: confirm existing lobby/voting/scoring/done branches still pass (no changes to those code paths).

### No new orchestrator tests

This is UI-only. The orchestrator work is done in R4 #1 and R4 #2.

### Playwright

**Out of scope for this slice.** The multi-window Playwright cost is high (need two browser contexts driving the same room) and the cascade-exhaust + batch-reveal flows are already covered end-to-end by the existing `announcing-cascade-all-absent` Playwright test from R4 #2 (which uses the room page, not the present page). Tracked as a follow-up if manual smoke surfaces issues.

## Slice plan (single PR)

1. Locale keys (`present.cascadeExhausted.*`, `present.batchReveal.chip`) in en.json + non-en stubs if required.
2. `<PresentScreen>` accepts new props + renders cascade-exhaust waiting state + mounts `<SkipBannerQueue>` + RTL cases 1, 4, 5.
3. `<PresentScreen>` renders batch-reveal chip + RTL cases 2, 3.
4. `PresentPage` threads `batchRevealMode` through, adds broadcast handlers, manages `skipEvents` state.
5. TODO tick + push + PR.

Roughly 4 files modified, 0 added (locale stubs aside). ~half a day.

## Risks

- **Polling lag for cascade-exhaust state.** When the cascade exhausts mid-show, the TV detects the new state via the 2-s polling cycle, NOT a broadcast. Up to 2 s of stale leaderboard render before the waiting copy appears. Acceptable — guests reading the TV won't know to expect a banner train, and the polling settles within a polling cycle. If this becomes a real problem, future work could emit a `cascade_exhausted` broadcast type, but YAGNI for now.
- **`<SkipBannerQueue>` placement on cascade-exhaust screen.** The waiting copy is centered on the TV. The skip banner overlay needs to NOT visually clash with the centered copy — placing the queue at the top of the screen (CSS `position: fixed; top: 0`) keeps it out of the way. The component as shipped already has this layout via its existing styles; verify by reading `<SkipBannerQueue>`.
- **`PresentPage` already polls every 2 s during announcing.** Cascade-exhaust DOES count as announcing. So polling continues — that's correct. It also continues during batch-reveal. Both are wanted.
- **No new RoomEvent variants needed** — `batch_reveal_started`, `announce_skip` already exist from R4 #1 and R4 #2. The `RoomEvent`/`RoomEventPayload` unions are unchanged.
