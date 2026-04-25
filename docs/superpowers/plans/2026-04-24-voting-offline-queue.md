# Voting Autosave — PR 2 of 3 Implementation Plan (Offline Queue)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route autosave writes to `localStorage.emx_offline_queue` when the browser is offline or a real POST throws; show a sticky banner and `Offline — changes queued` chip state; drain on the next `online` event.

**Architecture:** New `OfflineAdapter` class wraps the real `postVote` and is injected into `Autosaver` in place of the raw `post` dep. `Autosaver` is unchanged. A new `useVoteAutosave` composes Autosaver's status with the adapter's online/queue state into a `DisplaySaveStatus = SaveStatus | "offline"`. `SaveChip` gains the offline branch; a new `OfflineBanner` leaf component renders at the top of `VotingView` when truly offline.

**Tech Stack:** Next.js 14 App Router, React 18 (client hooks), TypeScript strict, Vitest (node env — fake timers + injected `isOnline` / storage).

Design: [docs/superpowers/specs/2026-04-24-voting-offline-queue-design.md](../specs/2026-04-24-voting-offline-queue-design.md) — read it first.

---

## File structure

| Path | Kind | Responsibility |
|---|---|---|
| `src/lib/voting/offlineQueue.ts` | **new** | Pure storage helpers: `loadQueue`, `saveQueue`, `appendToQueue`, `shiftFromQueue`, `QueueEntry` type |
| `src/lib/voting/offlineQueue.test.ts` | **new** | 8 unit tests (no DOM; injected `Storage`) |
| `src/lib/voting/OfflineAdapter.ts` | **new** | Class wrapping `postVote` with online/offline routing + drain |
| `src/lib/voting/OfflineAdapter.test.ts` | **new** | 12 unit tests (injected `isOnline`, `addOnlineListener`, `Storage`, `realPost`) |
| `src/components/voting/OfflineBanner.tsx` | **new** | Leaf: sticky banner at top of `<main>`; renders null when not visible |
| `src/components/voting/SaveChip.tsx` | modify | Accept `DisplaySaveStatus`; add `offline` branch (keeps `error`) |
| `src/components/voting/useVoteAutosave.ts` | modify | Instantiate `OfflineAdapter`; compose `DisplaySaveStatus`; expose `offlineBannerVisible` |
| `src/components/voting/VotingView.tsx` | modify | Accept optional `saveStatus: DisplaySaveStatus`, `offlineBannerVisible: boolean`; render `OfflineBanner` at top |
| `src/app/room/[id]/page.tsx` | modify | Thread `offlineBannerVisible` from hook into `VotingView` |

**Not touched:** `Autosaver.ts`, `postVote.ts`, `seedScoresFromVotes.ts`, `ScoreRow.tsx`, `nextScore.ts`, `votingPosition.ts`, server-side code.

---

## Task 1: `offlineQueue` helpers + tests (TDD)

**Files:**
- Create: `src/lib/voting/offlineQueue.ts`
- Create: `src/lib/voting/offlineQueue.test.ts`

Pure storage primitives. Injected `Storage`-compatible dep so tests don't touch `globalThis.localStorage`.

- [ ] **Step 1.1: Create the stub**

Create `src/lib/voting/offlineQueue.ts`:

```ts
import type { PostVoteInput } from "@/lib/voting/postVote";

export interface QueueEntry {
  id: string;
  timestamp: number;
  payload: PostVoteInput;
}

/** Minimal Storage subset we depend on; `window.localStorage` satisfies it. */
export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const QUEUE_STORAGE_KEY = "emx_offline_queue";

export function loadQueue(
  _storage: QueueStorage | null | undefined
): QueueEntry[] {
  throw new Error("not implemented");
}

export function saveQueue(
  _storage: QueueStorage | null | undefined,
  _entries: QueueEntry[]
): void {
  throw new Error("not implemented");
}

export function appendToQueue(
  _storage: QueueStorage | null | undefined,
  _entry: QueueEntry
): QueueEntry[] {
  throw new Error("not implemented");
}

export function shiftFromQueue(
  _storage: QueueStorage | null | undefined
): { head: QueueEntry | undefined; rest: QueueEntry[] } {
  throw new Error("not implemented");
}
```

- [ ] **Step 1.2: Write failing tests**

