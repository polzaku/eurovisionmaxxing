import { describe, it, expect } from "vitest";
import { validateCategories } from "./validateCategories";

describe("validateCategories", () => {
  it("accepts a 5-item array of well-formed categories", () => {
    const result = validateCategories([
      { name: "Vocals", weight: 1 },
      { name: "Outfit", weight: 1 },
      { name: "Stage drama", weight: 2 },
      { name: "Vibes", weight: 1 },
      { name: "Music", weight: 3, hint: "the tune itself" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalized).toHaveLength(5);
      expect(result.normalized[0]).toEqual({ name: "Vocals", weight: 1 });
      expect(result.normalized[4].hint).toBe("the tune itself");
    }
  });

  it("defaults missing weight to 1", () => {
    const result = validateCategories([{ name: "Vocals" }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.normalized[0].weight).toBe(1);
  });

  it("rejects non-array input with INVALID_CATEGORIES", () => {
    const result = validateCategories("not an array");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_CATEGORIES");
      expect(result.status).toBe(400);
    }
  });

  it("rejects empty array with INVALID_CATEGORIES", () => {
    const result = validateCategories([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CATEGORIES");
  });

  it("rejects 9+ items (above MAX_CATEGORIES) with INVALID_CATEGORIES", () => {
    const tooMany = Array.from({ length: 9 }, (_, i) => ({ name: `Cat${i}` }));
    const result = validateCategories(tooMany);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CATEGORIES");
  });

  it("rejects a non-object item with INVALID_CATEGORY", () => {
    const result = validateCategories([{ name: "Vocals" }, "bare string"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CATEGORY");
  });

  it("rejects a category whose name fails the regex", () => {
    const result = validateCategories([{ name: "X" }]); // too short
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CATEGORY");
  });

  it("rejects a category with a non-integer weight", () => {
    const result = validateCategories([{ name: "Vocals", weight: 2.5 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CATEGORY");
  });

  it("rejects a category with weight outside 1–5", () => {
    const r1 = validateCategories([{ name: "Vocals", weight: 0 }]);
    const r2 = validateCategories([{ name: "Vocals", weight: 6 }]);
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
  });

  it("rejects a hint longer than 80 chars", () => {
    const result = validateCategories([
      { name: "Vocals", hint: "x".repeat(81) },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CATEGORY");
  });

  it("rejects duplicate names case-insensitively", () => {
    const result = validateCategories([
      { name: "Vocals" },
      { name: "vocals" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CATEGORIES");
  });

  it("trims whitespace around names", () => {
    const result = validateCategories([{ name: "  Vocals  " }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.normalized[0].name).toBe("Vocals");
  });
});
