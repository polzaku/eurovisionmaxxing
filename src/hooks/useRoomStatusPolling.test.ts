// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { useRoomStatusPolling } from "./useRoomStatusPolling";

describe("useRoomStatusPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls every 3s while status is voting_ending", () => {
    const loadRoom = vi.fn();
    renderHook(() =>
      useRoomStatusPolling("room-1", "voting_ending", loadRoom),
    );
    expect(loadRoom).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3000);
    expect(loadRoom).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3000);
    expect(loadRoom).toHaveBeenCalledTimes(2);
  });

  it("polls every 3s while status is scoring", () => {
    const loadRoom = vi.fn();
    renderHook(() => useRoomStatusPolling("room-1", "scoring", loadRoom));

    vi.advanceTimersByTime(3000);
    expect(loadRoom).toHaveBeenCalledTimes(1);
  });

  it("stops polling once status reaches done", () => {
    const loadRoom = vi.fn();
    const { rerender } = renderHook(
      ({ status }: { status: string | null }) =>
        useRoomStatusPolling("room-1", status, loadRoom),
      { initialProps: { status: "scoring" } },
    );

    vi.advanceTimersByTime(3000);
    expect(loadRoom).toHaveBeenCalledTimes(1);

    rerender({ status: "done" });
    vi.advanceTimersByTime(10_000);
    expect(loadRoom).toHaveBeenCalledTimes(1);
  });

  it("does not poll for steady states like voting / lobby / announcing", () => {
    const loadRoom = vi.fn();
    renderHook(() => useRoomStatusPolling("room-1", "voting", loadRoom));

    vi.advanceTimersByTime(10_000);
    expect(loadRoom).not.toHaveBeenCalled();
  });

  it("refetches once on visibilitychange→visible for non-terminal statuses", () => {
    const loadRoom = vi.fn();
    renderHook(() => useRoomStatusPolling("room-1", "voting", loadRoom));

    // Simulate the document becoming visible after a background period.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(loadRoom).toHaveBeenCalledTimes(1);
  });

  it("does not refetch on visibilitychange when status is done", () => {
    const loadRoom = vi.fn();
    renderHook(() => useRoomStatusPolling("room-1", "done", loadRoom));

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(loadRoom).not.toHaveBeenCalled();
  });

  it("is a no-op when roomId is null", () => {
    const loadRoom = vi.fn();
    renderHook(() => useRoomStatusPolling(null, "voting_ending", loadRoom));

    vi.advanceTimersByTime(10_000);
    expect(loadRoom).not.toHaveBeenCalled();
  });
});
