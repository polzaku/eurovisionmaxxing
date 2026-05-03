// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  markLobbySeen,
  useLateJoinerVisibility,
} from "./useLateJoinerVisibility";

const ROOM = "r-late-1";
const USER = "u-late-1";

// Node ≥25 ships an incomplete built-in `localStorage` global that shadows
// jsdom's full Storage in this test env (no setItem / removeItem / clear).
// Install a real-shaped stub on `window` so the hook's storage() returns
// something it can actually read/write through.
let store: Record<string, string>;
const ORIGINAL = (
  window as unknown as { localStorage?: Storage }
).localStorage;

beforeEach(() => {
  store = {};
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        store = {};
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
      get length() {
        return Object.keys(store).length;
      },
    },
  });
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: ORIGINAL,
  });
});

describe("useLateJoinerVisibility", () => {
  it("shows the card for a genuine late joiner (status=voting, no flags set)", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: string }) =>
        useLateJoinerVisibility(ROOM, USER, status),
      { initialProps: { status: "voting" } },
    );
    expect(result.current.visibility).toBe("show");

    rerender({ status: "voting_ending" });
    expect(result.current.visibility).toBe("show");
  });

  it("keeps the card hidden after a lobby→voting transition when markLobbySeen was called during lobby", () => {
    // SPEC §6.3.2: a user present during lobby must NOT see the late-joiner
    // card after the room transitions to voting. Reproduces the bug where
    // the hook's effect deps don't include `status`, so it never re-reads
    // the lobby-seen flag that was written during the lobby render.
    const { result, rerender } = renderHook(
      ({ status }: { status: string }) =>
        useLateJoinerVisibility(ROOM, USER, status),
      { initialProps: { status: "lobby" } },
    );
    expect(result.current.visibility).toBe("hidden");

    // Mirrors the room/[id]/page.tsx side-effect that runs while status=lobby.
    act(() => {
      markLobbySeen(ROOM, USER);
    });

    // Realtime status_changed → re-render with the new status.
    rerender({ status: "voting" });
    expect(result.current.visibility).toBe("hidden");

    rerender({ status: "voting_ending" });
    expect(result.current.visibility).toBe("hidden");
  });

  it("keeps the card hidden across remount once the lobby-seen flag is in storage", () => {
    markLobbySeen(ROOM, USER);
    const { result } = renderHook(() =>
      useLateJoinerVisibility(ROOM, USER, "voting"),
    );
    expect(result.current.visibility).toBe("hidden");
  });

  it("dismiss() suppresses the card permanently for this user/room pair", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: string }) =>
        useLateJoinerVisibility(ROOM, USER, status),
      { initialProps: { status: "voting" } },
    );
    expect(result.current.visibility).toBe("show");

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.visibility).toBe("hidden");

    // Survives a re-render at a later status.
    rerender({ status: "voting_ending" });
    expect(result.current.visibility).toBe("hidden");
  });

  it("does not leak suppression across user or room boundaries", () => {
    markLobbySeen(ROOM, USER);

    const { result } = renderHook(() =>
      useLateJoinerVisibility("other-room", USER, "voting"),
    );
    expect(result.current.visibility).toBe("show");

    const { result: r2 } = renderHook(() =>
      useLateJoinerVisibility(ROOM, "other-user", "voting"),
    );
    expect(r2.current.visibility).toBe("show");
  });
});
