import { describe, it, expect } from "vitest";
import { rankToPoints } from "@/lib/scoring";

describe("scoring harness smoke", () => {
  it("awards 12 points for rank 1", () => {
    expect(rankToPoints(1)).toBe(12);
  });
});
