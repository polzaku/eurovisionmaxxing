import { describe, it, expect } from "vitest";
import { staggerTick } from "./staggerTick";

describe("staggerTick", () => {
  const opts = (elapsedMs: number) => ({
    elapsedMs,
    staggerMs: 250,
    totalSteps: 5,
  });

  it("returns 0 at elapsedMs = 0 (initial snapshot, no reveals applied)", () => {
    expect(staggerTick(opts(0))).toBe(0);
  });

  it("returns 1 at elapsedMs = staggerMs", () => {
    expect(staggerTick(opts(250))).toBe(1);
  });

  it("stays on the same step until next stagger boundary", () => {
    expect(staggerTick(opts(251))).toBe(1);
    expect(staggerTick(opts(499))).toBe(1);
  });

  it("advances to step 2 at exactly 2 × staggerMs", () => {
    expect(staggerTick(opts(500))).toBe(2);
  });

  it("clamps at totalSteps once elapsed reaches staggerMs × totalSteps", () => {
    expect(staggerTick(opts(1250))).toBe(5);
    expect(staggerTick(opts(9999))).toBe(5);
  });

  it("returns 0 for negative elapsed (defensive)", () => {
    expect(staggerTick(opts(-100))).toBe(0);
  });

  it("returns 0 for totalSteps = 0 regardless of elapsed", () => {
    expect(
      staggerTick({ elapsedMs: 9999, staggerMs: 250, totalSteps: 0 }),
    ).toBe(0);
  });

  it("returns 0 for staggerMs = 0 (degenerate; avoid divide-by-zero)", () => {
    expect(
      staggerTick({ elapsedMs: 100, staggerMs: 0, totalSteps: 3 }),
    ).toBe(0);
  });
});
