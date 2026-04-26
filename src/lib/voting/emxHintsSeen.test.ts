import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { seenHintsKey, isSeen, markSeen } from "./emxHintsSeen";

describe("seenHintsKey", () => {
  it("formats as emx_hints_seen_{roomId}", () => {
    expect(seenHintsKey("abc-123")).toBe("emx_hints_seen_abc-123");
  });
});

describe("isSeen / markSeen — happy path", () => {
  const ORIGINAL_LOCAL_STORAGE = globalThis.localStorage;
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: ORIGINAL_LOCAL_STORAGE,
    });
  });

  it("isSeen returns false when key is unset", () => {
    expect(isSeen("room-1")).toBe(false);
  });

  it("markSeen writes 'true' to the right key", () => {
    markSeen("room-2");
    expect(store["emx_hints_seen_room-2"]).toBe("true");
  });

  it("isSeen returns true after markSeen", () => {
    markSeen("room-3");
    expect(isSeen("room-3")).toBe(true);
  });

  it("isSeen returns false for a different room than the one marked", () => {
    markSeen("room-A");
    expect(isSeen("room-B")).toBe(false);
  });
});

describe("isSeen / markSeen — SSR safety", () => {
  const ORIGINAL_WINDOW = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
  });

  it("isSeen returns false when window is undefined", () => {
    expect(isSeen("any")).toBe(false);
  });

  it("markSeen does not throw when window is undefined", () => {
    expect(() => markSeen("any")).not.toThrow();
  });
});

describe("isSeen / markSeen — localStorage throw safety", () => {
  const ORIGINAL_LOCAL_STORAGE = globalThis.localStorage;

  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
        removeItem: () => {
          throw new Error("denied");
        },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: ORIGINAL_LOCAL_STORAGE,
    });
  });

  it("isSeen returns false when localStorage.getItem throws", () => {
    expect(isSeen("any")).toBe(false);
  });

  it("markSeen does not propagate when localStorage.setItem throws", () => {
    expect(() => markSeen("any")).not.toThrow();
  });
});
