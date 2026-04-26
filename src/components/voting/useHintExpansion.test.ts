import { describe, it, expect } from "vitest";
import {
  nextHintExpansion,
  type HintExpansionState,
} from "./useHintExpansion";

const NAMES = ["Vocals", "Music", "Outfit"] as const;

function initialState(roomSeen: boolean, contestantId = "C1"): HintExpansionState {
  return nextHintExpansion(
    {} as HintExpansionState,
    { type: "init", roomSeen, contestantId },
  );
}

describe("nextHintExpansion", () => {
  it("init when roomSeen=true → not onboarding, no overrides", () => {
    const state = initialState(true);
    expect(state).toEqual({
      contestantId: "C1",
      onboarding: false,
      overrides: {},
    });
  });

  it("init when roomSeen=false → onboarding=true, no overrides", () => {
    const state = initialState(false);
    expect(state).toEqual({
      contestantId: "C1",
      onboarding: true,
      overrides: {},
    });
  });

  it("contestantChanged clears overrides, keeps onboarding flag, updates id", () => {
    const seeded: HintExpansionState = {
      contestantId: "C1",
      onboarding: true,
      overrides: { Vocals: false },
    };
    const next = nextHintExpansion(seeded, {
      type: "contestantChanged",
      contestantId: "C2",
    });
    expect(next).toEqual({
      contestantId: "C2",
      onboarding: true,
      overrides: {},
    });
  });

  it("contestantChanged preserves onboarding=false too", () => {
    const seeded: HintExpansionState = {
      contestantId: "C1",
      onboarding: false,
      overrides: { Vocals: true },
    };
    const next = nextHintExpansion(seeded, {
      type: "contestantChanged",
      contestantId: "C2",
    });
    expect(next.onboarding).toBe(false);
    expect(next.overrides).toEqual({});
    expect(next.contestantId).toBe("C2");
  });

  it("toggle while onboarding flips effective value (true→false) and clears onboarding", () => {
    const state = initialState(false); // onboarding = true (default expanded)
    const next = nextHintExpansion(state, {
      type: "toggle",
      name: "Vocals",
      namesInDisplayOrder: NAMES,
    });
    expect(next.overrides).toEqual({ Vocals: false });
    expect(next.onboarding).toBe(false);
  });

  it("toggle while steady flips effective value (false→true), onboarding stays false", () => {
    const state = initialState(true); // onboarding = false (default collapsed)
    const next = nextHintExpansion(state, {
      type: "toggle",
      name: "Vocals",
      namesInDisplayOrder: NAMES,
    });
    expect(next.overrides).toEqual({ Vocals: true });
    expect(next.onboarding).toBe(false);
  });

  it("toggle twice on the same name returns to default", () => {
    const state = initialState(true); // default collapsed (false)
    const after1 = nextHintExpansion(state, {
      type: "toggle",
      name: "Vocals",
      namesInDisplayOrder: NAMES,
    });
    const after2 = nextHintExpansion(after1, {
      type: "toggle",
      name: "Vocals",
      namesInDisplayOrder: NAMES,
    });
    expect(after2.overrides).toEqual({ Vocals: false });
  });

  it("scored from onboarding → onboarding flips false, overrides untouched", () => {
    const state = initialState(false);
    const next = nextHintExpansion(state, { type: "scored" });
    expect(next.onboarding).toBe(false);
    expect(next.overrides).toEqual({});
    expect(next.contestantId).toBe("C1");
  });

  it("scored when already steady is identity (referentially equal)", () => {
    const state = initialState(true);
    const next = nextHintExpansion(state, { type: "scored" });
    expect(next).toBe(state);
  });

  it("navigated mirrors scored", () => {
    const state = initialState(false);
    const next = nextHintExpansion(state, { type: "navigated" });
    expect(next.onboarding).toBe(false);
    expect(next.overrides).toEqual({});
  });
});
