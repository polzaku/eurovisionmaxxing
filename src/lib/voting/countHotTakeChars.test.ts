import { describe, it, expect } from "vitest";
import { countHotTakeChars } from "@/lib/voting/countHotTakeChars";

describe("countHotTakeChars", () => {
  it("returns 0 for empty string", () => {
    expect(countHotTakeChars("")).toBe(0);
  });

  it("counts ASCII chars at 1 each", () => {
    expect(countHotTakeChars("hello")).toBe(5);
  });
});