Create `src/lib/voting/offlineQueue.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  loadQueue,
  saveQueue,
  appendToQueue,
  shiftFromQueue,
  QUEUE_STORAGE_KEY,
  type QueueEntry,
  type QueueStorage,
} from "@/lib/voting/offlineQueue";

function makeStorage(initial: Record<string, string> = {}): {
  storage: QueueStorage;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
} {
  const backing = { ...initial };
  const get = vi.fn((k: string) => backing[k] ?? null);
  const set = vi.fn((k: string, v: string) => {
    backing[k] = v;
  });
  return { storage: { getItem: get, setItem: set }, get, set };
}

const ENTRY_A: QueueEntry = {
  id: "a",
  timestamp: 1000,
  payload: {
    roomId: "11111111-2222-4333-8444-555555555555",
    userId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    contestantId: "2026-ua",
    scores: { Vocals: 7 },
  },
};

const ENTRY_B: QueueEntry = {
  id: "b",
  timestamp: 2000,
  payload: {
    roomId: "11111111-2222-4333-8444-555555555555",
    userId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    contestantId: "2026-se",
    scores: { Staging: 9 },
  },
};

describe("loadQueue", () => {
  it("returns empty array when nothing is saved", () => {
    const { storage } = makeStorage();
    expect(loadQueue(storage)).toEqual([]);
  });

  it("parses a valid JSON array from storage", () => {
    const { storage } = makeStorage({
      [QUEUE_STORAGE_KEY]: JSON.stringify([ENTRY_A]),
    });
    expect(loadQueue(storage)).toEqual([ENTRY_A]);
  });

  it("returns [] when the saved value is malformed JSON", () => {
    const { storage } = makeStorage({
      [QUEUE_STORAGE_KEY]: "not-valid-json",
    });
    expect(loadQueue(storage)).toEqual([]);
  });

  it("returns [] when storage is null (e.g. SSR)", () => {
    expect(loadQueue(null)).toEqual([]);
  });
});

describe("saveQueue", () => {
  it("serialises and writes under the canonical key", () => {
    const { storage, set } = makeStorage();
    saveQueue(storage, [ENTRY_A, ENTRY_B]);
    expect(set).toHaveBeenCalledWith(
      QUEUE_STORAGE_KEY,
      JSON.stringify([ENTRY_A, ENTRY_B])
    );
  });

  it("no-ops when storage is null", () => {
    expect(() => saveQueue(null, [ENTRY_A])).not.toThrow();
  });

  it("swallows setItem errors silently (e.g. quota)", () => {
    const storage: QueueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    };
    expect(() => saveQueue(storage, [ENTRY_A])).not.toThrow();
  });
});

describe("appendToQueue + shiftFromQueue", () => {
  it("appendToQueue returns the new array with the entry at the tail and persists it", () => {
    const { storage, set } = makeStorage({
      [QUEUE_STORAGE_KEY]: JSON.stringify([ENTRY_A]),
    });
    const next = appendToQueue(storage, ENTRY_B);
    expect(next).toEqual([ENTRY_A, ENTRY_B]);
    expect(set).toHaveBeenCalledWith(
      QUEUE_STORAGE_KEY,
      JSON.stringify([ENTRY_A, ENTRY_B])
    );
  });

  it("shiftFromQueue returns { head, rest } and persists the rest", () => {
    const { storage, set } = makeStorage({
      [QUEUE_STORAGE_KEY]: JSON.stringify([ENTRY_A, ENTRY_B]),
    });
    const { head, rest } = shiftFromQueue(storage);
    expect(head).toEqual(ENTRY_A);
    expect(rest).toEqual([ENTRY_B]);
    expect(set).toHaveBeenCalledWith(
      QUEUE_STORAGE_KEY,
      JSON.stringify([ENTRY_B])
    );
  });

  it("shiftFromQueue on empty returns { head: undefined, rest: [] } and does not write", () => {
    const { storage, set } = makeStorage();
    const { head, rest } = shiftFromQueue(storage);
    expect(head).toBeUndefined();
    expect(rest).toEqual([]);
    expect(set).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 1.3: Run tests — confirm RED**

Run: `npx vitest run src/lib/voting/offlineQueue.test.ts`
Expected: FAIL — all 10 throw `"not implemented"`.

- [ ] **Step 1.4: Implement**

Replace the body of `src/lib/voting/offlineQueue.ts`:

```ts
import type { PostVoteInput } from "@/lib/voting/postVote";

export interface QueueEntry {
  id: string;
  timestamp: number;
  payload: PostVoteInput;
}

export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const QUEUE_STORAGE_KEY = "emx_offline_queue";

export function loadQueue(
  storage: QueueStorage | null | undefined
): QueueEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueueEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveQueue(
  storage: QueueStorage | null | undefined,
  entries: QueueEntry[]
): void {
  if (!storage) return;
  try {
    storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Silent — offline-queue persistence is a progressive enhancement.
  }
}

export function appendToQueue(
  storage: QueueStorage | null | undefined,
  entry: QueueEntry
): QueueEntry[] {
  const next = [...loadQueue(storage), entry];
  saveQueue(storage, next);
  return next;
}

export function shiftFromQueue(
  storage: QueueStorage | null | undefined
): { head: QueueEntry | undefined; rest: QueueEntry[] } {
  const current = loadQueue(storage);
  if (current.length === 0) {
    return { head: undefined, rest: [] };
  }
  const [head, ...rest] = current;
  saveQueue(storage, rest);
  return { head, rest };
}
```

- [ ] **Step 1.5: Run tests — confirm GREEN**

Run: `npx vitest run src/lib/voting/offlineQueue.test.ts`
Expected: PASS — 10/10.

- [ ] **Step 1.6: Commit**

```bash
git add src/lib/voting/offlineQueue.ts src/lib/voting/offlineQueue.test.ts
git commit -m "$(cat <<'EOF'
voting: offlineQueue helpers + tests

Pure storage primitives for localStorage.emx_offline_queue: load, save,
append, shift. Injected Storage-compatible dep so tests don't touch the
browser localStorage. Every failure path (null storage, malformed JSON,
throwing setItem) degrades silently — offline persistence is a
progressive enhancement, not a guarantee.

10 unit tests cover: empty load, valid parse, malformed JSON fallback,
null storage load/save, quota exception swallowing, append persistence,
shift happy path, shift on empty.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `OfflineAdapter` class + tests (TDD)

