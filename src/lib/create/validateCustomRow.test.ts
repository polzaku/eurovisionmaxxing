import { describe, it, expect } from "vitest";
import { validateCustomRow, type CustomRowError } from "./validateCustomRow";

describe("validateCustomRow", () => {
  it("returns null for a valid 2-char name with no duplicates", () => {
    expect(validateCustomRow("Vo", ["Vo"], 0)).toBeNull();
  });

  it("returns null for a 24-char name", () => {
    const name = "A".repeat(24);
    expect(validateCustomRow(name, [name], 0)).toBeNull();
  });

  it("returns 'empty' for an empty string", () => {
    const err: CustomRowError = "empty";
    expect(validateCustomRow("", [""], 0)).toBe(err);
  });

  it("returns 'empty' for whitespace-only input", () => {
    expect(validateCustomRow("   ", ["   "], 0)).toBe("empty");
  });

  it("returns 'tooShort' for a single character after trim", () => {
    expect(validateCustomRow("A", ["A"], 0)).toBe("tooShort");
  });

  it("returns 'tooShort' for a single character with surrounding whitespace", () => {
    expect(validateCustomRow("  A  ", ["  A  "], 0)).toBe("tooShort");
  });

  it("returns 'duplicate' when another row has the same trimmed lowercase name", () => {
    expect(validateCustomRow("Vocals", ["Vocals", "Music"], 1)).toBe(
      "duplicate",
    );
  });

  it("returns 'duplicate' case-insensitively", () => {
    expect(validateCustomRow("VOCALS", ["vocals", "VOCALS"], 1)).toBe(
      "duplicate",
    );
  });

  it("returns 'duplicate' regardless of trimming on either side", () => {
    expect(validateCustomRow("  Vocals  ", ["Vocals", "  Vocals  "], 1)).toBe(
      "duplicate",
    );
  });

  it("does NOT flag the row's own value as a duplicate of itself", () => {
    expect(validateCustomRow("Vocals", ["Music", "Vocals", "Drama"], 1))
      .toBeNull();
  });

  it("prioritises 'empty' over duplicate (empty rows don't claim duplication)", () => {
    expect(validateCustomRow("", ["", ""], 1)).toBe("empty");
  });

  it("prioritises 'tooShort' over duplicate", () => {
    expect(validateCustomRow("A", ["A", "A"], 1)).toBe("tooShort");
  });
});
