import { describe, it, expect } from "vitest";
import { deepMerge } from "@/i18n/request";

describe("deepMerge", () => {
  it("merges overlay onto base recursively", () => {
    const base = { common: { app: { name: "EN", tagline: "EN tag" }, cta: { join: "Join" } } };
    const overlay = { common: { app: { name: "ES" } } };
    expect(deepMerge(base, overlay)).toEqual({
      common: {
        app: { name: "ES", tagline: "EN tag" },
        cta: { join: "Join" },
      },
    });
  });

  it("overlay wins for primitive values at any depth", () => {
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
    expect(deepMerge({ a: { b: 1 } }, { a: { b: 2 } })).toEqual({ a: { b: 2 } });
  });

  it("treats arrays as leaves (overlay replaces)", () => {
    expect(deepMerge({ list: [1, 2] }, { list: [3] })).toEqual({ list: [3] });
  });

  it("returns base unchanged when overlay is empty", () => {
    const base = { a: { b: 1 } };
    expect(deepMerge(base, {})).toEqual({ a: { b: 1 } });
  });

  it("does not mutate base", () => {
    const base = { a: { b: 1 } };
    const overlay = { a: { c: 2 } };
    deepMerge(base, overlay);
    expect(base).toEqual({ a: { b: 1 } });
  });
});