**Files:**
- Create: `src/lib/voting/OfflineAdapter.ts`
- Create: `src/lib/voting/OfflineAdapter.test.ts`

Class wraps a real `post` function with online/offline routing and drain behaviour. All external deps (online check, event listener, storage, uuid, now) injected for testability.

- [ ] **Step 2.1: Create the stub**

Create `src/lib/voting/OfflineAdapter.ts`:

```ts
import type { PostVoteInput, PostVoteResult } from "@/lib/voting/postVote";
import {
  loadQueue,
  appendToQueue,
  shiftFromQueue,
  type QueueEntry,
  type QueueStorage,
} from "@/lib/voting/offlineQueue";

export interface OfflineAdapterState {
  online: boolean;
  queueSize: number;
}

export interface OfflineAdapterDeps {
  realPost: (p: PostVoteInput) => Promise<PostVoteResult>;
  storage: QueueStorage | null;
  onStateChange: (state: OfflineAdapterState) => void;
  isOnline?: () => boolean;
  addOnlineListener?: (cb: () => void) => () => void;
  now?: () => number;
  uuid?: () => string;
}

/**
 * Wraps the real postVote with offline-awareness:
 *  - offline (or real post throws) → enqueue; return { ok: true }
 *  - ok: false from real post → pass through so Autosaver flips to `error`
 *  - queue non-empty → new writes go to tail; drain is sequential
 *  - drain triggers: `online` event + opportunistically on each post
 *
 * See docs/superpowers/specs/2026-04-24-voting-offline-queue-design.md §5.
 */
export class OfflineAdapter {
  constructor(_deps: OfflineAdapterDeps) {
    throw new Error("not implemented");
  }

  post(_payload: PostVoteInput): Promise<PostVoteResult> {
    throw new Error("not implemented");
  }

  dispose(): void {
    throw new Error("not implemented");
  }
}
```

- [ ] **Step 2.2: Write failing tests**

