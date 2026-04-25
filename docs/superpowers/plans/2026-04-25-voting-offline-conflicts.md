# Voting Autosave — PR 3 of 3 Implementation Plan (Conflicts + Cap + Abort)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the SPEC §8.5 autosave trio: server-wins conflict reconciliation, 200-entry queue cap with FIFO eviction, and voting-ended abort triggered by `409 ROOM_NOT_VOTING` during drain.

**Architecture:** Server-side: extend `VoteView` with `updatedAt` (one-line addition). Client-side: new pure `partitionByConflict` helper; `OfflineAdapter` gains a `fetchServerVotes` dep called at drain start, in-memory server-state map, 200-cap enforcement on enqueue, and 409-aware drain loop. Two new components (`DrainNotice`, `QueueOverflowBanner`) and a hook surface widen.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Vitest (node env — fake timers + injected fetch/storage/intervals).

Design: [docs/superpowers/specs/2026-04-25-voting-offline-conflicts-design.md](../specs/2026-04-25-voting-offline-conflicts-design.md) — read it first.

---

## File structure

| Path | Kind | Responsibility |
|---|---|---|
| `src/lib/rooms/get.ts` | modify | Add `updatedAt` to `VoteView` interface; include `updated_at` in SELECT; map into VoteView |
| `src/lib/rooms/get.test.ts` | modify | Update vote-row fixtures with `updated_at`; assert `updatedAt` flows into result |
| `src/lib/voting/conflictCheck.ts` | **new** | Pure `partitionByConflict(entries, serverState)` helper + types |
| `src/lib/voting/conflictCheck.test.ts` | **new** | 8 unit tests |
| `src/lib/voting/OfflineAdapter.ts` | modify | Add `fetchServerVotes`, `maxQueueSize`, `onDrainComplete` deps; add `overflowed` state; 200-cap on enqueue; conflict partition at drain start; 409 ROOM_NOT_VOTING handling; new `DrainNotice` type |
| `src/lib/voting/OfflineAdapter.test.ts` | modify | Add ~8 cases: back-compat, conflict partition, fetch failure, mixed, 409 abort, 200-cap, overflow flag clear |
| `src/components/voting/DrainNotice.tsx` | **new** | Inline notice with conflict + voting-ended variants, dismiss × |
| `src/components/voting/QueueOverflowBanner.tsx` | **new** | Sticky destructive-tinted banner |
| `src/components/voting/useVoteAutosave.ts` | modify | Accept `fetchServerVotes` param; expose `drainNotice`, `dismissDrainNotice`, `queueOverflow` |
| `src/components/voting/VotingView.tsx` | modify | Render `DrainNotice` + `QueueOverflowBanner` at top; accept matching props |
| `src/app/room/[id]/page.tsx` | modify | Pass a memoized `fetchServerVotes` callback into the hook; thread the new props into `VotingView` |

**Not touched:** `Autosaver.ts`, `postVote.ts`, `offlineQueue.ts`, `SaveChip.tsx`, `OfflineBanner.tsx`, `seedScoresFromVotes.ts`, route handlers.

---

## Task 1: Add `updatedAt` to `VoteView`

**Files:**
- Modify: `src/lib/rooms/get.ts`
- Modify: `src/lib/rooms/get.test.ts`

Server-side change is minimal — add a column to the SELECT and a field to the mapped shape.

- [ ] **Step 1.1: Update fixtures + assertion in the existing happy-path test**

Open `src/lib/rooms/get.test.ts`. Find the "maps vote rows to VoteView and returns them when userId matches" test (around line 530+). It currently builds a `votesResult.data` with rows missing `updated_at`. Add `updated_at` to both rows and add a `updatedAt` field to the expected output.

Find:

```ts
        data: [
          {
            contestant_id: "2026-ua",
            scores: { Vocals: 7, Staging: 9 },
            missed: false,
            hot_take: "iconic",
          },
          {
            contestant_id: "2026-se",
            scores: null,
            missed: true,
            hot_take: null,
          },
        ],
```

Replace with:

```ts
        data: [
          {
            contestant_id: "2026-ua",
            scores: { Vocals: 7, Staging: 9 },
            missed: false,
            hot_take: "iconic",
            updated_at: "2026-04-25T12:00:00Z",
          },
          {
            contestant_id: "2026-se",
            scores: null,
            missed: true,
            hot_take: null,
            updated_at: "2026-04-25T12:01:00Z",
          },
        ],
```

Find the matching expectation:

```ts
    expect(result.data.votes).toEqual([
      {
        contestantId: "2026-ua",
        scores: { Vocals: 7, Staging: 9 },
        missed: false,
        hotTake: "iconic",
      },
      {
        contestantId: "2026-se",
        scores: null,
        missed: true,
        hotTake: null,
      },
    ]);
```

Replace with:

```ts
    expect(result.data.votes).toEqual([
      {
        contestantId: "2026-ua",
        scores: { Vocals: 7, Staging: 9 },
        missed: false,
        hotTake: "iconic",
        updatedAt: "2026-04-25T12:00:00Z",
      },
      {
        contestantId: "2026-se",
        scores: null,
        missed: true,
        hotTake: null,
        updatedAt: "2026-04-25T12:01:00Z",
      },
    ]);
```

- [ ] **Step 1.2: Run tests — confirm RED**

Run: `npx vitest run src/lib/rooms/get.test.ts`
Expected: that one test FAILs (returned objects lack `updatedAt`); other cases still pass.

- [ ] **Step 1.3: Update `VoteView` interface**

Open `src/lib/rooms/get.ts`. Find:

```ts
export interface VoteView {
  contestantId: string;
  scores: Record<string, number | null> | null;
  missed: boolean;
  hotTake: string | null;
}
```

Replace with:

```ts
export interface VoteView {
  contestantId: string;
  scores: Record<string, number | null> | null;
  missed: boolean;
  hotTake: string | null;
  updatedAt: string;
}
```

- [ ] **Step 1.4: Update SELECT + mapping**

Find:

```ts
      .select("contestant_id, scores, missed, hot_take")
```

Replace with:

```ts
      .select("contestant_id, scores, missed, hot_take, updated_at")
```

Find the row mapping:

```ts
      votes = (votesQuery.data as Array<{
        contestant_id: string;
        scores: Record<string, number | null> | null;
        missed: boolean;
        hot_take: string | null;
      }>).map((row) => ({
        contestantId: row.contestant_id,
        scores: row.scores,
        missed: row.missed,
        hotTake: row.hot_take,
      }));
```

Replace with:

```ts
      votes = (votesQuery.data as Array<{
        contestant_id: string;
        scores: Record<string, number | null> | null;
        missed: boolean;
        hot_take: string | null;
        updated_at: string;
      }>).map((row) => ({
        contestantId: row.contestant_id,
        scores: row.scores,
        missed: row.missed,
        hotTake: row.hot_take,
        updatedAt: row.updated_at,
      }));
```

