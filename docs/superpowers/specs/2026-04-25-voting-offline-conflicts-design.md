# Design: voting autosave — PR 3 of 3 (conflicts + 200-cap + voting-ended abort)

**Date:** 2026-04-25
**Phase:** 3 / closes the SPEC §8.5 autosave trio
**Depends on:** PR #22 (autosave 1/3 — debounce + post + chip), PR #25 (autosave 2/3 — offline queue + banner)
**SPEC refs:** §8.5.1 (conflict reconciliation), §8.5.2 (offline vs status transitions), §8.5.3 (200-entry cap)

---

## 1. Goal

Close the autosave trio by adding the three pieces deliberately deferred from PR 2:

1. **Server-wins conflict reconciliation.** When a queued offline write's timestamp predates the server's row, discard the queued delta and surface a consolidated `DrainNotice` after drain completes.
2. **200-entry queue cap.** Evict oldest entries on overflow; render a persistent overflow banner while at cap.
3. **Voting-ended abort.** First `409 ROOM_NOT_VOTING` during drain → drop all queue entries for that `roomId`, show a one-shot notice, continue draining other rooms.

## 2. Scope

### In scope
- `src/lib/rooms/get.ts` — add `updatedAt: string` to `VoteView` (server already returns it from upsert; we extend the read endpoint shape).
- `src/lib/voting/conflictCheck.ts` — pure partition helper.
- `src/lib/voting/OfflineAdapter.ts` — extend with: (a) `fetchServerVotes` dep called at drain start, (b) conflict partition + skip recording, (c) 409 ROOM_NOT_VOTING handling, (d) 200-cap on enqueue, (e) new state subscriptions.
- `src/components/voting/DrainNotice.tsx` — inline notice for skipped-conflicts and voting-ended summaries.
- `src/components/voting/QueueOverflowBanner.tsx` — banner shown while queue at cap.
- `src/components/voting/useVoteAutosave.ts` — wire `fetchServerVotes`; expose `drainNotice`, `dismissDrainNotice`, `queueOverflow`.
- `src/components/voting/VotingView.tsx` — render the new pieces.
- `src/app/room/[id]/page.tsx` — provide a `fetchServerVotes(roomId, userId)` callback that wraps `fetchRoomData`.

### Out of scope
- **Spec §8.5.1's tap-for-details modal.** Using inline-expand on the same `DrainNotice` instead — simpler, still informative. Modal as a future UX refinement.
- **`queuedAtRoomStatus` snapshot from spec §8.5.2.** Superseded by 409 detection — same observable behaviour, no extra plumbing.
- **Rejoin-token verification on GET endpoint.** Cross-cutting follow-up across all endpoints.
- **Per-user / per-tab cause attribution.** The notice says "newer values on the server" without identifying which device/tab produced them.

## 3. Architecture

```
┌─────────────────────────────────────────┐
│   VotingView                             │
│   ┌─ OfflineBanner ── (PR 2) ────────┐  │
│   ┌─ QueueOverflowBanner ── NEW ────┐  │
│   ┌─ DrainNotice ── NEW ────────────┐  │
│   ┌─ SaveChip + ScoreRows + nav ───┐  │
└─────────────────────────────────────────┘
            ▲
            │ props
┌───────────┴──────────────────────┐
│   useVoteAutosave (extended)     │
│   - exposes drainNotice          │
│   - exposes dismissDrainNotice   │
│   - exposes queueOverflow        │
└────────────┬─────────────────────┘
             │ owns
┌────────────┴───────────────────────────────┐
│   OfflineAdapter (extended)                │
│   + fetchServerVotes dep                   │
│   + drainStartHook → fetch + partition     │
│   + onDrainComplete → emit notice          │
│   + 409 ROOM_NOT_VOTING → abort + notice   │
│   + 200-cap enforcement on enqueue         │
└────────────────────────────────────────────┘
            │
            ▼
        realPost (postVote)
```

Existing `Autosaver` and `OfflineQueue` helpers are unchanged. Conflict logic lives in a new pure helper called from inside `drain()`.

## 4. Server-side change

### `VoteView` extension

Edit `src/lib/rooms/get.ts`:

```ts
export interface VoteView {
  contestantId: string;
  scores: Record<string, number | null> | null;
  missed: boolean;
  hotTake: string | null;
  updatedAt: string;  // NEW — ISO timestamp from DB
}
```

The query already SELECTs `updated_at`-equivalent fields by virtue of `select("*")` … actually wait, the current `getRoom` selects specific columns:

```ts
.select("contestant_id, scores, missed, hot_take")
```

Add `, updated_at` to that list, then map `row.updated_at` into `vote.updatedAt`. Trivial.

### Update `get.test.ts`

