import { describe, it, expect } from "vitest";
import { scoredCount } from "@/components/voting/scoredCount";

const CATS = ["Vocals", "Staging", "Outfit"] as const;

describe("scoredCount", () => {
  it("returns 0 for undefined scores", () => {
    expect(scoredCount(undefined, CATS)).toBe(0);
  });

  it("returns 0 for an empty scores object", () => {
    expect(scoredCount({}, CATS)).toBe(0);
  });

  it("counts each category with a numeric value", () => {
    expect(scoredCount({ Vocals: 7, Staging: 4 }, CATS)).toBe(2);
  });

  it("returns the total when every category is filled", () => {
    expect(scoredCount({ Vocals: 7, Staging: 4, Outfit: 9 }, CATS)).toBe(
      CATS.length
    );
  });

  it("does not count null values (explicit clear)", () => {
    expect(scoredCount({ Vocals: null, Staging: 4 }, CATS)).toBe(1);
  });

  it("ignores keys that are not in the category list", () => {
    expect(scoredCount({ Vocals: 7, BogusExtra: 3 }, CATS)).toBe(1);
  });

  it("handles 0-length category list without error", () => {
    expect(scoredCount({ Vocals: 5 }, [])).toBe(0);
  });
});
