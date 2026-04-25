import { describe, it, expect } from "vitest";
import { countHotTakeChars } from "@/lib/voting/countHotTakeChars";

describe("countHotTakeChars", () => {
  it("returns 0 for empty string", () => {
    expect(countHotTakeChars("")).toBe(0);
  });

  it("counts ASCII chars at 1 each", () => {
    expect(countHotTakeChars("hello")).toBe(5);
  });

  it("counts a single emoji as 2", () => {
    expect(countHotTakeChars("👋")).toBe(2);
  });

  it("counts a ZWJ family emoji as 2 (single grapheme)", () => {
    expect(countHotTakeChars("👨‍👩‍👧‍👦")).toBe(2);
  });

  it("counts a regional-indicator flag as 2 (single grapheme)", () => {
    expect(countHotTakeChars("🇺🇦")).toBe(2);
  });

  it("counts mixed ASCII + emoji correctly", () => {
    // h(1) + i(1) + space(1) + emoji(2) = 5
    expect(countHotTakeChars("hi 👋")).toBe(5);
  });

  it("counts whitespace as 1 each", () => {
    expect(countHotTakeChars("   ")).toBe(3);
  });

  it("counts skin-tone modified emoji as 2 (single grapheme)", () => {
    expect(countHotTakeChars("👋🏽")).toBe(2);
  });
});