The "happy path: maps vote rows to VoteView" test gains a `updatedAt` assertion. Existing fixtures need an `updated_at` field on the mock vote rows.

## 5. `conflictCheck` — pure helper

```ts
// src/lib/voting/conflictCheck.ts
import type { QueueEntry } from "@/lib/voting/offlineQueue";

export interface SkippedEntry {
  entry: QueueEntry;
  reason: "server-newer";
}

export interface ConflictCheckResult {
  drainable: QueueEntry[];
  skipped: SkippedEntry[];
}

/**
 * Partitions queue entries into drainable and skipped. An entry is skipped
 * when the server has a newer `updatedAt` for the same `(roomId, contestantId)`
 * than the entry's `timestamp`. Server-state map keys are
 * `${roomId}::${contestantId}`.
 *
 * SPEC §8.5.1 — server-wins.
 */
export function partitionByConflict(
  entries: readonly QueueEntry[],
  serverState: ReadonlyMap<string, string>
): ConflictCheckResult;
```

The string-key map (`${roomId}::${contestantId}` → ISO updatedAt) keeps the helper simple. Caller builds the map.

### Comparison logic

```ts
const key = `${entry.payload.roomId}::${entry.payload.contestantId}`;
const serverUpdatedAt = serverState.get(key);
if (!serverUpdatedAt) return drainable;  // no server row yet → no conflict
const serverMs = Date.parse(serverUpdatedAt);
if (!Number.isFinite(serverMs)) return drainable;  // bad timestamp → don't block
if (serverMs > entry.timestamp) return skipped;
return drainable;
```

Clock-skew note: queue entries' `timestamp` is `Date.now()` at enqueue (client clock). Server `updatedAt` is `NOW()` at upsert (DB clock). Skew of a few seconds could produce false-positive conflicts (discard a legit write). Acceptable trade-off; flagged in code comment.

### Tests (8 cases)

1. Empty entries → `{ drainable: [], skipped: [] }`
2. Empty server state → all entries drainable
3. Single conflict — server newer → that one skipped
4. Single non-conflict — server older → drainable
5. Multiple entries, mixed — partitioned correctly
6. Server has no entry for a queued (room, contestant) → drainable (treat as new-row case)
7. Server `updatedAt` malformed → drainable (defensive)
8. Same (room, contestant) appearing twice in queue with different timestamps → both compared independently against server

## 6. `OfflineAdapter` extensions

### New deps

```ts
export interface OfflineAdapterDeps {
  ...existing
  /** Fetches server's current votes for one (roomId, userId) — used at drain start to detect conflicts. Optional for backwards compat with PR 2 tests. */
  fetchServerVotes?: (
    roomId: string,
    userId: string
  ) => Promise<{ contestantId: string; updatedAt: string }[]>;

  /** Max queue size before FIFO eviction. Default 200. */
  maxQueueSize?: number;

  /** Fired when a drain completes with skipped entries OR a voting-ended abort. */
  onDrainComplete?: (notice: DrainNotice | null) => void;
}
```

### `enqueue` — 200-cap

```ts
private enqueue(payload: PostVoteInput): void {
  const entry = makeEntry(...);
  let next = appendToQueue(this.storage, entry);
  let evicted = 0;
  while (next.length > this.maxQueueSize) {
    const { rest } = shiftFromQueue(this.storage);
    next = rest;
    evicted += 1;
  }
  this.queueSize = next.length;
  this.overflowed = this.overflowed || evicted > 0;
  this.startPolling();
  this.emitState();
}
```

Overflow flag is sticky once tripped — clears only when queue drops below cap during drain (consistent with banner UX: "oldest may be lost; reconnect to save"). Banner stays visible until queue is below 200, signalling there's still buffered work.

### `drain()` — three-phase loop

