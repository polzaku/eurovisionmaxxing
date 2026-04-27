import { describe, it, expect } from "vitest";
import { nextRevealCtaState } from "./nextRevealCtaState";

const NOW = 1_000_000_000_000; // arbitrary ms epoch

describe("nextRevealCtaState", () => {
  it("returns disabled state when no one is ready", () => {
    expect(
      nextRevealCtaState({
        readyCount: 0,
        totalCount: 6,
        firstReadyAt: null,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: false,
      canRevealAnyway: false,
      anywayLabel: { kind: "disabled" },
    });
  });

  it("canRevealAll true when everyone ready", () => {
    expect(
      nextRevealCtaState({
        readyCount: 6,
        totalCount: 6,
        firstReadyAt: NOW - 5_000,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: true,
      canRevealAnyway: true,
      anywayLabel: { kind: "halfReady", readyCount: 6, totalCount: 6 },
    });
  });

  it("canRevealAnyway true at exactly half ready", () => {
    expect(
      nextRevealCtaState({
        readyCount: 3,
        totalCount: 6,
        firstReadyAt: NOW - 1_000,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: false,
      canRevealAnyway: true,
      anywayLabel: { kind: "halfReady", readyCount: 3, totalCount: 6 },
    });
  });

  it("just under half: countdown active, canRevealAnyway false", () => {
    expect(
      nextRevealCtaState({
        readyCount: 2,
        totalCount: 6,
        firstReadyAt: NOW - 30_000,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: false,
      canRevealAnyway: false,
      anywayLabel: { kind: "countdown", secondsRemaining: 30 },
    });
  });

  it("60s elapsed exactly: countdown shows 0, canRevealAnyway true", () => {
    expect(
      nextRevealCtaState({
        readyCount: 1,
        totalCount: 6,
        firstReadyAt: NOW - 60_000,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: false,
      canRevealAnyway: true,
      anywayLabel: { kind: "countdown", secondsRemaining: 0 },
    });
  });

  it("75s elapsed (clamped): countdown shows 0, canRevealAnyway true", () => {
    expect(
      nextRevealCtaState({
        readyCount: 1,
        totalCount: 6,
        firstReadyAt: NOW - 75_000,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: false,
      canRevealAnyway: true,
      anywayLabel: { kind: "countdown", secondsRemaining: 0 },
    });
  });

  it("1s elapsed: countdown shows 59", () => {
    expect(
      nextRevealCtaState({
        readyCount: 1,
        totalCount: 6,
        firstReadyAt: NOW - 1_000,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: false,
      canRevealAnyway: false,
      anywayLabel: { kind: "countdown", secondsRemaining: 59 },
    });
  });

  it("solo room (totalCount=1, readyCount=1): canRevealAll", () => {
    expect(
      nextRevealCtaState({
        readyCount: 1,
        totalCount: 1,
        firstReadyAt: NOW - 100,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: true,
      canRevealAnyway: true,
      anywayLabel: { kind: "halfReady", readyCount: 1, totalCount: 1 },
    });
  });

  it("totalCount=0 (degenerate): everything false, disabled label", () => {
    expect(
      nextRevealCtaState({
        readyCount: 0,
        totalCount: 0,
        firstReadyAt: null,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: false,
      canRevealAnyway: false,
      anywayLabel: { kind: "disabled" },
    });
  });

  it("readyCount > 0 but firstReadyAt null (defensive): treat as disabled", () => {
    expect(
      nextRevealCtaState({
        readyCount: 2,
        totalCount: 6,
        firstReadyAt: null,
        now: NOW,
      }),
    ).toEqual({
      canRevealAll: false,
      canRevealAnyway: false,
      anywayLabel: { kind: "disabled" },
    });
  });
});
