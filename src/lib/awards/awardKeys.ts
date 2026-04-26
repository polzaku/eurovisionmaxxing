import type { VotingCategory } from "@/types";

/**
 * Personality awards from SPEC §11.2. Order matters — drives the
 * §11.3 reveal sequence (Biggest stan → Harshest critic → Most
 * contrarian → Hive mind master → Neighbourhood voters → Dark horse →
 * Fashion stan → The enabler).
 */
export const PERSONALITY_AWARD_KEYS = [
  "biggest_stan",
  "harshest_critic",
  "most_contrarian",
  "hive_mind_master",
  "neighbourhood_voters",
  "the_dark_horse",
  "fashion_stan",
  "the_enabler",
] as const;

export type PersonalityAwardKey = (typeof PERSONALITY_AWARD_KEYS)[number];

/**
 * Display name fallback when no locale value resolves. The `<AwardsSection>`
 * still calls `t('awards.<key>.name')` first; this is the en-default if the
 * locale lookup yields the literal key.
 */
export const PERSONALITY_AWARD_NAMES: Record<PersonalityAwardKey, string> = {
  biggest_stan: "Biggest stan",
  harshest_critic: "Harshest critic",
  most_contrarian: "Most contrarian",
  hive_mind_master: "Hive mind master",
  neighbourhood_voters: "Neighbourhood voters",
  the_dark_horse: "The dark horse",
  fashion_stan: "Fashion stan",
  the_enabler: "The enabler",
};

/**
 * Slugify a category name for use inside an `award_key` like
 * `best_<slug>`. Stable across i18n renames when `category.key` is set
 * (the spec's recommended path); falls back to a name-derived slug.
 */
export function slugifyCategoryName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

export function categoryAwardKey(category: VotingCategory): string {
  const stable = category.key ?? slugifyCategoryName(category.name);
  return `best_${stable}`;
}

export function categoryAwardName(category: VotingCategory): string {
  return `Best ${category.name}`;
}

/** SPEC §11.2 Fashion stan: substring matchers for "outfit-like" categories. */
export const OUTFIT_LIKE_TOKENS = [
  "outfit",
  "costume",
  "fashion",
  "look",
] as const;

export function findOutfitLikeCategory(
  categories: VotingCategory[],
): VotingCategory | null {
  for (const c of categories) {
    const lower = c.name.toLowerCase();
    if (OUTFIT_LIKE_TOKENS.some((t) => lower.includes(t))) return c;
  }
  return null;
}