```ts
private async drain(): Promise<void> {
  if (this.draining || this.disposed || !this.isOnlineFn()) return;
  this.draining = true;
  try {
    const allEntries = loadQueue(this.storage);
    if (allEntries.length === 0) return;

    // Phase 1: per-room conflict check
    const skipped: SkippedEntry[] = [];
    const serverState = new Map<string, string>();
    if (this.fetchServerVotes) {
      const roomUserPairs = uniqueRoomUserPairs(allEntries);
      for (const [roomId, userId] of roomUserPairs) {
        try {
          const votes = await this.fetchServerVotes(roomId, userId);
          for (const v of votes) {
            serverState.set(`${roomId}::${v.contestantId}`, v.updatedAt);
          }
        } catch {
          // Network failure during pre-drain fetch — abort drain entirely;
          // poll will retry. Conflict check is best-effort.
          return;
        }
      }
    }
    const partition = partitionByConflict(allEntries, serverState);
    skipped.push(...partition.skipped);
    // Persist queue with only drainable entries (drop skipped silently)
    saveQueue(this.storage, partition.drainable);

    // Phase 2: drain drainable, watching for 409 ROOM_NOT_VOTING per-room
    const votingEndedRooms = new Set<string>();
    while (!this.disposed && this.isOnlineFn()) {
      const current = loadQueue(this.storage);
      if (current.length === 0) break;
      const head = current[0];

      // If we've already detected voting-ended for this room, drop without POSTing
      if (votingEndedRooms.has(head.payload.roomId)) {
        shiftFromQueue(this.storage);
        continue;
      }

      let drop = false;
      let dropAllForRoom = false;
      try {
        const result = await this.realPost(head.payload);
        drop = true;
        if (!result.ok && result.code === "ROOM_NOT_VOTING") {
          dropAllForRoom = true;
          votingEndedRooms.add(head.payload.roomId);
        }
        if (result.ok && result.data) {
          // Update server-state map with response's updatedAt
          // (vote.updatedAt) — extends conflict info into subsequent entries.
        }
      } catch {
        break;  // network error during drain → stop, poll will retry
      }

      if (dropAllForRoom) {
        // Drop head + all subsequent entries with same roomId
        const remaining = loadQueue(this.storage)
          .filter((e) => e.payload.roomId !== head.payload.roomId);
        saveQueue(this.storage, remaining);
        this.queueSize = remaining.length;
        this.emitState();
      } else if (drop) {
        const { rest } = shiftFromQueue(this.storage);
        this.queueSize = rest.length;
        this.emitState();
      }
    }

    // Phase 3: emit drain-complete notice
    if (skipped.length > 0 || votingEndedRooms.size > 0) {
      this.onDrainComplete?.({
        skipped,
        votingEndedRoomIds: Array.from(votingEndedRooms),
      });
    }

    // 200-cap banner: clear sticky flag once queue drops below cap
    if (this.queueSize < this.maxQueueSize) {
      this.overflowed = false;
      this.emitState();
    }
  } finally {
    this.draining = false;
    if (this.queueSize === 0) this.stopPolling();
  }
}
```

Phase 1 fetch failure aborts drain (not the whole adapter). Polling retries. The `serverState` map is built once per drain attempt; subsequent in-flight POSTs update it via the response's `vote.updatedAt`.

### `OfflineAdapterState` widen

```ts
export interface OfflineAdapterState {
  online: boolean;
  queueSize: number;
  overflowed: boolean;  // NEW
}
```

## 7. `DrainNotice` shape

```ts
// src/lib/voting/OfflineAdapter.ts
export interface DrainNotice {
  /** Entries silently dropped because server had newer values. */
  skipped: SkippedEntry[];
  /** Rooms where draining hit ROOM_NOT_VOTING; entries for these rooms were dropped. */
  votingEndedRoomIds: string[];
}
```

The hook stores the latest non-null notice and exposes `dismissDrainNotice` to clear it.

### `DrainNotice.tsx` UI

```tsx
"use client";
import { useState } from "react";
import type { DrainNotice as DrainNoticePayload } from "@/lib/voting/OfflineAdapter";

export interface DrainNoticeProps {
  notice: DrainNoticePayload | null;
  onDismiss: () => void;
}

export default function DrainNotice({ notice, onDismiss }: DrainNoticeProps) {
  const [expanded, setExpanded] = useState(false);
  if (!notice) return null;

  const skippedCount = notice.skipped.length;
  const endedCount = notice.votingEndedRoomIds.length;

  if (endedCount > 0) {
    return (
      <NoticeContainer onDismiss={onDismiss}>
        Voting ended while you were offline — your unsaved changes for this room
        were discarded.
      </NoticeContainer>
    );
  }
  if (skippedCount === 0) return null;

  return (
    <NoticeContainer onDismiss={onDismiss}>
      <span>
        {skippedCount} offline edit{skippedCount === 1 ? "" : "s"} couldn’t be
        applied (newer values on the server).
      </span>
      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="ml-2 underline text-accent"
        >
          View
        </button>
      )}
      {expanded && (
        <ul className="mt-2 list-disc pl-5 text-xs">
          {notice.skipped.map((s) => (
            <li key={s.entry.id}>
              {s.entry.payload.contestantId}{" "}
              {s.entry.payload.scores
                ? `(${Object.keys(s.entry.payload.scores).join(", ")})`
                : ""}
            </li>
          ))}
        </ul>
      )}
    </NoticeContainer>
  );
}
```

`NoticeContainer` styles match `OfflineBanner` (sticky-top, rounded, accent-pink, dismissible × button). Copy/paste-light — could share container styles via a tiny wrapper or keep separate for clarity. Going with **separate small components** (DRY-violation tolerated; the styles are short).