- [ ] **Step 1.5: Run tests — confirm GREEN**

Run: `npx vitest run src/lib/rooms/get.test.ts`
Expected: all cases pass.

Run: `npm run type-check`
Expected: zero errors.

- [ ] **Step 1.6: Commit**

```bash
git add src/lib/rooms/get.ts src/lib/rooms/get.test.ts
git commit -m "$(cat <<'EOF'
getRoom: include updatedAt in VoteView

Adds the row's updated_at to the SELECT and exposes it on VoteView so
clients can detect server-newer-than-queued conflicts at drain time.
DB column already exists; this is a one-line read-side change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `conflictCheck` pure helper + tests

**Files:**
- Create: `src/lib/voting/conflictCheck.ts`
- Create: `src/lib/voting/conflictCheck.test.ts`

- [ ] **Step 2.1: Create the stub**

Create `src/lib/voting/conflictCheck.ts`:

```ts
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
 * than the entry's `timestamp`.
 *
 * Server-state map keys are `${roomId}::${contestantId}` → ISO updatedAt.
 *
 * SPEC §8.5.1 — server-wins.
 *
 * Notes:
 * - Missing server state for a (room, contestant) → drainable (new-row case).
 * - Malformed server timestamp → drainable (defensive; don't block legit writes).
 * - Clock-skew tolerance: queue.timestamp is client clock, server.updatedAt is
 *   DB clock. A few seconds of skew can produce false-positive conflicts;
 *   acceptable trade-off (we drop a legit write, which the user can re-enter).
 */
export function partitionByConflict(
  _entries: readonly QueueEntry[],
  _serverState: ReadonlyMap<string, string>
): ConflictCheckResult {
  throw new Error("not implemented");
}

export function makeServerStateKey(
  roomId: string,
  contestantId: string
): string {
  return `${roomId}::${contestantId}`;
}
```

- [ ] **Step 2.2: Write failing tests**

Create `src/lib/voting/conflictCheck.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  partitionByConflict,
  makeServerStateKey,
} from "@/lib/voting/conflictCheck";
import type { QueueEntry } from "@/lib/voting/offlineQueue";

const ROOM_A = "11111111-2222-4333-8444-555555555555";
const ROOM_B = "11111111-2222-4333-8444-666666666666";
const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function entry(
  contestantId: string,
  timestamp: number,
  roomId = ROOM_A
): QueueEntry {
  return {
    id: `${roomId}-${contestantId}-${timestamp}`,
    timestamp,
    payload: {
      roomId,
      userId: USER,
      contestantId,
      scores: { Vocals: 7 },
    },
  };
}

describe("partitionByConflict", () => {
  it("returns empty result for empty entries", () => {
    expect(partitionByConflict([], new Map())).toEqual({
      drainable: [],
      skipped: [],
    });
  });

  it("treats every entry as drainable when server state is empty", () => {
    const e1 = entry("2026-ua", 1000);
    const e2 = entry("2026-se", 2000);
    const result = partitionByConflict([e1, e2], new Map());
    expect(result.drainable).toEqual([e1, e2]);
    expect(result.skipped).toEqual([]);
  });

  it("skips an entry whose timestamp is older than the server's updatedAt", () => {
    const e = entry("2026-ua", 1000);
    const server = new Map([
      [makeServerStateKey(ROOM_A, "2026-ua"), "2026-04-25T12:00:01.000Z"],
      // Date.parse("2026-04-25T12:00:01Z") = 1777291201000 — way after 1000
    ]);
    const result = partitionByConflict([e], server);
    expect(result.drainable).toEqual([]);
    expect(result.skipped).toEqual([{ entry: e, reason: "server-newer" }]);
  });

  it("keeps an entry whose timestamp is newer than the server's updatedAt", () => {
    const e = entry("2026-ua", 9_999_999_999_999);
    const server = new Map([
      [makeServerStateKey(ROOM_A, "2026-ua"), "2026-04-25T12:00:00.000Z"],
    ]);
    const result = partitionByConflict([e], server);
    expect(result.drainable).toEqual([e]);
    expect(result.skipped).toEqual([]);
  });

  it("partitions a mixed batch correctly", () => {
    const stale = entry("2026-ua", 1000);
    const fresh = entry("2026-se", 9_999_999_999_999);
    const noServer = entry("2026-fr", 5000);
    const server = new Map([
      [makeServerStateKey(ROOM_A, "2026-ua"), "2026-04-25T12:00:01.000Z"],
      [makeServerStateKey(ROOM_A, "2026-se"), "2026-04-25T12:00:00.000Z"],
      // 2026-fr not in server → no conflict
    ]);
    const result = partitionByConflict([stale, fresh, noServer], server);
    expect(result.drainable).toEqual([fresh, noServer]);
    expect(result.skipped).toEqual([{ entry: stale, reason: "server-newer" }]);
  });

  it("treats no server entry for a (room, contestant) as no-conflict", () => {
    const e = entry("2026-fr", 1000);
    const result = partitionByConflict([e], new Map());
    expect(result.drainable).toEqual([e]);
  });

  it("treats malformed server timestamps as no-conflict (defensive)", () => {
    const e = entry("2026-ua", 1000);
    const server = new Map([
      [makeServerStateKey(ROOM_A, "2026-ua"), "not-a-date"],
    ]);
    const result = partitionByConflict([e], server);
    expect(result.drainable).toEqual([e]);
    expect(result.skipped).toEqual([]);
  });

  it("compares each entry independently when the same (room, contestant) appears twice", () => {
    const stale = entry("2026-ua", 1000);
    const fresh = entry("2026-ua", 9_999_999_999_999);
    const server = new Map([
      [makeServerStateKey(ROOM_A, "2026-ua"), "2026-04-25T12:00:01.000Z"],
    ]);
    const result = partitionByConflict([stale, fresh], server);
    expect(result.skipped).toEqual([{ entry: stale, reason: "server-newer" }]);
    expect(result.drainable).toEqual([fresh]);
  });

  it("scopes server state per-room (different roomIds with the same contestantId don't cross-pollute)", () => {
    const eA = entry("2026-ua", 1000, ROOM_A);
    const eB = entry("2026-ua", 1000, ROOM_B);
    const server = new Map([
      [makeServerStateKey(ROOM_A, "2026-ua"), "2026-04-25T12:00:01.000Z"],
      // ROOM_B has no server state
    ]);
    const result = partitionByConflict([eA, eB], server);
    expect(result.skipped).toEqual([{ entry: eA, reason: "server-newer" }]);
    expect(result.drainable).toEqual([eB]);
  });
});
```

- [ ] **Step 2.3: Run tests — confirm RED**

Run: `npx vitest run src/lib/voting/conflictCheck.test.ts`
Expected: 9 cases FAIL with `"not implemented"`.

- [ ] **Step 2.4: Implement the helper**

Replace the body of `partitionByConflict` in `src/lib/voting/conflictCheck.ts`:

```ts
export function partitionByConflict(
  entries: readonly QueueEntry[],
  serverState: ReadonlyMap<string, string>
): ConflictCheckResult {
  const drainable: QueueEntry[] = [];
  const skipped: SkippedEntry[] = [];
  for (const entry of entries) {
    const key = makeServerStateKey(
      entry.payload.roomId,
      entry.payload.contestantId
    );
    const serverUpdatedAt = serverState.get(key);
    if (!serverUpdatedAt) {
      drainable.push(entry);
      continue;
    }
    const serverMs = Date.parse(serverUpdatedAt);
    if (!Number.isFinite(serverMs)) {
      drainable.push(entry);
      continue;
    }
    if (serverMs > entry.timestamp) {
      skipped.push({ entry, reason: "server-newer" });
    } else {
      drainable.push(entry);
    }
  }
  return { drainable, skipped };
}
```

- [ ] **Step 2.5: Run tests — confirm GREEN**

Run: `npx vitest run src/lib/voting/conflictCheck.test.ts`
Expected: 9/9 pass.

- [ ] **Step 2.6: Commit**

```bash
git add src/lib/voting/conflictCheck.ts src/lib/voting/conflictCheck.test.ts
git commit -m "$(cat <<'EOF'
voting: conflictCheck partition helper + tests

