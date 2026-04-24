import { describe, it, expect, vi } from "vitest";
import {
  loadVotingPosition,
  saveVotingPosition,
  indexOfContestant,
  type PersistentStorage,
} from "@/lib/voting/votingPosition";

const ROOM_ID = "11111111-2222-4333-8444-555555555555";
const USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const KEY = `emx_voting_position_${ROOM_ID}_${USER_ID}`;

function makeStorage(initial: Record<string, string> = {}): {
  storage: PersistentStorage;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
} {
  const backing = { ...initial };
  const get = vi.fn((k: string) => backing[k] ?? null);
  const set = vi.fn((k: string, v: string) => {
    backing[k] = v;
  });
  return {
    storage: { getItem: get, setItem: set },
    get,
    set,
  };
}

describe("loadVotingPosition", () => {
  it("returns null when nothing is saved", () => {
    const { storage } = makeStorage();
    expect(loadVotingPosition(storage, ROOM_ID, USER_ID)).toBeNull();
  });

  it("returns the saved contestantId", () => {
    const { storage } = makeStorage({ [KEY]: "2026-ua" });
    expect(loadVotingPosition(storage, ROOM_ID, USER_ID)).toBe("2026-ua");
  });

  it("returns null when storage is null (e.g. SSR)", () => {
    expect(loadVotingPosition(null, ROOM_ID, USER_ID)).toBeNull();
  });

  it("returns null when getItem throws (e.g. private-mode quirks)", () => {
    const storage: PersistentStorage = {
      getItem: () => {
        throw new Error("storage denied");
      },
      setItem: () => {},
    };
    expect(loadVotingPosition(storage, ROOM_ID, USER_ID)).toBeNull();
  });
});

describe("saveVotingPosition", () => {
  it("writes the contestantId under the scoped key", () => {
    const { storage, set } = makeStorage();
    saveVotingPosition(storage, ROOM_ID, USER_ID, "2026-ua");
    expect(set).toHaveBeenCalledWith(KEY, "2026-ua");
  });

  it("no-ops when storage is null", () => {
    expect(() =>
      saveVotingPosition(null, ROOM_ID, USER_ID, "2026-ua")
    ).not.toThrow();
  });

  it("swallows setItem errors silently", () => {
    const storage: PersistentStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    };
    expect(() =>
      saveVotingPosition(storage, ROOM_ID, USER_ID, "2026-ua")
    ).not.toThrow();
  });
});

describe("indexOfContestant", () => {
  const contestants = [
    { id: "2026-ua" },
    { id: "2026-se" },
    { id: "2026-gb" },
  ];

  it("returns the index of a matching contestant", () => {
    expect(indexOfContestant(contestants, "2026-se")).toBe(1);
  });

  it("returns -1 when the id is not in the list", () => {
    expect(indexOfContestant(contestants, "2026-xx")).toBe(-1);
  });

  it("returns -1 when id is null", () => {
    expect(indexOfContestant(contestants, null)).toBe(-1);
  });

  it("returns -1 when id is an empty string", () => {
    expect(indexOfContestant(contestants, "")).toBe(-1);
  });

  it("returns -1 when the list is empty", () => {
    expect(indexOfContestant([], "2026-ua")).toBe(-1);
  });
});
