import { describe, it, expect } from "vitest";
import { nextIdxFromSwipe } from "@/lib/voting/nextIdxFromSwipe";

describe("nextIdxFromSwipe", () => {
  it("left swipe (negative deltaX past threshold) advances next from middle", () => {
    expect(nextIdxFromSwipe(5, 10, -100)).toBe(6);
  });

  it("right swipe (positive deltaX past threshold) goes prev from middle", () => {
    expect(nextIdxFromSwipe(5, 10, 100)).toBe(4);
  });

  it("left swipe at last contestant returns null (no overflow)", () => {
    expect(nextIdxFromSwipe(9, 10, -100)).toBeNull();
  });

  it("right swipe at first contestant returns null", () => {
    expect(nextIdxFromSwipe(0, 10, 100)).toBeNull();
  });

  it("delta below threshold (positive) returns null", () => {
    expect(nextIdxFromSwipe(5, 10, 30)).toBeNull();
  });

  it("delta below threshold (negative) returns null", () => {
    expect(nextIdxFromSwipe(5, 10, -30)).toBeNull();
  });

  it("exactly at threshold returns null (strict greater-than)", () => {
    expect(nextIdxFromSwipe(5, 10, 50)).toBeNull();
    expect(nextIdxFromSwipe(5, 10, -50)).toBeNull();
  });
});