Pure helper that splits queue entries into drainable and skipped,
based on whether the server's updatedAt for (roomId, contestantId) is
newer than the entry's timestamp. Defensive: missing server state and
malformed server timestamps both fall through as drainable.

9 tests cover empty/all-drainable/all-skipped/mixed/no-server-entry/
malformed-server/dup-row/per-room scoping.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extend `OfflineAdapter` — types + 200-cap

**Files:**
- Modify: `src/lib/voting/OfflineAdapter.ts`
- Modify: `src/lib/voting/OfflineAdapter.test.ts`

Three smaller sub-tasks: type widening, 200-cap on enqueue, then the drain-time conflict check + 409 abort. This task does the first two.

- [ ] **Step 3.1: Widen types**

Open `src/lib/voting/OfflineAdapter.ts`. At the top, add the new exported type:

```ts
import type { SkippedEntry } from "@/lib/voting/conflictCheck";

export interface DrainNotice {
  skipped: SkippedEntry[];
  votingEndedRoomIds: string[];
}
```

Replace the `OfflineAdapterState` interface:

```ts
export interface OfflineAdapterState {
  online: boolean;
  queueSize: number;
}
```

with:

```ts
export interface OfflineAdapterState {
  online: boolean;
  queueSize: number;
  overflowed: boolean;
}
```

Replace the `OfflineAdapterDeps` interface:

```ts
export interface OfflineAdapterDeps {
  realPost: (p: PostVoteInput) => Promise<PostVoteResult>;
  storage: QueueStorage | null;
  onStateChange: (state: OfflineAdapterState) => void;
  isOnline?: () => boolean;
  /** Listener for `online` event, window focus, visibility-becomes-visible — all are drain triggers. */
  addOnlineListener?: (cb: () => void) => () => void;
  now?: () => number;
  uuid?: () => string;
  /** Polling interval (ms) — drain attempted on a timer while queue is non-empty as a belt-and-suspenders fallback. Default 10000. Pass 0 to disable. */
  pollIntervalMs?: number;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
}
```

with:

```ts
export interface OfflineAdapterDeps {
  realPost: (p: PostVoteInput) => Promise<PostVoteResult>;
  storage: QueueStorage | null;
  onStateChange: (state: OfflineAdapterState) => void;
  isOnline?: () => boolean;
  /** Listener for `online` event, window focus, visibility-becomes-visible — all are drain triggers. */
  addOnlineListener?: (cb: () => void) => () => void;
  now?: () => number;
  uuid?: () => string;
  /** Polling interval (ms). Default 10000. Pass 0 to disable. */
  pollIntervalMs?: number;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
  /** Fetches server's current votes for one (roomId, userId) — used at drain start to detect conflicts. Optional for back-compat with PR 2 tests. */
  fetchServerVotes?: (
    roomId: string,
    userId: string
  ) => Promise<{ contestantId: string; updatedAt: string }[]>;
  /** Max queue size before FIFO eviction. Default 200. */
  maxQueueSize?: number;
  /** Fired when a drain completes with skipped entries OR a voting-ended abort. */
  onDrainComplete?: (notice: DrainNotice) => void;
}
```

- [ ] **Step 3.2: Add the corresponding instance fields + constructor wiring**

Find:

```ts
  private readonly setIntervalFn: typeof globalThis.setInterval;
  private readonly clearIntervalFn: typeof globalThis.clearInterval;
  private readonly pollIntervalMs: number;
  private pollTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  private queueSize: number;
  private draining = false;
  private disposed = false;
```

Add three fields immediately below:

```ts
  private readonly fetchServerVotes:
    | ((roomId: string, userId: string) => Promise<
        { contestantId: string; updatedAt: string }[]
      >)
    | null;
  private readonly maxQueueSize: number;
  private readonly onDrainComplete: ((notice: DrainNotice) => void) | null;
  private overflowed = false;
```

In the constructor, after `this.pollIntervalMs = …`:

```ts
    this.fetchServerVotes = deps.fetchServerVotes ?? null;
    this.maxQueueSize = deps.maxQueueSize ?? 200;
    this.onDrainComplete = deps.onDrainComplete ?? null;
```

Find `emitState()`:

```ts
  private emitState(): void {
    if (this.disposed) return;
    this.onStateChange({
      online: this.isOnlineFn(),
      queueSize: this.queueSize,
    });
  }
```

Replace with:

```ts
  private emitState(): void {
    if (this.disposed) return;
    this.onStateChange({
      online: this.isOnlineFn(),
      queueSize: this.queueSize,
      overflowed: this.overflowed,
    });
  }
```

- [ ] **Step 3.3: Update `enqueue` to enforce the 200-cap**

Find:

```ts
  private enqueue(payload: PostVoteInput): void {
    const entry: QueueEntry = {
      id: this.uuidFn(),
      timestamp: this.nowFn(),
      payload,
    };
    const next = appendToQueue(this.storage, entry);
    this.queueSize = next.length;
    this.startPolling();
    this.emitState();
  }
```

Replace with:

```ts
  private enqueue(payload: PostVoteInput): void {
    const entry: QueueEntry = {
      id: this.uuidFn(),
      timestamp: this.nowFn(),
      payload,
    };
    let next = appendToQueue(this.storage, entry);
    while (next.length > this.maxQueueSize) {
      const { rest } = shiftFromQueue(this.storage);
      next = rest;
      this.overflowed = true;
    }
    this.queueSize = next.length;
    this.startPolling();
    this.emitState();
  }
```

