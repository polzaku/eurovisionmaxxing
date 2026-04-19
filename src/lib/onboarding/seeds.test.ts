import { describe, it, expect } from "vitest";
import { generateCarouselSeeds, type Rng } from "@/lib/onboarding/seeds";

function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("generateCarouselSeeds", () => {
  it("puts currentSeed in slot 0", () => {
    const seeds = generateCarouselSeeds("Alice", seededRng(1));
    expect(seeds[0]).toBe("Alice");
  });

  it("returns exactly `count` seeds (default 6)", () => {
    expect(generateCarouselSeeds("Alice", seededRng(1))).toHaveLength(6);
    expect(generateCarouselSeeds("Alice", seededRng(1), 4)).toHaveLength(4);
    expect(generateCarouselSeeds("Alice", seededRng(1), 5)).toHaveLength(5);
  });

  it("contains no duplicates", () => {
    const seeds = generateCarouselSeeds("Alice", seededRng(42));
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it("is deterministic for a given RNG state", () => {
    const a = generateCarouselSeeds("Alice", seededRng(7));
    const b = generateCarouselSeeds("Alice", seededRng(7));
    expect(a).toEqual(b);
  });

  it("produces distinct sequences for distinct RNG states", () => {
    const a = generateCarouselSeeds("Alice", seededRng(1));
    const b = generateCarouselSeeds("Alice", seededRng(2));
    expect(a[0]).toBe(b[0]);
    expect(a.slice(1)).not.toEqual(b.slice(1));
  });

  it("random seeds are non-empty and within a reasonable length", () => {
    const seeds = generateCarouselSeeds("Alice", seededRng(3));
    for (const s of seeds.slice(1)) {
      expect(s.length).toBeGreaterThanOrEqual(4);
      expect(s.length).toBeLessThanOrEqual(16);
    }
  });

  it("throws when count is outside [4, 6]", () => {
    expect(() => generateCarouselSeeds("Alice", seededRng(1), 3)).toThrow(RangeError);
    expect(() => generateCarouselSeeds("Alice", seededRng(1), 7)).toThrow(RangeError);
  });

  it("still returns count seeds even if a random collides with currentSeed", () => {
    const rng: Rng = () => 0;
    const seeds = generateCarouselSeeds("abc123", rng, 6);
    expect(seeds).toHaveLength(6);
    expect(new Set(seeds).size).toBe(6);
    expect(seeds[0]).toBe("abc123");
  });
});
