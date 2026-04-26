import { describe, it, expect } from "vitest";
import type { VotingCategory } from "@/types";
import {
  PERSONALITY_AWARD_KEYS,
  categoryAwardKey,
  categoryAwardName,
  findOutfitLikeCategory,
  slugifyCategoryName,
} from "@/lib/awards/awardKeys";

describe("PERSONALITY_AWARD_KEYS", () => {
  it("contains all 8 personality awards in §11.3 reveal order", () => {
    expect(PERSONALITY_AWARD_KEYS).toEqual([
      "biggest_stan",
      "harshest_critic",
      "most_contrarian",
      "hive_mind_master",
      "neighbourhood_voters",
      "the_dark_horse",
      "fashion_stan",
      "the_enabler",
    ]);
  });
});

describe("slugifyCategoryName", () => {
  it.each([
    ["Vocals", "vocals"],
    ["Stage performance", "stage_performance"],
    ["Gay panic level", "gay_panic_level"],
    ["  Outfit  ", "outfit"],
    ["A!!!B", "a_b"],
  ])("slugifies %s → %s", (input, out) => {
    expect(slugifyCategoryName(input)).toBe(out);
  });

  it("caps slug length at 24 chars", () => {
    expect(
      slugifyCategoryName("an extremely verbose category name beyond limits"),
    ).toHaveLength(24);
  });
});

describe("categoryAwardKey / categoryAwardName", () => {
  it("uses category.key when present (i18n-stable path)", () => {
    const c: VotingCategory = { name: "Vocals", weight: 1, key: "vocals" };
    expect(categoryAwardKey(c)).toBe("best_vocals");
  });

  it("falls back to slugified name when key is absent", () => {
    const c: VotingCategory = { name: "Stage chaos", weight: 1 };
    expect(categoryAwardKey(c)).toBe("best_stage_chaos");
  });

  it("composes display name as 'Best {name}'", () => {
    expect(categoryAwardName({ name: "Vocals", weight: 1 })).toBe(
      "Best Vocals",
    );
  });
});

describe("findOutfitLikeCategory", () => {
  it.each([
    [
      [{ name: "Outfit", weight: 1 }] as VotingCategory[],
      "Outfit",
    ],
    [
      [{ name: "Costume commitment", weight: 1 }] as VotingCategory[],
      "Costume commitment",
    ],
    [
      [{ name: "Fashion", weight: 1 }] as VotingCategory[],
      "Fashion",
    ],
    [
      [{ name: "Look", weight: 1 }] as VotingCategory[],
      "Look",
    ],
  ])("matches %s as outfit-like", (cats, expectedName) => {
    expect(findOutfitLikeCategory(cats)?.name).toBe(expectedName);
  });

  it("returns null when no category matches", () => {
    const cats: VotingCategory[] = [
      { name: "Vocals", weight: 1 },
      { name: "Music", weight: 1 },
    ];
    expect(findOutfitLikeCategory(cats)).toBeNull();
  });

  it("picks the first matching category when multiple", () => {
    const cats: VotingCategory[] = [
      { name: "Vocals", weight: 1 },
      { name: "Outfit", weight: 1 },
      { name: "Costume commitment", weight: 1 },
    ];
    expect(findOutfitLikeCategory(cats)?.name).toBe("Outfit");
  });
});