Create `src/lib/voting/OfflineAdapter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  OfflineAdapter,
  type OfflineAdapterState,
  type OfflineAdapterDeps,
} from "@/lib/voting/OfflineAdapter";
import type { PostVoteInput, PostVoteResult } from "@/lib/voting/postVote";
import {
  QUEUE_STORAGE_KEY,
  type QueueStorage,
  type QueueEntry,
} from "@/lib/voting/offlineQueue";

const ROOM_ID = "11111111-2222-4333-8444-555555555555";
const USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function payload(
  contestantId = "2026-ua",
  scores: Record<string, number | null> = { Vocals: 7 }
): PostVoteInput {
  return { roomId: ROOM_ID, userId: USER_ID, contestantId, scores };
}

function ok(): PostVoteResult {
  return { ok: true, data: { vote: {}, scoredCount: 1 } };
}

function fail4xx(): PostVoteResult {
  return { ok: false, code: "INVALID_BODY", message: "bad payload" };
}

interface StorageMock {
  storage: QueueStorage;
  read: () => QueueEntry[];
}

function makeStorage(initial: QueueEntry[] = []): StorageMock {
  let raw = initial.length ? JSON.stringify(initial) : null;
  const storage: QueueStorage = {
    getItem: (k: string) => (k === QUEUE_STORAGE_KEY ? raw : null),
    setItem: (k: string, v: string) => {
      if (k === QUEUE_STORAGE_KEY) raw = v;
    },
  };
  return {
    storage,
    read: () => (raw ? (JSON.parse(raw) as QueueEntry[]) : []),
  };
}

interface AdapterFixture {
  adapter: OfflineAdapter;
  states: OfflineAdapterState[];
  realPost: ReturnType<typeof vi.fn>;
  online: { value: boolean };
  fireOnline: () => void;
  storage: StorageMock;
}

function makeAdapter(
  opts: {
    initialOnline?: boolean;
    initialQueue?: QueueEntry[];
    postImpl?: (p: PostVoteInput) => Promise<PostVoteResult>;
  } = {}
): AdapterFixture {
  const states: OfflineAdapterState[] = [];
  const realPost = vi.fn(opts.postImpl ?? (async () => ok()));
  const online = { value: opts.initialOnline ?? true };
  let listener: (() => void) | null = null;
  const storage = makeStorage(opts.initialQueue);
  const deps: OfflineAdapterDeps = {
    realPost,
    storage: storage.storage,
    onStateChange: (s) => states.push(s),
    isOnline: () => online.value,
    addOnlineListener: (cb) => {
      listener = cb;
      return () => {
        if (listener === cb) listener = null;
      };
    },
    now: () => 1000,
    uuid: () => "test-uuid",
  };
  const adapter = new OfflineAdapter(deps);
  return {
    adapter,
    states,
    realPost,
    online,
    fireOnline: () => listener?.(),
    storage,
  };
}

describe("OfflineAdapter", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("online + empty queue + real post succeeds → calls realPost, no enqueue", async () => {
    const fx = makeAdapter();
    const result = await fx.adapter.post(payload());
    expect(result).toEqual(ok());
    expect(fx.realPost).toHaveBeenCalledTimes(1);
    expect(fx.storage.read()).toEqual([]);
  });

  it("online + empty queue + 4xx → passes through ok:false, no enqueue", async () => {
    const fx = makeAdapter({ postImpl: async () => fail4xx() });
    const result = await fx.adapter.post(payload());
    expect(result).toEqual(fail4xx());
    expect(fx.storage.read()).toEqual([]);
  });

  it("online + real post throws → enqueues and returns ok:true", async () => {
    const fx = makeAdapter({
      postImpl: async () => {
        throw new Error("network");
      },
    });
    const result = await fx.adapter.post(payload());
    expect(result).toEqual({ ok: true, data: { vote: {}, scoredCount: 0 } });
    expect(fx.storage.read()).toHaveLength(1);
    expect(fx.storage.read()[0].payload).toEqual(payload());
  });

  it("offline → enqueues without calling realPost", async () => {
    const fx = makeAdapter({ initialOnline: false });
    const result = await fx.adapter.post(payload());
    expect(result.ok).toBe(true);
    expect(fx.realPost).not.toHaveBeenCalled();
    expect(fx.storage.read()).toHaveLength(1);
  });

  it("online + queue non-empty → enqueues new payload at the tail; eventually drains", async () => {
    const existing: QueueEntry = {
      id: "existing",
      timestamp: 500,
      payload: payload("2026-se", { Vocals: 4 }),
    };
    const fx = makeAdapter({ initialQueue: [existing] });
    // Adapter should immediately attempt to drain the pre-existing entry on
    // construction; hold its resolution until we trigger the test write.
    let resolveFirst: (r: PostVoteResult) => void = () => {};
    const postImpl = vi
      .fn<(p: PostVoteInput) => Promise<PostVoteResult>>()
      .mockImplementationOnce(
        () =>
          new Promise<PostVoteResult>((r) => {
            resolveFirst = r;
          })
      )
      .mockImplementation(async () => ok());
    // Rebuild with the controlled postImpl.
    const fx2 = makeAdapter({ initialQueue: [existing], postImpl });
    // The initial drain is already in-flight. New write should enqueue.
    const p = fx2.adapter.post(payload());
    expect(fx2.storage.read()).toHaveLength(2);
    // Let the pre-existing drain complete.
    resolveFirst(ok());
    const result = await p;
    expect(result.ok).toBe(true);
    // Wait a microtask for chained drain.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // Both entries should eventually drain.
    expect(postImpl).toHaveBeenCalled();
  });

  it("drain: single entry success → removes entry and emits queueSize=0", async () => {
    const entry: QueueEntry = {
      id: "e",
      timestamp: 1,
      payload: payload(),
    };
    const fx = makeAdapter({ initialQueue: [entry] });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fx.realPost).toHaveBeenCalledWith(entry.payload);
    expect(fx.storage.read()).toEqual([]);
    expect(fx.states[fx.states.length - 1]).toMatchObject({
      online: true,
      queueSize: 0,
    });
  });

  it("drain: entry throws → stops draining; entry remains in storage", async () => {
    const entry: QueueEntry = {
      id: "e",
      timestamp: 1,
      payload: payload(),
    };
    const fx = makeAdapter({
      initialQueue: [entry],
      postImpl: async () => {
        throw new Error("still flaky");
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fx.storage.read()).toHaveLength(1);
  });

  it("drain: 4xx → removes entry (app-level bug, retry won't help)", async () => {
    const entry: QueueEntry = {
      id: "e",
      timestamp: 1,
      payload: payload(),
    };
    const fx = makeAdapter({
      initialQueue: [entry],
      postImpl: async () => fail4xx(),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fx.storage.read()).toEqual([]);
  });

  it("`online` event while queue non-empty → triggers drain", async () => {
    const entry: QueueEntry = {
      id: "e",
      timestamp: 1,
      payload: payload(),
    };
    const fx = makeAdapter({
      initialOnline: false,
      initialQueue: [entry],
      postImpl: async () => ok(),
    });
    // Adapter constructed offline — no drain ran.
    await Promise.resolve();
    expect(fx.realPost).not.toHaveBeenCalled();
    fx.online.value = true;
    fx.fireOnline();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fx.realPost).toHaveBeenCalledWith(entry.payload);
    expect(fx.storage.read()).toEqual([]);
  });

  it("initial state reflects pre-existing queue size", () => {
    const entry: QueueEntry = {
      id: "e",
      timestamp: 1,
      payload: payload(),
    };
    const fx = makeAdapter({ initialQueue: [entry] });
    // At least one state emission with queueSize >= 1 should have occurred.
    const sawNonEmpty = fx.states.some((s) => s.queueSize >= 1);
    expect(sawNonEmpty).toBe(true);
  });

  it("offline post emits state with online: false and queueSize: 1", async () => {
    const fx = makeAdapter({ initialOnline: false });
    await fx.adapter.post(payload());
    expect(fx.states[fx.states.length - 1]).toMatchObject({
      online: false,
      queueSize: 1,
    });
  });

  it("dispose removes the online listener", () => {
    const fx = makeAdapter();
    fx.adapter.dispose();
    // Firing after dispose should be a no-op — the removal callback set
    // `listener` to null, so the fixture's fireOnline triggers nothing.
    fx.fireOnline();
    // No new state emission guarantees this; check by counting before/after.
    const countBefore = fx.states.length;
    fx.fireOnline();
    expect(fx.states.length).toBe(countBefore);
  });
});
```

