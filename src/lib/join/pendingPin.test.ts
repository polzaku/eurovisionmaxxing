import { describe, it, expect } from "vitest";
import {
  PENDING_PIN_STORAGE_KEY,
  stashPendingPin,
  readPendingPin,
  clearPendingPin,
} from "@/lib/join/pendingPin";

function makeFakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe("pendingPin", () => {
  it("stashes and reads back a PIN using the expected storage key", () => {
    const storage = makeFakeStorage();
    stashPendingPin(storage, "ABCDEF");
    expect(storage.getItem(PENDING_PIN_STORAGE_KEY)).toBe("ABCDEF");
    expect(readPendingPin(storage)).toBe("ABCDEF");
  });

  it("returns null when nothing is stashed", () => {
    const storage = makeFakeStorage();
    expect(readPendingPin(storage)).toBeNull();
  });

  it("clears the stash", () => {
    const storage = makeFakeStorage();
    stashPendingPin(storage, "ABCDEF");
    clearPendingPin(storage);
    expect(readPendingPin(storage)).toBeNull();
  });

  it("overwrites a previously stashed PIN", () => {
    const storage = makeFakeStorage();
    stashPendingPin(storage, "OLDPIN");
    stashPendingPin(storage, "NEWPIN");
    expect(readPendingPin(storage)).toBe("NEWPIN");
  });
});
