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