- [ ] **Step 2.3: Run tests — confirm RED**

Run: `npx vitest run src/lib/voting/OfflineAdapter.test.ts`
Expected: FAIL — all 12 throw `"not implemented"` in the constructor.

- [ ] **Step 2.4: Implement**

Replace the contents of `src/lib/voting/OfflineAdapter.ts`:

```ts
import type { PostVoteInput, PostVoteResult } from "@/lib/voting/postVote";
import {
  loadQueue,
  appendToQueue,
  shiftFromQueue,
  type QueueEntry,
  type QueueStorage,
} from "@/lib/voting/offlineQueue";

export interface OfflineAdapterState {
  online: boolean;
  queueSize: number;
}

export interface OfflineAdapterDeps {
  realPost: (p: PostVoteInput) => Promise<PostVoteResult>;
  storage: QueueStorage | null;
  onStateChange: (state: OfflineAdapterState) => void;
  isOnline?: () => boolean;
  addOnlineListener?: (cb: () => void) => () => void;
  now?: () => number;
  uuid?: () => string;
}

const defaultIsOnline = (): boolean =>
  typeof navigator === "undefined" ? true : navigator.onLine;

const defaultAddOnlineListener = (cb: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", cb);
  return () => window.removeEventListener("online", cb);
};

const defaultUuid = (): string => {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * See docs/superpowers/specs/2026-04-24-voting-offline-queue-design.md §5.
 */
export class OfflineAdapter {
  private readonly realPost: OfflineAdapterDeps["realPost"];
  private readonly storage: QueueStorage | null;
  private readonly onStateChange: (s: OfflineAdapterState) => void;
  private readonly isOnlineFn: () => boolean;
  private readonly nowFn: () => number;
  private readonly uuidFn: () => string;
  private readonly removeOnlineListener: () => void;
  private queueSize: number;
  private draining = false;
  private disposed = false;

  constructor(deps: OfflineAdapterDeps) {
    this.realPost = deps.realPost;
    this.storage = deps.storage;
    this.onStateChange = deps.onStateChange;
    this.isOnlineFn = deps.isOnline ?? defaultIsOnline;
    this.nowFn = deps.now ?? (() => Date.now());
    this.uuidFn = deps.uuid ?? defaultUuid;
    const addListener = deps.addOnlineListener ?? defaultAddOnlineListener;
    this.removeOnlineListener = addListener(() => {
      void this.drain();
    });
    this.queueSize = loadQueue(this.storage).length;
    this.emitState();
    if (this.queueSize > 0) {
      void this.drain();
    }
  }

  async post(payload: PostVoteInput): Promise<PostVoteResult> {
    if (this.disposed) {
      return { ok: true, data: { vote: {}, scoredCount: 0 } };
    }

    // Offline OR queue non-empty → route through queue so writes stay ordered.
    if (!this.isOnlineFn() || this.queueSize > 0) {
      this.enqueue(payload);
      void this.drain();
      return { ok: true, data: { vote: {}, scoredCount: 0 } };
    }

    // Online + empty queue — try a direct post.
    try {
      return await this.realPost(payload);
    } catch {
      this.enqueue(payload);
      return { ok: true, data: { vote: {}, scoredCount: 0 } };
    }
  }

  dispose(): void {
    this.disposed = true;
    this.removeOnlineListener();
  }

  private enqueue(payload: PostVoteInput): void {
    const entry: QueueEntry = {
      id: this.uuidFn(),
      timestamp: this.nowFn(),
      payload,
    };
    const next = appendToQueue(this.storage, entry);
    this.queueSize = next.length;
    this.emitState();
  }

  private async drain(): Promise<void> {
    if (this.draining || this.disposed) return;
    if (!this.isOnlineFn()) return;
    this.draining = true;
    try {
      // Loop until queue drains or we hit a blocking failure.
      while (!this.disposed && this.isOnlineFn()) {
        const current = loadQueue(this.storage);
        if (current.length === 0) break;
        const head = current[0];
        let drop = false;
        try {
          const result = await this.realPost(head.payload);
          // On both ok:true and ok:false (app error) we drop the entry.
          // 4xx/5xx retries won't help; PR 3 will revisit with proper
          // conflict reconciliation.
          drop = true;
          void result;
        } catch {
          // Network error during drain — stop, wait for next online event.
          break;
        }
        if (drop) {
          const { rest } = shiftFromQueue(this.storage);
          this.queueSize = rest.length;
          this.emitState();
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private emitState(): void {
    if (this.disposed) return;
    this.onStateChange({
      online: this.isOnlineFn(),
      queueSize: this.queueSize,
    });
  }
}
```

- [ ] **Step 2.5: Run tests — confirm GREEN**

Run: `npx vitest run src/lib/voting/OfflineAdapter.test.ts`
Expected: PASS — 12/12.

- [ ] **Step 2.6: Commit**

