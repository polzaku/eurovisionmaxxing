import { describe, it, expect } from "vitest";
import { FULL_REVEAL_POINTS, stillToGive } from "./stillToGive";

describe("FULL_REVEAL_POINTS", () => {
  it("matches the canonical Eurovision sequence", () => {
    expect(FULL_REVEAL_POINTS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 12]);
  });

  it("has 10 entries (full-style queue length)", () => {
    expect(FULL_REVEAL_POINTS).toHaveLength(10);
  });
});

describe("stillToGive", () => {
  it("returns the full sequence as remaining when idx is 0", () => {
    expect(stillToGive(0)).toEqual({
      given: [],
      remaining: [1, 2, 3, 4, 5, 6, 7, 8, 10, 12],
    });
  });

  it("splits after one reveal", () => {
    expect(stillToGive(1)).toEqual({
      given: [1],
      remaining: [2, 3, 4, 5, 6, 7, 8, 10, 12],
    });
  });

  it("splits mid-sequence", () => {
    expect(stillToGive(5)).toEqual({
      given: [1, 2, 3, 4, 5],
      remaining: [6, 7, 8, 10, 12],
    });
  });

  it("splits with only the 12 remaining", () => {
    expect(stillToGive(9)).toEqual({
      given: [1, 2, 3, 4, 5, 6, 7, 8, 10],
      remaining: [12],
    });
  });

  it("returns empty remaining when all 10 are given", () => {
    expect(stillToGive(10)).toEqual({
      given: [1, 2, 3, 4, 5, 6, 7, 8, 10, 12],
      remaining: [],
    });
  });

  it("clamps negative idx to 0", () => {
    expect(stillToGive(-1)).toEqual({
      given: [],
      remaining: [1, 2, 3, 4, 5, 6, 7, 8, 10, 12],
    });
  });

  it("clamps idx > length to length", () => {
    expect(stillToGive(99)).toEqual({
      given: [1, 2, 3, 4, 5, 6, 7, 8, 10, 12],
      remaining: [],
    });
  });
});
