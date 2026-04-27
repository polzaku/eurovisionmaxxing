import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  revealedFlagKey,
  hasRevealed,
  markRevealed,
  clearRevealed,
} from "./sessionRevealedFlag";

describe("revealedFlagKey", () => {
  it("formats as emx_revealed_{roomId}", () => {
    expect(revealedFlagKey("abc-123")).toBe("emx_revealed_abc-123");
  });
});

describe("sessionRevealedFlag — happy path", () => {
  const ORIGINAL = globalThis.sessionStorage;
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    Object.defineProperty(globalThis, "sessionStorage", {
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
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: ORIGINAL,
    });
  });

  it("hasRevealed returns false initially", () => {
    expect(hasRevealed("room-1")).toBe(false);
  });

  it("markRevealed writes 'true' to the right key", () => {
    markRevealed("room-2");
    expect(store["emx_revealed_room-2"]).toBe("true");
  });

  it("hasRevealed returns true after markRevealed", () => {
    markRevealed("room-3");
    expect(hasRevealed("room-3")).toBe(true);
  });

  it("isolates keys per roomId", () => {
    markRevealed("room-A");
    expect(hasRevealed("room-B")).toBe(false);
  });

  it("clearRevealed removes the key", () => {
    markRevealed("room-4");
    clearRevealed("room-4");
    expect(hasRevealed("room-4")).toBe(false);
  });
});

describe("sessionRevealedFlag — SSR safety", () => {
  const ORIGINAL_WINDOW = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
  });

  it("hasRevealed returns false when window is undefined", () => {
    expect(hasRevealed("any")).toBe(false);
  });

  it("markRevealed does not throw when window is undefined", () => {
    expect(() => markRevealed("any")).not.toThrow();
  });

  it("clearRevealed does not throw when window is undefined", () => {
    expect(() => clearRevealed("any")).not.toThrow();
  });
});

describe("sessionRevealedFlag — throw safety", () => {
  const ORIGINAL = globalThis.sessionStorage;

  beforeEach(() => {
    Object.defineProperty(globalThis, "sessionStorage", {
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
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: ORIGINAL,
    });
  });

  it("hasRevealed returns false when sessionStorage.getItem throws", () => {
    expect(hasRevealed("any")).toBe(false);
  });

  it("markRevealed swallows when sessionStorage.setItem throws", () => {
    expect(() => markRevealed("any")).not.toThrow();
  });

  it("clearRevealed swallows when sessionStorage.removeItem throws", () => {
    expect(() => clearRevealed("any")).not.toThrow();
  });
});
