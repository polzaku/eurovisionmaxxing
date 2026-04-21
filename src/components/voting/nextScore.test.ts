import { describe, it, expect } from "vitest";
import { nextScore } from "@/components/voting/nextScore";

describe("nextScore", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
    "unset → tap %i sets the score to %i",
    (n) => {
      expect(nextScore(null, n)).toBe(n);
    }
  );

  it("tapping the currently-selected button clears the score", () => {
    expect(nextScore(7, 7)).toBeNull();
  });

  it("tapping a different button overwrites the previous score", () => {
    expect(nextScore(3, 8)).toBe(8);
  });

  it("clear then tap behaves like unset", () => {
    const afterClear = nextScore(5, 5);
    expect(afterClear).toBeNull();
    expect(nextScore(afterClear, 9)).toBe(9);
  });
});