```bash
git add src/lib/voting/OfflineAdapter.ts src/lib/voting/OfflineAdapter.test.ts
git commit -m "$(cat <<'EOF'
voting: OfflineAdapter class + tests

Wraps real postVote with offline-awareness. Queue is the single write
path when non-empty: writes during drain append to the tail rather than
firing in parallel, linearising ordering and deferring conflict logic
to PR 3. Online+empty → direct post. Network throws → enqueue. 4xx/5xx
→ pass through (Autosaver flips to `error`). Drain triggers: `online`
event + opportunistically on each post. All externals (isOnline, event
listener, storage, uuid, now) injected for testability.

12 unit tests cover every matrix cell in the design doc's §5 decision
table plus dispose behaviour.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extend `SaveChip` with the offline branch

**Files:**
- Modify: `src/components/voting/SaveChip.tsx`

Widen the status union; add the `offline` visual state. Keep `error` for genuine server-side failures.

- [ ] **Step 3.1: Replace `SaveChip.tsx`**

Replace the entire contents of `src/components/voting/SaveChip.tsx`:

```tsx
import type { SaveStatus } from "@/lib/voting/Autosaver";

export type DisplaySaveStatus = SaveStatus | "offline";

export interface SaveChipProps {
  status: DisplaySaveStatus;
}

/**
 * Persistent save indicator per SPEC §8.5. Renders nothing in `idle`.
 *
 * 5 visual states after PR 2:
 *  - idle    → hidden
 *  - saving  → "Saving…" (muted)
 *  - saved   → "✓ Saved" (primary/gold)
 *  - offline → "Offline — changes queued" (accent/pink)
 *  - error   → "Save failed" (destructive/red) — genuine 4xx/5xx only;
 *              network errors route to the offline queue
 */
export default function SaveChip({ status }: SaveChipProps) {
  if (status === "idle") return null;
  const base = "text-xs font-medium";
  if (status === "saving") {
    return (
      <span className={`${base} text-muted-foreground`} aria-live="polite">
        Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className={`${base} text-primary`} aria-live="polite">
        ✓ Saved
      </span>
    );
  }
  if (status === "offline") {
    return (
      <span className={`${base} text-accent`} aria-live="polite">
        Offline — changes queued
      </span>
    );
  }
  return (
    <span
      className={`${base} text-destructive`}
      aria-live="polite"
      role="alert"
    >
      Save failed
    </span>
  );
}
```

- [ ] **Step 3.2: Verify type-check**

Run: `npm run type-check`
Expected: errors at `useVoteAutosave.ts` and `VotingView.tsx` because the `saveStatus` prop narrowed type no longer matches. Those are fixed in Tasks 4 + 6.

Leave uncommitted for now — we'll commit Tasks 3 + 4 + 5 + 6 + 7 together at the end of Task 7 when the tree is green.

---

## Task 4: New `OfflineBanner` leaf component

**Files:**
- Create: `src/components/voting/OfflineBanner.tsx`

- [ ] **Step 4.1: Create the component**

Create `src/components/voting/OfflineBanner.tsx`:

```tsx
export interface OfflineBannerProps {
  visible: boolean;
}

/**
 * Sticky top-of-screen banner shown when the browser is offline.
 * SPEC §8.5 copy: "You're offline — changes will sync when you reconnect."
 * Rendered at the top of the voting card; hidden (returns null) when the
 * browser is online even if the queue isn't empty (mid-drain UX stays quiet).
 */
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

- [ ] **Step 4.2: Verify type-check status unchanged**

Run: `npm run type-check`
Expected: same errors as after Task 3 (adapter/banner changes introduce no new errors; still need Tasks 5/6/7 to close).

---

## Task 5: Compose in `useVoteAutosave`

**Files:**
- Modify: `src/components/voting/useVoteAutosave.ts`

- [ ] **Step 5.1: Replace `useVoteAutosave.ts`**

Replace the entire file:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Autosaver, type SaveStatus } from "@/lib/voting/Autosaver";
import {
  OfflineAdapter,
  type OfflineAdapterState,
} from "@/lib/voting/OfflineAdapter";
import type { PostVoteInput, PostVoteResult } from "@/lib/voting/postVote";
import type { DisplaySaveStatus } from "@/components/voting/SaveChip";

export interface UseVoteAutosaveParams {
  roomId: string;
  userId: string | null;
  post: (payload: PostVoteInput) => Promise<PostVoteResult>;
}

export interface UseVoteAutosaveResult {
  onScoreChange: (
    contestantId: string,
    categoryName: string,
    next: number | null
  ) => void;
  status: DisplaySaveStatus;
  offlineBannerVisible: boolean;
}

/**
 * Hook that composes:
 *  - Autosaver (debounced, per-contestant coalesce; unchanged from PR #22)
 *  - OfflineAdapter (wraps post with localStorage queue + online detection)
 *
 * DisplaySaveStatus = "offline" when the queue is non-empty OR the browser
 * is offline; otherwise the Autosaver's status. offlineBannerVisible is
 * strictly `!online` (mid-drain UX shows only the chip, not the banner).
 *
 * See docs/superpowers/specs/2026-04-24-voting-offline-queue-design.md §6.
 */
