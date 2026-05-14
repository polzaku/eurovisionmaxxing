import { describe, it, expect } from "vitest";
import {
  drillDownReducer,
  type DrillDownState,
} from "@/components/results/drill-down/drillDownState";

describe("drillDownReducer", () => {
  it("initial null state stays null on close", () => {
    expect(drillDownReducer(null, { type: "close" })).toBeNull();
  });

  it("open contestant from null returns the contestant payload", () => {
    expect(
      drillDownReducer(null, {
        type: "open",
        payload: { kind: "contestant", contestantId: "2026-se" },
      }),
    ).toEqual({ kind: "contestant", contestantId: "2026-se" });
  });

  it("open participant from null returns the participant payload", () => {
    expect(
      drillDownReducer(null, {
        type: "open",
        payload: { kind: "participant", userId: "u1" },
      }),
    ).toEqual({ kind: "participant", userId: "u1" });
  });

  it("open category from null returns the category payload", () => {
    expect(
      drillDownReducer(null, {
        type: "open",
        payload: { kind: "category", categoryKey: "vocals" },
      }),
    ).toEqual({ kind: "category", categoryKey: "vocals" });
  });

  it("opening a new kind while another is open replaces (only one open at a time)", () => {
    const open: DrillDownState = { kind: "contestant", contestantId: "2026-se" };
    expect(
      drillDownReducer(open, {
        type: "open",
        payload: { kind: "participant", userId: "u1" },
      }),
    ).toEqual({ kind: "participant", userId: "u1" });
  });

  it("close from any open state returns null", () => {
    const open: DrillDownState = { kind: "participant", userId: "u2" };
    expect(drillDownReducer(open, { type: "close" })).toBeNull();
  });
});
