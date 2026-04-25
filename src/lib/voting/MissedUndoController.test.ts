import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MissedUndoController,
  type MissedUndoToast,
} from "@/lib/voting/MissedUndoController";

function setup() {
  const onUndo = vi.fn();
  const states: (MissedUndoToast | null)[] = [];
  const ctrl = new MissedUndoController({
    onUndo,
    onChange: (t) => states.push(t),
    ttlMs: 5000,
  });
  return { ctrl, onUndo, states };
}

describe("MissedUndoController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts with no toast", () => {
    const { ctrl } = setup();
    expect(ctrl.current).toBeNull();
  });

  it("trigger sets toast and arms a timer that auto-clears at ttlMs", async () => {
    const { ctrl, states } = setup();
    ctrl.trigger("c1", 7);
    expect(ctrl.current).toEqual({ contestantId: "c1", projectedOverall: 7 });
    expect(states[states.length - 1]).toEqual({
      contestantId: "c1",
      projectedOverall: 7,
    });

    await vi.advanceTimersByTimeAsync(4999);
    expect(ctrl.current).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(ctrl.current).toBeNull();
    expect(states[states.length - 1]).toBeNull();
  });

  it("undo calls onUndo with the toast's contestantId and clears", () => {
    const { ctrl, onUndo } = setup();
    ctrl.trigger("c1", 7);
    ctrl.undo();
    expect(onUndo).toHaveBeenCalledWith("c1");
    expect(ctrl.current).toBeNull();
  });

  it("undo without an active toast is a no-op", () => {
    const { ctrl, onUndo } = setup();
    ctrl.undo();
    expect(onUndo).not.toHaveBeenCalled();
    expect(ctrl.current).toBeNull();
  });

  it("a second trigger replaces the toast and re-arms the timer", async () => {
    const { ctrl } = setup();
    ctrl.trigger("c1", 7);
    await vi.advanceTimersByTimeAsync(4000); // 1s of life left
    ctrl.trigger("c2", 8);
    expect(ctrl.current).toEqual({ contestantId: "c2", projectedOverall: 8 });

    await vi.advanceTimersByTimeAsync(4999);
    expect(ctrl.current).not.toBeNull(); // re-armed for full 5s
    await vi.advanceTimersByTimeAsync(1);
    expect(ctrl.current).toBeNull();
  });

  it("dismiss clears immediately without calling onUndo", () => {
    const { ctrl, onUndo } = setup();
    ctrl.trigger("c1", 7);
    ctrl.dismiss();
    expect(ctrl.current).toBeNull();
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("dispose cancels the active timer (no leak after disposal)", async () => {
    const { ctrl, states } = setup();
    ctrl.trigger("c1", 7);
    const lengthBeforeDispose = states.length;
    ctrl.dispose();
    await vi.advanceTimersByTimeAsync(10000);
    expect(states.length).toBe(lengthBeforeDispose);
  });
});