## 8. `QueueOverflowBanner.tsx`

```tsx
export interface QueueOverflowBannerProps {
  visible: boolean;
}

export default function QueueOverflowBanner({ visible }: QueueOverflowBannerProps) {
  if (!visible) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-2 mx-4 z-10 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-center px-4 py-2 text-sm font-medium backdrop-blur-sm"
    >
      Too many offline changes — oldest may be lost. Reconnect to save.
    </div>
  );
}
```

Uses `destructive` token (red-tinted) instead of accent-pink to distinguish from offline state — this is "data loss is happening" severity.

## 9. Hook composition update

```ts
export interface UseVoteAutosaveResult {
  ...existing
  drainNotice: DrainNoticePayload | null;
  dismissDrainNotice: () => void;
  queueOverflow: boolean;
}
```

Inside `useVoteAutosave`:

```ts
const [drainNotice, setDrainNotice] = useState<DrainNoticePayload | null>(null);
const [adapterState, setAdapterState] = useState<OfflineAdapterState>({
  online: true,
  queueSize: 0,
  overflowed: false,
});

const adapter = new OfflineAdapter({
  ...existing,
  fetchServerVotes: params.fetchServerVotes,
  onDrainComplete: setDrainNotice,
});
```

`fetchServerVotes` is a new optional hook param — page provides it.

## 10. Page provides `fetchServerVotes`

```ts
const fetchServerVotes = useCallback(
  async (roomId: string, userId: string) => {
    const result = await fetchRoomData(roomId, userId, {
      fetch: window.fetch.bind(window),
    });
    if (!result.ok || !result.data) return [];
    const votes = (result.data.votes ?? []) as Array<{
      contestantId: string;
      updatedAt: string;
    }>;
    return votes.map((v) => ({
      contestantId: v.contestantId,
      updatedAt: v.updatedAt,
    }));
  },
  []
);
```

Threaded into `useVoteAutosave`. The fetch is keyed on `(roomId, userId)`, not the live `phase.room.id`, so it works for queue entries from previous rooms too.

## 11. Test plan

### `conflictCheck.test.ts` — 8 cases (per §5)

### `OfflineAdapter.test.ts` — extend with ~8 cases:
1. Drain with no conflicts and no `fetchServerVotes` → behaves as PR 2 (back-compat).
2. Drain with `fetchServerVotes` returning empty → all drainable.
3. Drain with `fetchServerVotes` returning newer `updatedAt` → entry dropped, notice fired.
4. `fetchServerVotes` throws → drain aborts; queue retained; no notice.
5. Mixed: 3 entries, 1 conflict → 2 drained, 1 skipped, notice with 1 skipped.
6. 409 ROOM_NOT_VOTING on first POST → drops all entries for that roomId, notice fired with `votingEndedRoomIds`.
7. 200-cap: enqueueing 201 items → first one evicted, `overflowed: true` emitted.
8. Overflowed → drain succeeds → `overflowed: false` re-emitted once queue < cap.

### `get.test.ts` — extend the "happy path: maps vote rows" case to assert `updatedAt`.

### Skipped: hook, components, page wiring.

## 12. Non-obvious decisions (flagged)

1. **Conflict check is best-effort.** Network failure during pre-drain fetch aborts the drain rather than falling through to a "no server state known" path — would risk overwriting server with stale data.
2. **Server-state map updated mid-drain.** After each successful POST, the response's `vote.updatedAt` updates the map so subsequent same-row entries get fresh-state comparison without an extra fetch.
3. **`queuedAtRoomStatus` snapshot omitted.** Spec §8.5.2 mentions it; we use 409 detection instead. Functionally equivalent, less plumbing.
4. **Overflow banner is sticky-once-tripped per drain.** Clears when queue drops below cap during drain. Aligns with the spec copy ("oldest may be lost").
5. **Inline expand instead of modal for conflict details.** Spec wants modal-on-tap; inline is simpler and the list is short (typically <10 items). Modal as future refinement.
6. **`fetchServerVotes` is optional on the adapter.** Existing PR 2 tests don't provide it; back-compat preserved.
7. **Drop-skipped-silently before drain loop.** Once `partitionByConflict` runs, skipped entries are removed from localStorage immediately (not deferred to drain-loop end). Avoids re-comparing them on a subsequent drain attempt that fails before completing.

## 13. Follow-ups

- Modal-on-tap for the consolidated conflict notice (§8.5.1 "Tapping opens a modal listing the contestant + category for each skipped write").
- Per-tab/device attribution in the conflict notice ("from another device", "from another tab").
- `voting_ending` status handling for graceful end-of-voting transitions (post-R0 migration).