- [ ] **Step 3.4: Update existing tests for the new state shape**

Open `src/lib/voting/OfflineAdapter.test.ts`. Find every place state is asserted with `toMatchObject({ online: ..., queueSize: ... })`. There are two such assertions in PR 2's tests:

- "drain: single entry success → removes entry and emits queueSize=0"
- "offline post emits state with online: false and queueSize: 1"

Add `overflowed: false` to each. Find:

```ts
    expect(fx.states[fx.states.length - 1]).toMatchObject({
      online: true,
      queueSize: 0,
    });
```

Replace with:

```ts
    expect(fx.states[fx.states.length - 1]).toMatchObject({
      online: true,
      queueSize: 0,
      overflowed: false,
    });
```

And similarly for the other:

```ts
    expect(fx.states[fx.states.length - 1]).toMatchObject({
      online: false,
      queueSize: 1,
    });
```

Replace with:

```ts
    expect(fx.states[fx.states.length - 1]).toMatchObject({
      online: false,
      queueSize: 1,
      overflowed: false,
    });
```

- [ ] **Step 3.5: Add a 200-cap test**

Append at the end of the `describe("OfflineAdapter", ...)` block (before its closing `});`):

```ts
  it("200-cap: enqueueing past the cap evicts the oldest and emits overflowed: true", async () => {
    const fx = makeAdapter({ initialOnline: false });
    // Override the default cap by constructing a fresh adapter with a tiny cap.
    fx.adapter.dispose();
    const states: OfflineAdapterState[] = [];
    const realPost = vi.fn(async () => ok());
    let _listener: (() => void) | null = null;
    const storageMock = makeStorage();
    const adapter = new OfflineAdapter({
      realPost,
      storage: storageMock.storage,
      onStateChange: (s) => states.push(s),
      isOnline: () => false,
      addOnlineListener: (cb) => {
        _listener = cb;
        return () => {};
      },
      now: () => 1000,
      uuid: () => Math.random().toString(36).slice(2, 10),
      maxQueueSize: 2,
    });

    await adapter.post(payload("2026-ua"));
    await adapter.post(payload("2026-se"));
    await adapter.post(payload("2026-fr"));

    expect(storageMock.read()).toHaveLength(2);
    // 2026-ua should be evicted; 2026-se and 2026-fr remain.
    const remaining = storageMock.read().map((e) => e.payload.contestantId);
    expect(remaining).toEqual(["2026-se", "2026-fr"]);

    // Last state emission should reflect overflowed: true.
    expect(states[states.length - 1]).toMatchObject({ overflowed: true });
    adapter.dispose();
  });
```

- [ ] **Step 3.6: Run tests — confirm GREEN (regression + new)**

Run: `npx vitest run src/lib/voting/OfflineAdapter.test.ts`
Expected: 14 pass (13 previous + 1 new).

Run: `npm run type-check`
Expected: zero errors.

- [ ] **Step 3.7: Commit**

```bash
git add src/lib/voting/OfflineAdapter.ts src/lib/voting/OfflineAdapter.test.ts
git commit -m "$(cat <<'EOF'
OfflineAdapter: 200-entry cap with FIFO eviction + overflowed flag

Adds maxQueueSize dep (default 200). On enqueue, evict oldest entries
until size ≤ cap and flip overflowed: true. Flag stays sticky until
drain reduces queue below cap (Task 4 follow-up). State shape widens
with `overflowed: boolean`. Existing PR 2 state assertions updated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Extend `OfflineAdapter` — drain conflict check + 409 abort + onDrainComplete

**Files:**
- Modify: `src/lib/voting/OfflineAdapter.ts`
- Modify: `src/lib/voting/OfflineAdapter.test.ts`

The drain loop becomes three-phase: (1) per-room conflict fetch + partition, (2) post drainable entries (watching for 409 ROOM_NOT_VOTING), (3) emit consolidated `DrainNotice`.

- [ ] **Step 4.1: Add a test for the conflict-skip + drain-complete notice**

Append at the end of the `describe("OfflineAdapter", ...)` block:

```ts
  it("drain: fetchServerVotes returning newer updatedAt → entry skipped + notice fired", async () => {
    const stale = {
      id: "stale",
      timestamp: 1000,
      payload: payload("2026-ua"),
    };
    const fresh = {
      id: "fresh",
      timestamp: 9_999_999_999_999,
      payload: payload("2026-se"),
    };
    let notice: DrainNotice | null = null;
    const storageMock = makeStorage([stale, fresh]);
    const realPost = vi.fn(async () => ok());
    const adapter = new OfflineAdapter({
      realPost,
      storage: storageMock.storage,
      onStateChange: () => {},
      isOnline: () => true,
      addOnlineListener: () => () => {},
      now: () => 1000,
      uuid: () => "u",
      fetchServerVotes: async () => [
        { contestantId: "2026-ua", updatedAt: "2026-04-25T12:00:01Z" },
        // 2026-se has no server state → not a conflict
      ],
      onDrainComplete: (n) => {
        notice = n;
      },
    });

    // Wait for drain to settle.
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(realPost).toHaveBeenCalledTimes(1);
    expect(realPost).toHaveBeenCalledWith(fresh.payload);
    expect(storageMock.read()).toEqual([]);
    expect(notice).not.toBeNull();
    expect(notice!.skipped).toHaveLength(1);
    expect(notice!.skipped[0].entry.id).toBe("stale");
    expect(notice!.votingEndedRoomIds).toEqual([]);
    adapter.dispose();
  });

  it("drain: fetchServerVotes throws → drain aborts; queue retained; no notice", async () => {
    const e = {
      id: "e",
      timestamp: 1000,
      payload: payload("2026-ua"),
    };
    let notice: DrainNotice | null = null;
    const storageMock = makeStorage([e]);
    const adapter = new OfflineAdapter({
      realPost: vi.fn(async () => ok()),
      storage: storageMock.storage,
      onStateChange: () => {},
      isOnline: () => true,
      addOnlineListener: () => () => {},
      now: () => 1000,
      uuid: () => "u",
      fetchServerVotes: async () => {
        throw new Error("server fetch failed");
      },
      onDrainComplete: (n) => {
        notice = n;
      },
    });

    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(storageMock.read()).toHaveLength(1);
    expect(notice).toBeNull();
    adapter.dispose();
  });

  it("drain: 409 ROOM_NOT_VOTING → drops entries for that roomId + emits voting-ended notice", async () => {
    const ROOM_X = "11111111-2222-4333-8444-666666666666";
    const e1 = {
      id: "e1",
      timestamp: 9_999_999_999_999,
      payload: { ...payload("2026-ua"), roomId: ROOM_X },
    };
    const e2 = {
      id: "e2",
      timestamp: 9_999_999_999_999,
      payload: { ...payload("2026-se"), roomId: ROOM_X },
    };
    const e3 = {
      id: "e3",
      timestamp: 9_999_999_999_999,
      payload: payload("2026-fr"), // ROOM_A — different
    };
    let notice: DrainNotice | null = null;
    const storageMock = makeStorage([e1, e2, e3]);
    const realPost = vi.fn(async (p: PostVoteInput) => {
      if (p.roomId === ROOM_X) {
        return {
          ok: false as const,
          code: "ROOM_NOT_VOTING",
          message: "Room is not accepting votes",
        };
      }
      return ok();
    });
    const adapter = new OfflineAdapter({
      realPost,
      storage: storageMock.storage,
      onStateChange: () => {},
      isOnline: () => true,
      addOnlineListener: () => () => {},
      now: () => 1000,
      uuid: () => "u",
      fetchServerVotes: async () => [],
      onDrainComplete: (n) => {
        notice = n;
      },
    });

    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(storageMock.read()).toEqual([]);
    expect(notice).not.toBeNull();
    expect(notice!.votingEndedRoomIds).toEqual([ROOM_X]);
    expect(notice!.skipped).toEqual([]);
    adapter.dispose();
  });

  it("drain: clears overflowed flag once queue drops below cap", async () => {
    const oldEntries = Array.from({ length: 3 }, (_, i) => ({
      id: `e${i}`,
      timestamp: 9_999_999_999_999,
      payload: payload(`2026-${String(i).padStart(2, "0")}`),
    }));
    const states: OfflineAdapterState[] = [];
    const storageMock = makeStorage(oldEntries);
    const adapter = new OfflineAdapter({
      realPost: vi.fn(async () => ok()),
      storage: storageMock.storage,
      onStateChange: (s) => states.push(s),
      isOnline: () => true,
      addOnlineListener: () => () => {},
      now: () => 1000,
      uuid: () => "u",
      maxQueueSize: 2,
      fetchServerVotes: async () => [],
    });
    // Force overflow on entry — capacity is 2, enqueue 3 → flips overflowed.
    // But initialQueue had 3, so on construction queueSize=3 > cap=2.
    // Drain runs and empties queue → overflowed should clear.
    for (let i = 0; i < 15; i++) await Promise.resolve();
    expect(storageMock.read()).toEqual([]);
    expect(states[states.length - 1]).toMatchObject({
      queueSize: 0,
      overflowed: false,
    });
    adapter.dispose();
  });