export function useVoteAutosave(
  params: UseVoteAutosaveParams
): UseVoteAutosaveResult {
  const [autosaverStatus, setAutosaverStatus] = useState<SaveStatus>("idle");
  const [adapterState, setAdapterState] = useState<OfflineAdapterState>({
    online: true,
    queueSize: 0,
  });
  const saverRef = useRef<Autosaver | null>(null);

  useEffect(() => {
    if (!params.userId) {
      saverRef.current = null;
      setAutosaverStatus("idle");
      setAdapterState({ online: true, queueSize: 0 });
      return;
    }

    const storage =
      typeof window !== "undefined" ? window.localStorage : null;

    const adapter = new OfflineAdapter({
      realPost: params.post,
      storage,
      onStateChange: setAdapterState,
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
  }, [params.roomId, params.userId, params.post]);

  const onScoreChange = useCallback(
    (contestantId: string, categoryName: string, next: number | null) => {
      saverRef.current?.schedule(contestantId, categoryName, next);
    },
    []
  );

  const status: DisplaySaveStatus =
    adapterState.queueSize > 0 || !adapterState.online
      ? "offline"
      : autosaverStatus;

  return {
    onScoreChange,
    status,
    offlineBannerVisible: !adapterState.online,
  };
}
```

- [ ] **Step 5.2: Verify type-check**

Run: `npm run type-check`
Expected: errors remaining only in `VotingView.tsx` (status type widens) and `page.tsx` (missing `offlineBannerVisible` prop). Fixed in Tasks 6 + 7.

---

## Task 6: Thread props into `VotingView`

**Files:**
- Modify: `src/components/voting/VotingView.tsx`

- [ ] **Step 6.1: Update imports + props + render**

Open `src/components/voting/VotingView.tsx`. Find:

```tsx
import SaveChip from "@/components/voting/SaveChip";
import type { SaveStatus } from "@/lib/voting/Autosaver";
```

Replace with:

```tsx
import SaveChip, { type DisplaySaveStatus } from "@/components/voting/SaveChip";
import OfflineBanner from "@/components/voting/OfflineBanner";
```

Find the props interface:

```tsx
export interface VotingViewProps {
  contestants: Contestant[];
  categories: VotingCategory[];
  isAdmin?: boolean;
  onScoreChange?: (
    contestantId: string,
    categoryName: string,
    next: number | null
  ) => void;
  saveStatus?: SaveStatus;
  initialScores?: Record<string, Record<string, number | null>>;
  /** When both roomId and userId are provided, persists the current contestant in localStorage so reloads land on the same card. */
  roomId?: string;
  userId?: string;
}
```

Replace with:

```tsx
export interface VotingViewProps {
  contestants: Contestant[];
  categories: VotingCategory[];
  isAdmin?: boolean;
  onScoreChange?: (
    contestantId: string,
    categoryName: string,
    next: number | null
  ) => void;
  saveStatus?: DisplaySaveStatus;
  initialScores?: Record<string, Record<string, number | null>>;
  /** When both roomId and userId are provided, persists the current contestant in localStorage so reloads land on the same card. */
  roomId?: string;
  userId?: string;
  offlineBannerVisible?: boolean;
}
```

Find the component destructure:

```tsx
export default function VotingView({
  contestants,
  categories,
  onScoreChange,
  saveStatus,
  initialScores,
  roomId,
  userId,
}: VotingViewProps) {
```

Replace with:

```tsx
export default function VotingView({
  contestants,
  categories,
  onScoreChange,
  saveStatus,
  initialScores,
  roomId,
  userId,
  offlineBannerVisible,
}: VotingViewProps) {
```

Now add the banner as the very first child inside the main `<main>` of the happy path (the non-empty contestants render). Find:

```tsx
  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-6 sm:px-6 sm:py-10">
      <div className="w-full max-w-xl space-y-6 animate-fade-in">
```

Replace with:

```tsx
  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-6 sm:px-6 sm:py-10">
      <OfflineBanner visible={offlineBannerVisible ?? false} />
      <div className="w-full max-w-xl space-y-6 animate-fade-in">
```

- [ ] **Step 6.2: Verify type-check**

Run: `npm run type-check`
Expected: only `page.tsx` errors remain (missing `offlineBannerVisible` prop); `SaveStatus → DisplaySaveStatus` widening is resolved because `DisplaySaveStatus` is `SaveStatus | "offline"`.

---

## Task 7: Thread the banner prop into `page.tsx` + unified commit

**Files:**
- Modify: `src/app/room/[id]/page.tsx`

- [ ] **Step 7.1: Update the voting branch**

Open `src/app/room/[id]/page.tsx`. Find:

```tsx
    return (
      <VotingView
        contestants={phase.contestants}
        categories={phase.room.categories ?? []}
        isAdmin={isAdmin}
        onScoreChange={autosave.onScoreChange}
        saveStatus={autosave.status}
        initialScores={initialScores}
        roomId={phase.room.id}
        userId={getSession()?.userId ?? undefined}
      />
    );
  }
```

Replace with:

```tsx
    return (
      <VotingView
        contestants={phase.contestants}
        categories={phase.room.categories ?? []}
        isAdmin={isAdmin}
        onScoreChange={autosave.onScoreChange}
        saveStatus={autosave.status}
        initialScores={initialScores}
        roomId={phase.room.id}
        userId={getSession()?.userId ?? undefined}
        offlineBannerVisible={autosave.offlineBannerVisible}
      />
    );
  }
```

- [ ] **Step 7.2: Run full verification**

Run: `npm run type-check`
Expected: zero errors.

Run: `npm test -- --run`
Expected: all tests green. Baseline before this PR was 569 passing / 4 todo; this PR adds 22 (10 offlineQueue + 12 OfflineAdapter) → **591 passing / 4 todo**.

Run: `npm run lint`
Expected: only the pre-existing `useRoomRealtime.ts:30` warning.

- [ ] **Step 7.3: Commit Tasks 3 + 4 + 5 + 6 + 7 together**

The tree was broken mid-chain (Task 3 widened a type that Tasks 5/6/7 close). Commit as one unit so no intermediate revision is red:

```bash
git add src/components/voting/SaveChip.tsx src/components/voting/OfflineBanner.tsx src/components/voting/useVoteAutosave.ts src/components/voting/VotingView.tsx "src/app/room/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
voting offline queue: wire SaveChip, OfflineBanner, hook, VotingView, page

Five-file wire-up committed together so the tree is never broken
mid-chain:
- SaveChip: widen union to DisplaySaveStatus = SaveStatus | "offline";
  new accent-pink "Offline — changes queued" branch between saved and
  the destructive "Save failed"
- OfflineBanner: new leaf; sticky at top of voting card with SPEC §8.5
  copy; hidden when !visible
- useVoteAutosave: instantiate OfflineAdapter alongside Autosaver; wrap
  post through adapter; derive DisplaySaveStatus from adapter state +
  Autosaver status; expose offlineBannerVisible
- VotingView: accept offlineBannerVisible prop; render OfflineBanner at
  top of <main>; widen saveStatus prop type to DisplaySaveStatus
- page.tsx: thread autosave.offlineBannerVisible into VotingView

Writes route through the offline queue when navigator.onLine=false or
real post throws. Chip flips to "Offline — changes queued" with the
first queue entry. `online` event drains FIFO; queue persists across
reloads in localStorage.emx_offline_queue.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Final verification + push + PR

- [ ] **Step 8.1: Branch state**

Run: `git log --oneline main..HEAD`
Expected: 5 entries:

```
<sha> voting offline queue: wire SaveChip, OfflineBanner, hook, VotingView, page
<sha> voting: OfflineAdapter class + tests
<sha> voting: offlineQueue helpers + tests
<sha> docs: plan for voting autosave PR 2 of 3 (offline queue + banner)
<sha> docs: design for voting autosave PR 2 of 3 (offline queue + banner)
```

- [ ] **Step 8.2: Full suite + type-check + lint**

Run all three in sequence:

```bash
npm run type-check
npm test -- --run
npm run lint
```

Expected: tsc clean; tests 591 passing / 4 todo; lint only pre-existing warning.

- [ ] **Step 8.3: Manual smoke**

1. `npm run dev`
2. Create room + join on a second tab
3. As admin: Start voting
4. Score a few categories — chip `Saving…` → `✓ Saved`
5. DevTools → Network → Offline
6. Score another category → banner appears at top; chip → `Offline — changes queued`
7. DevTools → Application → Local Storage → `emx_offline_queue` key has entries
8. Re-enable network → banner disappears; chip cycles back to `✓ Saved`; Network tab shows the drained POSTs
9. Reload mid-offline (put network back offline first) → banner + chip restored from storage
10. Reload with empty queue → clean "Not scored" chip behaviour

- [ ] **Step 8.4: Push + open PR**

```bash
git push -u origin feat/voting-offline-queue
gh pr create --title "Phase 3: voting autosave — offline queue + banner (2 of 3)" --body "<body>"
```

Body highlights:
- `OfflineAdapter` wraps real postVote; writes through localStorage queue on network failure
- New `offline` chip state (accent-pink) sits between `saved` and `error`
- Banner renders only when `!navigator.onLine`; chip handles mid-drain UX
- Autosaver unchanged — status truth layered in the hook
- Out of scope: conflict reconciliation, 200-entry cap, status-transition abort (all PR 3)

---

## Self-review

**Spec coverage (design doc §1–§13):**
- §3 architecture → Tasks 2 + 5 (adapter wraps post; hook composes status).
- §4 queue entry shape → Task 1 (`QueueEntry` type; Task 2 populates `id`/`timestamp` via injected deps).
- §5.1 public API → Task 2.
- §5.2 decision matrix → Task 2 tests cover all 4 cells plus drain paths.
- §5.3 drain loop → Task 2 implementation + 3 drain-specific tests.
- §5.4 crash safety → Task 2 "drain: entry throws → stops; entry remains" test.
- §5.5 dispose → Task 2 dispose test.
- §6 hook composition → Task 5.
- §7 SaveChip → Task 3.
- §8 OfflineBanner → Task 4.
- §9 VotingView render → Task 6.
- §10 page wiring → Task 7.
- §11.1 queue helpers tests → Task 1.
- §11.2 adapter tests → Task 2.
- §12 non-obvious decisions — embedded in commit messages + code.
- §13 follow-ups — tracked, not implemented.

**Placeholder scan:** no TBDs / hand-wavy steps; every code block is complete.

**Type consistency across tasks:**
- `SaveStatus` (unchanged) from `Autosaver.ts` imported in Tasks 2, 3, 5.
- `DisplaySaveStatus = SaveStatus | "offline"` defined in Task 3, consumed in Tasks 5 and 6.
- `QueueEntry` shape `{ id, timestamp, payload }` consistent in Tasks 1 and 2.
- `OfflineAdapterState { online, queueSize }` defined in Task 2, consumed in Task 5.
- `PostVoteInput` / `PostVoteResult` reused unchanged from PR #22.
