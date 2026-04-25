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
    expect(result.ok).toBe(true);
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
    const fx = makeAdapter({ initialQueue: [existing], postImpl });
    // The initial drain is in-flight (waiting on resolveFirst). New write should enqueue.
    const p = fx.adapter.post(payload());
    expect(fx.storage.read()).toHaveLength(2);
    resolveFirst(ok());
    const result = await p;
    expect(result.ok).toBe(true);
    // Wait microtasks for chained drain to complete.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
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
    const countBefore = fx.states.length;
    fx.adapter.dispose();
    fx.fireOnline();
    expect(fx.states.length).toBe(countBefore);
  });
});
