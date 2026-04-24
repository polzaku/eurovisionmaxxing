# Design: voting autosave — PR 2 of 3 (offline queue + banner + "Offline" chip state)

**Date:** 2026-04-24
**Phase:** 3 / continuation of autosave trio (PR #22 landed PR 1)
**Depends on:** `Autosaver` + `useVoteAutosave` + `SaveChip` from PR #22; vote rehydration from PR #23
**SPEC refs:** §8.5 (3-state chip + offline banner text), §8.5.2 (queued-at-status snapshot — *deferred to PR 3*), §8.5.3 (200-entry cap — *deferred to PR 3*)

---

## 1. Goal

When the browser is offline (or a real-post throws), route writes into `localStorage.emx_offline_queue` instead of failing. Show a sticky banner at the top of `VotingView` while offline and flip the save chip to the SPEC-accurate `Offline — changes queued` state. Drain the queue on the next `online` event.

## 2. Scope

### In scope
- Pure queue helpers (load / save / enqueue / shift) keyed on `localStorage.emx_offline_queue`.
- `OfflineAdapter` class wrapping the real `postVote` function; handles all four matrix cells (online/offline × queue-empty/queue-non-empty).
- Status composition in `useVoteAutosave`: merges Autosaver status with adapter queue/online state.
- Extending `SaveChip` with the `offline` state (keeps `error` for genuine 4xx/5xx).
- New `OfflineBanner` leaf component; rendered inside `VotingView` when `!navigator.onLine`.

### Out of scope (tracked for PR 3)
- Conflict reconciliation (server-wins + consolidated toast) — §8.5.1.
- Status-transition abort during drain (e.g. if voting ended while offline) — §8.5.2.
- 200-entry cap — §8.5.3.
- Retry with backoff — opportunistic drain on each new write + `online` event is enough for PR 2.
- Missed / hot-take writes through the adapter — same write path applies automatically once those UIs land; they just pass `missed`/`hotTake` in the `PostVoteInput`. No new code this slice.

## 3. Architecture

```
┌─────────────────┐
│   VotingView    │ ← saveStatus (DisplaySaveStatus), offlineBannerVisible (boolean)
└────────┬────────┘
         │ props
┌────────┴────────────┐
│  useVoteAutosave    │ ← composes Autosaver status + OfflineAdapter state
└────────┬────────────┘
         │ owns
┌────────┴────────┐      ┌──────────────────────────────┐
│   Autosaver     │──post──▶ OfflineAdapter            │
│   (unchanged)   │◀─result─ │  • navigator.onLine     │
└─────────────────┘      │  • localStorage queue       │
                         │  • `online` event listener  │
                         └──────┬───────────────────────┘
                                │ realPost
                                ▼
                          /api/rooms/{id}/votes
```

`Autosaver` stays **completely unchanged** from PR #22. It treats the adapter as a transparent `post` function. When the adapter enqueues, it returns `{ ok: true }` from Autosaver's perspective — the user's data IS saved, just locally.

The hook layers the visible truth on top: when the queue is non-empty or the browser is offline, the displayed chip state is `offline` regardless of what Autosaver thinks.

## 4. Queue entry shape

```ts
export interface QueueEntry {
  id: string;            // crypto.randomUUID() — idempotency + log stability
  timestamp: number;     // Date.now() — sortable debug aid
  payload: PostVoteInput;  // self-contained; roomId, userId, contestantId, scores, etc.
}
```

Queue is an array of `QueueEntry`, JSON-serialized to `localStorage.emx_offline_queue`. Global (not per-room) — matches SPEC §8.5 literal key name. Per-room filtering happens at drain time (not needed since each entry carries its own `roomId`).

## 5. `OfflineAdapter` — the wrapper class

### Public API

```ts
export interface OfflineAdapterState {
  online: boolean;
  queueSize: number;
}

export interface OfflineAdapterDeps {
  realPost: (p: PostVoteInput) => Promise<PostVoteResult>;
  storage: Storage | null;
  onStateChange: (state: OfflineAdapterState) => void;
  isOnline?: () => boolean;                           // default: () => navigator.onLine
  addOnlineListener?: (cb: () => void) => () => void; // default: wraps window.addEventListener('online')
}

export class OfflineAdapter {
  constructor(deps: OfflineAdapterDeps);

  /** The wrapped post. Signature matches Autosaver's expected `post` dep. */
  post(payload: PostVoteInput): Promise<PostVoteResult>;

  dispose(): void;
}
```

### Decision matrix for `post`

| `isOnline()` | queueSize | Behaviour |
|---|---|---|
| false | any | Enqueue. Return `{ ok: true }`. Emit state. |
| true | > 0 | Enqueue (linearize with pending drain). Kick off drain. Return `{ ok: true }`. |
| true | 0 | Call `realPost`. On success: return it. On network throw: enqueue + return `{ ok: true }`. On `{ ok: false }` (4xx/5xx): **pass through** so Autosaver flips to `error`. |

### Drain loop

- Triggered by `online` event **and** opportunistically on any successful post attempt (for the rare case where `navigator.onLine` never went to false — pure network blip).
- Serial FIFO: pop head, call `realPost(entry.payload)`.
- On `ok: true`: remove entry, re-write localStorage, emit state, continue.
- On `ok: false`: log, **remove entry anyway** (4xx/5xx is an app-level bug, retry won't help), continue. PR 3 can revisit once conflicts land.
- On throw: stop; wait for next `online` event or next user write.
- `draining` boolean guards against overlapping drains.

### Crash safety

Each entry is removed from localStorage only after its POST resolves. If the tab crashes mid-drain, unsent entries remain. Next mount reads them and re-attempts. POSTs are idempotent upserts on `(room, user, contestant)`, so retries are safe.

### `dispose()`

Removes the `online` listener. Drops in-flight drain reference (promises resolve into no-ops because the listener-removal + state subscriber are detached). Does **not** clear the queue — next mount picks it up.

## 6. `useVoteAutosave` changes

```ts
export type DisplaySaveStatus = SaveStatus | "offline";

export interface UseVoteAutosaveResult {
  onScoreChange: (contestantId: string, categoryName: string, next: number | null) => void;
  status: DisplaySaveStatus;           // was SaveStatus
  offlineBannerVisible: boolean;        // NEW
}
```

Hook instantiates an `OfflineAdapter` alongside the `Autosaver`:
1. `adapter = new OfflineAdapter({ realPost: postVote, storage: window.localStorage, onStateChange: setAdapterState, ... })`
2. `saver = new Autosaver(roomId, userId, { post: adapter.post.bind(adapter), onStatusChange: setAutosaverStatus })`
3. `status = (adapterState.queueSize > 0 || !adapterState.online) ? "offline" : autosaverStatus`
4. `offlineBannerVisible = !adapterState.online`

Both are re-created in the same `useEffect` whose cleanup calls `dispose()` on both.

## 7. `SaveChip` changes

```tsx
export interface SaveChipProps {
  status: DisplaySaveStatus;  // wider union now
}
```

Add a new branch:

```tsx
if (status === "offline") {
  return (
    <span className="text-xs font-medium text-accent" aria-live="polite">
      Offline — changes queued
    </span>
  );
}
```

`text-accent` (hot-pink in both themes) distinguishes it from the gold `saved` and muted `saving`. Distinct from destructive-red `error` so users can tell "network issue" apart from "something's wrong with your data".

## 8. `OfflineBanner` component

```tsx
"use client";

export interface OfflineBannerProps {
  visible: boolean;
}

export default function OfflineBanner({ visible }: OfflineBannerProps) {
  if (!visible) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-10 w-full bg-accent text-accent-foreground text-center px-4 py-2 text-sm font-medium"
    >
      You&rsquo;re offline — changes will sync when you reconnect.
    </div>
  );
}
```

Placed as the **first child** inside `<main>` in `VotingView`. `sticky top-0 z-10` keeps it visible during scroll. `bg-accent` matches the chip's offline styling.

## 9. `VotingView` changes

Add optional prop `offlineBannerVisible?: boolean`; render `<OfflineBanner visible={offlineBannerVisible} />` at the top of `<main>`.

## 10. `page.tsx` changes

Thread the new `offlineBannerVisible` from the hook:

```tsx
<VotingView
  ...existing
  offlineBannerVisible={autosave.offlineBannerVisible}
/>
```

## 11. Testing

### `offlineQueue.test.ts` — 8 cases

1. Empty queue on fresh read (nothing in storage)
2. Load parses valid JSON array
3. Load returns empty array when JSON malformed (silent recovery)
4. Save serializes array under `emx_offline_queue`
5. `enqueue` appends
6. `shift` removes head; returns undefined on empty
7. Null storage → load returns empty, save is no-op, no throw
8. Throwing storage (quota) → save is silent no-op

### `offlineAdapter.test.ts` — 12 cases

1. **Online + empty queue + real post succeeds** → calls realPost, returns its result; no enqueue.
2. **Online + empty queue + real post 4xx** → passes through `ok: false`; no enqueue.
3. **Online + empty queue + real post throws** → enqueues; returns `{ ok: true }`; emits state.
4. **Offline** → always enqueues regardless of queue size.
5. **Online + non-empty queue** → enqueues new payload without calling realPost; triggers drain.
6. **Drain: single entry succeeds** → clears entry, emits queueSize=0.
7. **Drain: entry throws** → stops, leaves entry in queue, next `online` event resumes.
8. **Drain: entry ok:false (4xx/5xx)** → removes entry (don't retry app bugs), continues.
9. **`online` event while queue non-empty** → triggers drain.
10. **`dispose()`** → removes listener; subsequent post still works but no state emissions.
11. **Pre-existing queue at construction** → state initialized with queueSize from storage.
12. **Drain serializes** — two rapid posts while queue non-empty both append, drain processes in order.

### Hook / SaveChip / VotingView / OfflineBanner
No new unit tests. Visual correctness is manually verified. Conditional JSX is thin; no extractable logic beyond what's already tested in the adapter.

### Manual verification
1. Create + join room, start voting. Score a few — chip goes `Saving…` → `✓ Saved`.
2. DevTools → Network → Offline. Tap a score.
3. Expected: banner appears at top; chip shows `Offline — changes queued`. DevTools → Application → Local Storage → `emx_offline_queue` key has entries.
4. Re-enable network.
5. Expected: `online` event fires, drain runs, queue empties, banner disappears, chip returns to `✓ Saved`. Network tab shows the queued POSTs firing in order.
6. Reload mid-offline: queue persists; on reload the banner re-appears and drain tries again once online.

## 12. Non-obvious decisions (flagged)

1. **Queue is the single write path when non-empty.** Writes during drain go to the tail of the queue rather than firing in parallel. Linearizes ordering; avoids old-queue vs new-live interleaving that would force PR-3 conflict logic into PR 2.
2. **4xx/5xx entries are dropped, not retried.** PR 2's queue is for transient network issues. App-level errors are permanent — retrying forever in the queue would accumulate junk. Acceptable data loss for MVP; PR 3 can revisit with proper conflict handling.
3. **Global queue, not per-room.** SPEC §8.5 wording (singular key name) + drain doesn't care about scope since each entry carries its own roomId.
4. **`text-accent` (pink) for offline chip, not `text-destructive`.** "Offline" isn't an error — it's a temporary network state. Pink matches the banner; red stays for genuine app failures.
5. **Autosaver stays unchanged.** The adapter lies by omission when it queues (returns `ok: true` — from the user's perspective, their data IS safely held). Truth layering happens in the hook. Keeps concerns separate; makes PR 3's conflict code a new adapter layer instead of a rewrite.
6. **No backoff.** Opportunistic retry on next write + `online` event covers the common cases. Exponential-backoff retry adds complexity without value for MVP.

## 13. Follow-ups

- PR 3: conflict reconciliation (§8.5.1) + consolidated toast + 200-entry cap + status-transition abort + server-wins reconciliation when drained entry's `updated_at` predates server row.
- "Network blip without navigator offline event" handling — currently covered by try/catch fallback in `post`. Document as known behaviour.
- Consider moving the banner's sticky behaviour to the page level if other screens need it (currently only voting has offline-aware writes).