```

(That's 4 new tests; together with the 200-cap test from Task 3 and the previous 13, total = 18.)

- [ ] **Step 4.2: Run tests — confirm RED**

Run: `npx vitest run src/lib/voting/OfflineAdapter.test.ts`
Expected: 4 new tests FAIL (drain doesn't fetch server votes, doesn't produce notices, doesn't handle 409 specifically, and doesn't clear `overflowed`).

- [ ] **Step 4.3: Implement the new drain loop**

Open `src/lib/voting/OfflineAdapter.ts`. Add this import at the top of the file (next to the existing `offlineQueue` import):

```ts
import {
  partitionByConflict,
  makeServerStateKey,
} from "@/lib/voting/conflictCheck";
import type { SkippedEntry } from "@/lib/voting/conflictCheck";
```

(The earlier `import type { SkippedEntry } …` from Task 3.1 stays — leave it as a single import, deduped.)

Find the existing `drain()` method (the entire method body). Replace with:

```ts
  private async drain(): Promise<void> {
    if (this.draining || this.disposed) return;
    if (!this.isOnlineFn()) return;
    this.draining = true;
    let skipped: SkippedEntry[] = [];
    const votingEndedRoomIds = new Set<string>();
    try {
      // Phase 1: pre-drain conflict fetch (best effort)
      const all = loadQueue(this.storage);
      if (all.length === 0) return;
      const serverState = new Map<string, string>();
      if (this.fetchServerVotes) {
        const pairs = uniqueRoomUserPairs(all);
        for (const [roomId, userId] of pairs) {
          let votes: { contestantId: string; updatedAt: string }[];
          try {
            votes = await this.fetchServerVotes(roomId, userId);
          } catch {
            // Pre-drain fetch failed — abort entire drain; poll will retry.
            return;
          }
          for (const v of votes) {
            serverState.set(
              makeServerStateKey(roomId, v.contestantId),
              v.updatedAt
            );
          }
        }
      }
      const partition = partitionByConflict(all, serverState);
      skipped = partition.skipped;
      saveQueue(this.storage, partition.drainable);
      this.queueSize = partition.drainable.length;
      this.emitState();

      // Phase 2: drain drainable entries, watching for 409 ROOM_NOT_VOTING
      while (!this.disposed && this.isOnlineFn()) {
        const current = loadQueue(this.storage);
        if (current.length === 0) break;
        const head = current[0];
        if (votingEndedRoomIds.has(head.payload.roomId)) {
          // Drop without POSTing.
          const remaining = current.filter(
            (e) => e.payload.roomId !== head.payload.roomId
          );
          saveQueue(this.storage, remaining);
          this.queueSize = remaining.length;
          this.emitState();
          continue;
        }
        let result: PostVoteResult;
        try {
          result = await this.realPost(head.payload);
        } catch {
          // Network error during drain — stop, polling will retry.
          break;
        }
        if (!result.ok && result.code === "ROOM_NOT_VOTING") {
          votingEndedRoomIds.add(head.payload.roomId);
          const remaining = current.filter(
            (e) => e.payload.roomId !== head.payload.roomId
          );
          saveQueue(this.storage, remaining);
          this.queueSize = remaining.length;
          this.emitState();
          continue;
        }
        // Both other ok:true and ok:false drop the head entry.
        if (result.ok && result.data) {
          // Update server-state map for subsequent same-row entries.
          // (Best effort — vote.updatedAt may not always be present.)
          const v = result.data.vote as { updatedAt?: string } | undefined;
          if (v?.updatedAt) {
            serverState.set(
              makeServerStateKey(head.payload.roomId, head.payload.contestantId),
              v.updatedAt
            );
          }
        }
        const { rest } = shiftFromQueue(this.storage);
        this.queueSize = rest.length;
        this.emitState();
      }

      // Phase 3: emit consolidated notice if anything happened
      if (skipped.length > 0 || votingEndedRoomIds.size > 0) {
        this.onDrainComplete?.({
          skipped,
          votingEndedRoomIds: Array.from(votingEndedRoomIds),
        });
      }

      // Clear overflowed sticky flag if queue is back below the cap
      if (this.overflowed && this.queueSize < this.maxQueueSize) {
        this.overflowed = false;
        this.emitState();
      }
    } finally {
      this.draining = false;
      if (this.queueSize === 0) {
        this.stopPolling();
      }
    }
  }
