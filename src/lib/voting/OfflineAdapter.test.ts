import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  OfflineAdapter,
  type OfflineAdapterState,
  type OfflineAdapterDeps,
  type DrainNotice,
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

  it("200-cap: enqueueing past the cap evicts the oldest and emits overflowed: true", async () => {
    const states: OfflineAdapterState[] = [];
    const realPost = vi.fn(async () => ok());
    const storageMock = makeStorage();
    const adapter = new OfflineAdapter({
      realPost,
      storage: storageMock.storage,
      onStateChange: (s) => states.push(s),
      isOnline: () => false,
      addOnlineListener: () => () => {},
      now: () => 1000,
      uuid: () => Math.random().toString(36).slice(2, 10),
      maxQueueSize: 2,
    });

    await adapter.post(payload("2026-ua"));
    await adapter.post(payload("2026-se"));
    await adapter.post(payload("2026-fr"));

    expect(storageMock.read()).toHaveLength(2);
    const remaining = storageMock.read().map((e) => e.payload.contestantId);
    expect(remaining).toEqual(["2026-se", "2026-fr"]);
    expect(states[states.length - 1]).toMatchObject({ overflowed: true });
    adapter.dispose();
  });

  it("drain: fetchServerVotes returning newer updatedAt → entry skipped + notice fired", async () => {
    const stale: QueueEntry = {
      id: "stale",
      timestamp: 1000,
      payload: payload("2026-ua"),
    };
    const fresh: QueueEntry = {
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
      ],
      onDrainComplete: (n) => {
        notice = n;
      },
    });

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
    const e: QueueEntry = {
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
    const e1: QueueEntry = {
      id: "e1",
      timestamp: 9_999_999_999_999,
      payload: { ...payload("2026-ua"), roomId: ROOM_X },
    };
    const e2: QueueEntry = {
      id: "e2",
      timestamp: 9_999_999_999_999,
      payload: { ...payload("2026-se"), roomId: ROOM_X },
    };
    const e3: QueueEntry = {
      id: "e3",
      timestamp: 9_999_999_999_999,
      payload: payload("2026-fr"),
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
    const oldEntries: QueueEntry[] = Array.from({ length: 3 }, (_, i) => ({
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

    for (let i = 0; i < 15; i++) await Promise.resolve();

    expect(storageMock.read()).toEqual([]);
    expect(states[states.length - 1]).toMatchObject({
      queueSize: 0,
      overflowed: false,
    });
    adapter.dispose();
  });

  it("polls periodically while queue is non-empty and online (catches missed `online` events)", async () => {
    // Use injected timer hooks so we don't depend on real time.
    const intervalCbRef: { current: (() => void) | null } = { current: null };
    const setIntervalFn = vi.fn((cb: () => void, _ms: number) => {
      intervalCbRef.current = cb;
      return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
    }) as unknown as typeof globalThis.setInterval;
    const clearIntervalFn = vi.fn(() => {
      intervalCbRef.current = null;
    }) as unknown as typeof globalThis.clearInterval;

    const states: OfflineAdapterState[] = [];
    const online = { value: true };
    const storageMock = makeStorage([
      { id: "stuck", timestamp: 1, payload: payload() },
    ]);

    // Force drain failure on first attempt so the queue stays populated.
    let firstAttempt = true;
    const flakyPost = vi.fn(async (_p: PostVoteInput) => {
      if (firstAttempt) {
        firstAttempt = false;
        throw new Error("transient");
      }
      return ok();
    });

    const adapter = new OfflineAdapter({
      realPost: flakyPost,
      storage: storageMock.storage,
      onStateChange: (s) => states.push(s),
      isOnline: () => online.value,
      addOnlineListener: () => () => {},
      now: () => 1000,
      uuid: () => "test",
      pollIntervalMs: 5000,
      setInterval: setIntervalFn,
      clearInterval: clearIntervalFn,
    });

    // Wait for the initial drain attempt to throw and unset draining.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(storageMock.read()).toHaveLength(1); // entry still there
    expect(setIntervalFn).toHaveBeenCalled(); // poll started

    // Simulate the interval firing — should retry drain and succeed.
    intervalCbRef.current?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(storageMock.read()).toEqual([]);
    expect(clearIntervalFn).toHaveBeenCalled(); // poll stopped after queue empty
    adapter.dispose();
  });
});
