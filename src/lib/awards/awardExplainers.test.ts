import { describe, it, expect } from "vitest";
import {
  PERSONALITY_AWARD_EXPLAINERS,
  explainerForAward,
} from "./awardExplainers";
import { PERSONALITY_AWARD_KEYS } from "./awardKeys";

describe("PERSONALITY_AWARD_EXPLAINERS", () => {
  it("covers every personality award key (no orphans, no gaps)", () => {
    const explainerKeys = Object.keys(PERSONALITY_AWARD_EXPLAINERS).sort();
    const expectedKeys = [...PERSONALITY_AWARD_KEYS].sort();
    expect(explainerKeys).toEqual(expectedKeys);
  });

  it.each(PERSONALITY_AWARD_KEYS)(
    "explainer for '%s' is non-empty and trimmed",
    (key) => {
      const text = PERSONALITY_AWARD_EXPLAINERS[key];
      expect(text).toBeTruthy();
      expect(text).toBe(text.trim());
    },
  );

  it.each(PERSONALITY_AWARD_KEYS)(
    "explainer for '%s' fits the UX budget (≤ 200 chars)",
    (key) => {
      expect(PERSONALITY_AWARD_EXPLAINERS[key].length).toBeLessThanOrEqual(200);
    },
  );

  // SPEC #12 — explainers render to every viewer, not just the winner.
  // First-person ("you / your") reads as if the viewer themselves won
  // the award and was confusing during live tests. `the_dark_horse` is
  // about a contestant (already neutral) so it's excluded.
  const THIRD_PERSON_KEYS = PERSONALITY_AWARD_KEYS.filter(
    (k) => k !== "the_dark_horse",
  );
  it.each(THIRD_PERSON_KEYS)(
    "explainer for '%s' uses 3rd-person copy (no 'you' / 'your')",
    (key) => {
      expect(
        PERSONALITY_AWARD_EXPLAINERS[key],
        `${key} still uses 1st person`,
      ).not.toMatch(/\byou\b|\byour\b/i);
    },
  );
});

describe("explainerForAward", () => {
  it("returns the explainer for a known personality award key", () => {
    expect(explainerForAward("hive_mind_master")).toBe(
      PERSONALITY_AWARD_EXPLAINERS.hive_mind_master,
    );
  });

  it("returns null for category awards (best_*)", () => {
    expect(explainerForAward("best_vocals")).toBeNull();
    expect(explainerForAward("best_outfit")).toBeNull();
  });

  it("returns null for unknown keys (graceful fallback)", () => {
    expect(explainerForAward("definitely_not_an_award")).toBeNull();
  });

  it("returns the your_neighbour explainer", () => {
    expect(explainerForAward("your_neighbour")).toMatch(
      /your votes lined up most closely/,
    );
  });
});