```

Add the `uniqueRoomUserPairs` helper inside the file (above the class):

```ts
function uniqueRoomUserPairs(
  entries: readonly QueueEntry[]
): Array<[string, string]> {
  const seen = new Set<string>();
  const pairs: Array<[string, string]> = [];
  for (const e of entries) {
    const key = `${e.payload.roomId}::${e.payload.userId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push([e.payload.roomId, e.payload.userId]);
  }
  return pairs;
}
```

- [ ] **Step 4.4: Run tests — confirm GREEN**

Run: `npx vitest run src/lib/voting/OfflineAdapter.test.ts`
Expected: 18/18 pass.

Run: `npm run type-check`
Expected: zero errors. (If `PostVoteResult` shape has changed — it shouldn't have — adjust `result.data.vote` access accordingly.)

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/voting/OfflineAdapter.ts src/lib/voting/OfflineAdapter.test.ts
git commit -m "$(cat <<'EOF'
OfflineAdapter: drain-time conflict check + 409 abort + drain notice

Drain loop is now three-phase:
1. Pre-drain fetch of each unique (room, user) via fetchServerVotes;
   build server-state map; partition queue with partitionByConflict;
   silently drop skipped entries from storage.
2. Post drainable entries one by one, watching for 409 ROOM_NOT_VOTING.
   On first 409 for a roomId: drop ALL remaining entries for that room
   without further POSTs; record in votingEndedRoomIds.
3. If skipped or voting-ended occurred, fire onDrainComplete with a
   consolidated DrainNotice. Also clears the overflowed sticky flag
   once queue drops below cap.

In-memory server-state map updates from successful POST responses so
subsequent same-row entries see fresh state without re-fetching.
Pre-drain fetch failure aborts the whole drain (not just one room) —
poll will retry; conflict check is best-effort.

4 new tests + the 200-cap test from prior commit + 13 PR-2 tests = 18.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `DrainNotice` + `QueueOverflowBanner` components

**Files:**
- Create: `src/components/voting/DrainNotice.tsx`
- Create: `src/components/voting/QueueOverflowBanner.tsx`

Both are leaf components, no tests (manual verification).

- [ ] **Step 5.1: Create `DrainNotice.tsx`**

Create `src/components/voting/DrainNotice.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { DrainNotice as DrainNoticePayload } from "@/lib/voting/OfflineAdapter";

export interface DrainNoticeProps {
  notice: DrainNoticePayload | null;
  onDismiss: () => void;
}

/**
 * Inline notice surfaced after an offline drain completes with skipped
 * entries (server-newer conflict) or with a roomId where voting ended
 * mid-drain. SPEC §8.5.1 + §8.5.2.
 *
 * Style mirrors OfflineBanner (sticky-top, rounded, accent-pink) plus a
 * × dismiss button and an inline expand-for-details for the skipped case.
 */
export default function DrainNotice({ notice, onDismiss }: DrainNoticeProps) {
  const [expanded, setExpanded] = useState(false);
  if (!notice) return null;

  const skippedCount = notice.skipped.length;
  const endedCount = notice.votingEndedRoomIds.length;

  // Voting-ended takes precedence over conflict copy when both fire.
  if (endedCount > 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="sticky top-2 mx-4 z-10 rounded-lg border border-accent/30 bg-accent/10 text-accent text-center px-4 py-2 text-sm font-medium backdrop-blur-sm flex items-center justify-between gap-2"
      >
        <span>
          Voting ended while you were offline — your unsaved changes for this
          room were discarded.
        </span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="flex-shrink-0 px-1 text-accent/80 hover:text-accent"
        >
          ×
        </button>
      </div>
    );
  }

  if (skippedCount === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-2 mx-4 z-10 rounded-lg border border-accent/30 bg-accent/10 text-accent px-4 py-2 text-sm font-medium backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex-1">
          {skippedCount} offline edit{skippedCount === 1 ? "" : "s"} couldn’t be
          applied (newer values on the server).
          {!expanded && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="ml-2 underline"
            >
              View
            </button>
          )}
        </span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="flex-shrink-0 px-1 text-accent/80 hover:text-accent"
        >
          ×
        </button>
      </div>
      {expanded && (
        <ul className="mt-2 list-disc pl-5 text-xs">
          {notice.skipped.map((s) => (
            <li key={s.entry.id}>
              {s.entry.payload.contestantId}
              {s.entry.payload.scores && Object.keys(s.entry.payload.scores).length > 0
                ? ` (${Object.keys(s.entry.payload.scores).join(", ")})`
                : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5.2: Create `QueueOverflowBanner.tsx`**

Create `src/components/voting/QueueOverflowBanner.tsx`:

```tsx
export interface QueueOverflowBannerProps {
  visible: boolean;
}

/**
 * Sticky banner shown while the offline queue is at its 200-entry cap.
 * SPEC §8.5.3. Uses destructive token (red) to distinguish from the
 * accent-pink offline banner — this is "data loss is happening" severity.
 */
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

- [ ] **Step 5.3: Verify type-check**

Run: `npm run type-check`
Expected: zero errors.

- [ ] **Step 5.4: Commit**

```bash
git add src/components/voting/DrainNotice.tsx src/components/voting/QueueOverflowBanner.tsx
git commit -m "$(cat <<'EOF'
voting: DrainNotice + QueueOverflowBanner components

Two leaf UI pieces for PR-3 of the autosave trio:
- DrainNotice: inline accent-pink banner shown after drain completes
  with skipped (server-newer) entries OR a voting-ended room. Inline
  expand for skipped details; × dismiss.
- QueueOverflowBanner: destructive-tinted variant shown while the
  offline queue is at its 200-entry cap.

Style consistent with the existing OfflineBanner (sticky, rounded,
backdrop-blur).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Hook + VotingView + page wire-up (unified commit)

**Files:**
- Modify: `src/components/voting/useVoteAutosave.ts`
- Modify: `src/components/voting/VotingView.tsx`
- Modify: `src/app/room/[id]/page.tsx`

Three connected edits, committed together once the tree is green.

- [ ] **Step 6.1: Update `useVoteAutosave`**

Open `src/components/voting/useVoteAutosave.ts`. Replace the entire file with:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Autosaver, type SaveStatus } from "@/lib/voting/Autosaver";
import {
  OfflineAdapter,
  type OfflineAdapterState,
  type DrainNotice,
} from "@/lib/voting/OfflineAdapter";
import type { PostVoteInput, PostVoteResult } from "@/lib/voting/postVote";
import type { DisplaySaveStatus } from "@/components/voting/SaveChip";

export interface UseVoteAutosaveParams {
  roomId: string;
  userId: string | null;
  post: (payload: PostVoteInput) => Promise<PostVoteResult>;
  /** Optional — when provided, drain runs a server-state pre-fetch to detect conflicts. */
  fetchServerVotes?: (
    roomId: string,
    userId: string
  ) => Promise<{ contestantId: string; updatedAt: string }[]>;
}

export interface UseVoteAutosaveResult {
  onScoreChange: (
    contestantId: string,
    categoryName: string,
    next: number | null
  ) => void;
  status: DisplaySaveStatus;
  offlineBannerVisible: boolean;
  drainNotice: DrainNotice | null;
  dismissDrainNotice: () => void;
  queueOverflow: boolean;
}

/**
 * Hook composes:
 *  - Autosaver (PR #22) — debounced per-contestant coalesce
 *  - OfflineAdapter (PR #25 + this PR) — localStorage queue, online detection,
 *    conflict reconciliation, 200-cap, voting-ended abort
 *
 * DisplaySaveStatus is "offline" when queue non-empty OR browser offline.
 * offlineBannerVisible is strictly !online (mid-drain UX shows only the chip).
 * drainNotice surfaces server-newer conflicts and voting-ended events from
 * the most recent drain; null when none.
 * queueOverflow is true while the queue is at its 200-entry cap.
 */
export function useVoteAutosave(
  params: UseVoteAutosaveParams
): UseVoteAutosaveResult {
  const [autosaverStatus, setAutosaverStatus] = useState<SaveStatus>("idle");
  const [adapterState, setAdapterState] = useState<OfflineAdapterState>({
    online: true,
    queueSize: 0,
    overflowed: false,
  });
  const [drainNotice, setDrainNotice] = useState<DrainNotice | null>(null);
  const saverRef = useRef<Autosaver | null>(null);

  useEffect(() => {
    if (!params.userId) {
      saverRef.current = null;
      setAutosaverStatus("idle");
      setAdapterState({ online: true, queueSize: 0, overflowed: false });
      setDrainNotice(null);
      return;
    }

    const storage =
      typeof window !== "undefined" ? window.localStorage : null;

    const adapter = new OfflineAdapter({
      realPost: params.post,
      storage,
      onStateChange: setAdapterState,
      fetchServerVotes: params.fetchServerVotes,
      onDrainComplete: setDrainNotice,
    });

    const saver = new Autosaver(params.roomId, params.userId, {
      post: (payload) => adapter.post(payload),
      onStatusChange: setAutosaverStatus,
    });
    saverRef.current = saver;

    return () => {
      saver.dispose();
      adapter.dispose();
      if (saverRef.current === saver) saverRef.current = null;
    };
  }, [params.roomId, params.userId, params.post, params.fetchServerVotes]);

  const onScoreChange = useCallback(
    (contestantId: string, categoryName: string, next: number | null) => {
      saverRef.current?.schedule(contestantId, categoryName, next);
    },
    []
  );

  const dismissDrainNotice = useCallback(() => setDrainNotice(null), []);

  const status: DisplaySaveStatus =
    adapterState.queueSize > 0 || !adapterState.online
      ? "offline"
      : autosaverStatus;

  return {
    onScoreChange,
    status,
    offlineBannerVisible: !adapterState.online,
    drainNotice,
    dismissDrainNotice,
    queueOverflow: adapterState.overflowed,
  };
}
```

- [ ] **Step 6.2: Update `VotingView`**

Open `src/components/voting/VotingView.tsx`. Find the imports block:

```tsx
import SaveChip, { type DisplaySaveStatus } from "@/components/voting/SaveChip";
import OfflineBanner from "@/components/voting/OfflineBanner";
```

Replace with:

```tsx
import SaveChip, { type DisplaySaveStatus } from "@/components/voting/SaveChip";
import OfflineBanner from "@/components/voting/OfflineBanner";
import DrainNotice from "@/components/voting/DrainNotice";
import QueueOverflowBanner from "@/components/voting/QueueOverflowBanner";
import type { DrainNotice as DrainNoticePayload } from "@/lib/voting/OfflineAdapter";
```

Find the `VotingViewProps` interface. Add the new props:

```tsx
  offlineBannerVisible?: boolean;
}
```

Replace with:

```tsx
  offlineBannerVisible?: boolean;
  drainNotice?: DrainNoticePayload | null;
  onDismissDrainNotice?: () => void;
  queueOverflow?: boolean;
}
```

Find the destructure:

```tsx
  offlineBannerVisible,
}: VotingViewProps) {
```

Replace with:

```tsx
  offlineBannerVisible,
  drainNotice,
  onDismissDrainNotice,
  queueOverflow,
}: VotingViewProps) {
```

Find the rendered banner area at the top of `<main>`:

```tsx
      <OfflineBanner visible={offlineBannerVisible ?? false} />
```

Replace with:

```tsx
      <OfflineBanner visible={offlineBannerVisible ?? false} />
      <QueueOverflowBanner visible={queueOverflow ?? false} />
      <DrainNotice
        notice={drainNotice ?? null}
        onDismiss={onDismissDrainNotice ?? (() => {})}
      />
```

- [ ] **Step 6.3: Update `page.tsx`**

Open `src/app/room/[id]/page.tsx`. Find the existing `memoizedPostVote` block (it lives just above the `useVoteAutosave` call). Add a `memoizedFetchServerVotes` callback right after it:

Find:

```tsx
  const memoizedPostVote = useCallback(
    (payload: Parameters<typeof postVote>[0]) =>
      postVote(payload, { fetch: window.fetch.bind(window) }),
    []
  );
  const autosave = useVoteAutosave({
    roomId,
    userId: getSession()?.userId ?? null,
    post: memoizedPostVote,
  });
```

Replace with:

```tsx
  const memoizedPostVote = useCallback(
    (payload: Parameters<typeof postVote>[0]) =>
      postVote(payload, { fetch: window.fetch.bind(window) }),
    []
  );
  const memoizedFetchServerVotes = useCallback(
    async (
      voteRoomId: string,
      voteUserId: string
    ): Promise<{ contestantId: string; updatedAt: string }[]> => {
      const result = await fetchRoomData(voteRoomId, voteUserId, {
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
  const autosave = useVoteAutosave({
    roomId,
    userId: getSession()?.userId ?? null,
    post: memoizedPostVote,
    fetchServerVotes: memoizedFetchServerVotes,
  });
```

Find the `<VotingView ... />` render in the voting branch. Add the three new props:

```tsx
        offlineBannerVisible={autosave.offlineBannerVisible}
      />
```

Replace with:

```tsx
        offlineBannerVisible={autosave.offlineBannerVisible}
        drainNotice={autosave.drainNotice}
        onDismissDrainNotice={autosave.dismissDrainNotice}
        queueOverflow={autosave.queueOverflow}
      />
```

- [ ] **Step 6.4: Verify type-check + tests + lint**

Run: `npm run type-check`
Expected: zero errors.

Run: `npm test -- --run`
Expected: full suite green. Baseline (PR #25 merged) was 580 passing; this PR adds 9 (Task 1: 0 new — assertion edit; Task 2: 9 new conflictCheck; Task 3: +1 200-cap; Task 4: +4 drain) → **594 passing / 4 todo**.

Run: `npm run lint`
Expected: only the pre-existing `useRoomRealtime.ts:30` warning.

- [ ] **Step 6.5: Commit Tasks 6 unified wire-up**

```bash
git add src/components/voting/useVoteAutosave.ts src/components/voting/VotingView.tsx "src/app/room/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
voting offline conflicts: wire hook, VotingView, page

Three-file wire-up committed together so the tree is never broken
mid-chain:
- useVoteAutosave: accept fetchServerVotes param; expose drainNotice,
  dismissDrainNotice, queueOverflow
- VotingView: render QueueOverflowBanner + DrainNotice at top alongside
  OfflineBanner; accept matching props
- page.tsx: memoize fetchServerVotes via fetchRoomData; thread the
  three new props into VotingView

Closes the SPEC §8.5 trio: writes can now detect server-newer
conflicts, hit a 200-entry cap with FIFO eviction, and bail gracefully
when voting ends mid-drain.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final verification + push + PR

- [ ] **Step 7.1: Branch state**

Run: `git log --oneline main..HEAD`
Expected: 7 entries:

```
<sha> voting offline conflicts: wire hook, VotingView, page
<sha> voting: DrainNotice + QueueOverflowBanner components
<sha> OfflineAdapter: drain-time conflict check + 409 abort + drain notice
<sha> OfflineAdapter: 200-entry cap with FIFO eviction + overflowed flag
<sha> voting: conflictCheck partition helper + tests
<sha> getRoom: include updatedAt in VoteView
<sha> docs: design for voting autosave PR 3 of 3 (conflicts + cap + abort)
```

(Plan doc commit comes earlier from the writing-plans step.)

- [ ] **Step 7.2: Full suite**

Run: `npm test -- --run`
Expected: all green. Final count ≈ 594 passing / 4 todo.

Run: `npm run type-check`
Expected: zero errors.

Run: `npm run lint`
Expected: only the pre-existing `useRoomRealtime.ts:30` warning.

- [ ] **Step 7.3: Manual smoke**

1. `npm run dev`. Create + join a room. Start voting.
2. Score on contestant A. DevTools → Network → Offline.
3. Score on contestants A, B, C → all queued.
4. Re-enable network → drain runs → chip back to `✓ Saved`.
5. Verify in another browser tab: open the same room as the same user (or use the rehydration GET to inspect votes server-side); current scores are reflected.

**Conflict scenario:**
6. With the same user in another tab, score on contestant A while still online.
7. Switch to the original tab, go offline, score contestant A (older timestamp than other tab's online write).
8. Re-enable network → drain runs → DrainNotice appears: *"1 offline edit couldn’t be applied (newer values on the server). [View]"*. Tap View → shows `2026-XX (Vocals)`. Tap × → dismisses.

**Voting-ended scenario:**
9. Go offline, score contestant A → queued.
10. In a separate admin tab, transition the room to `done` (via PATCH /api/rooms/.../status if available, or simulate by updating the row directly in Supabase).
11. Re-enable network in the offline tab → drain hits 409 → DrainNotice: *"Voting ended while you were offline — your unsaved changes for this room were discarded."*
12. Verify queue is empty for that room (DevTools → Application → Local Storage → `emx_offline_queue`).

**200-cap scenario** (less realistic, but worth one check):
13. Open DevTools console, evaluate:
    ```js
    const u = JSON.parse(localStorage.getItem("emx_session")).userId;
    const items = Array.from({length: 201}, (_, i) => ({
      id: `cap-${i}`, timestamp: Date.now() - i * 1000,
      payload: { roomId: "...", userId: u, contestantId: `2026-${String(i).padStart(3,"0")}`, scores: { Vocals: 5 } }
    }));
    localStorage.setItem("emx_offline_queue", JSON.stringify(items));
    location.reload();
    ```
    (Replace roomId with the live one.)
14. Expected: `QueueOverflowBanner` shows on load: *"Too many offline changes — oldest may be lost. Reconnect to save."*
15. Re-enable network if offline → drain reduces queue → banner clears once below 200.

- [ ] **Step 7.4: Push + open PR**

```bash
git push -u origin feat/voting-offline-conflicts
gh pr create --title "Phase 3: voting autosave — conflicts + cap + abort (3 of 3)" --body "<body>"
```

Body highlights:
- Closes SPEC §8.5 autosave trio
- Server-side: `updatedAt` added to `VoteView` (one-line)
- Client-side: pure `partitionByConflict` helper; `OfflineAdapter` extended with pre-drain fetch, 200-cap, 409 abort
- Two new components: `DrainNotice` (skipped + voting-ended), `QueueOverflowBanner`
- ~14 new tests across `conflictCheck` + `OfflineAdapter`
- Out of scope: tap-for-details modal (using inline expand); per-tab attribution; `voting_ending` (handled implicitly via 409)

---

## Self-review

**Spec coverage (design doc §1–§13):**
- §3 architecture → Tasks 3, 4, 6 (adapter extension + hook composition).
- §4 server-side → Task 1.
- §5 conflictCheck → Task 2.
- §6 adapter extensions:
  - Types + state → Task 3.1, 3.2
  - 200-cap → Task 3.3
  - Drain phases (fetch → partition → POST → 409 → notice → overflow clear) → Task 4.3
- §7 DrainNotice → Task 5.1 (incl. inline expand for spec'd "View" affordance).
- §8 QueueOverflowBanner → Task 5.2.
- §9 hook composition → Task 6.1.
- §10 page provides fetchServerVotes → Task 6.3.
- §11 testing — Task 1 (assertion edit), Task 2 (9), Task 3 (1), Task 4 (4); skipped: hook/components/page.
- §12 non-obvious decisions — embedded in code + commit messages.
- §13 follow-ups — tracked, not implemented.

**Placeholder scan:** no TBDs / hand-wavy steps; every code block is complete. The note in Step 7.3.10 about "simulate by updating the row directly" is acceptable hand-waving for a *manual* test step, not a code step.

**Type consistency across tasks:**
- `VoteView.updatedAt: string` (Task 1) → consumed by `fetchServerVotes` shape (Task 6.3).
- `SkippedEntry { entry, reason: "server-newer" }` (Task 2) → used in `DrainNotice.skipped` (Task 3.1) and `DrainNotice.tsx` rendering (Task 5.1).
- `DrainNotice { skipped, votingEndedRoomIds }` (Task 3.1) → exposed by hook (Task 6.1) → consumed by `VotingView` (Task 6.2).
- `OfflineAdapterState { online, queueSize, overflowed }` (Task 3.1) → state in hook (Task 6.1).
- `partitionByConflict(entries, serverState: ReadonlyMap<string, string>)` (Task 2) → caller in Task 4.3 builds the map exactly the same way (`makeServerStateKey(roomId, contestantId)`).
- `fetchServerVotes(roomId, userId): Promise<{ contestantId; updatedAt }[]>` shape consistent across Tasks 3.1 (deps), 6.1 (hook param), 6.3 (page wrapper).
