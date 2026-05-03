import { describe, it, expect } from "vitest";
import { isTheme, nextTheme } from "./theme";

describe("isTheme", () => {
  it("accepts the three valid values", () => {
    expect(isTheme("system")).toBe(true);
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
  });

  it("rejects unrelated strings, null, undefined, numbers, objects", () => {
    expect(isTheme("auto")).toBe(false);
    expect(isTheme("")).toBe(false);
    expect(isTheme(null)).toBe(false);
    expect(isTheme(undefined)).toBe(false);
    expect(isTheme(0)).toBe(false);
    expect(isTheme({})).toBe(false);
  });
});

describe("nextTheme", () => {
  it("cycles system → light → dark → system", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });
});
