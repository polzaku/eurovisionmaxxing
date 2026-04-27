import { PERSONALITY_AWARD_KEYS, type PersonalityAwardKey } from "./awardKeys";

/**
 * Plain-English explainers for each SPEC §11.2 personality award. The
 * underlying logic uses statistical terms (Spearman distance, Pearson
 * correlation, variance) most users won't recognise — these one-liners
 * surface what the award actually means in everyday words.
 *
 * One sentence per key, ≤ 200 chars. Used by `<details>` accordions on
 * each personality award card on `/results/[id]`.
 *
 * Category awards (`best_<category>`) deliberately have no explainer
 * (their meaning is self-evident from the name).
 */
export const PERSONALITY_AWARD_EXPLAINERS: Record<PersonalityAwardKey, string> = {
  harshest_critic:
    "Lowest average score given across all the contestants you voted on.",
  biggest_stan:
    "Highest average score given across all the contestants you voted on.",
  hive_mind_master:
    "Your ranking lined up most closely with how the room voted overall.",
  most_contrarian:
    "Your ranking was the furthest from the room's overall ranking.",
  neighbourhood_voters:
    "You and one other person voted most alike — your scores moved up and down together more than anyone else's.",
  the_dark_horse:
    "The contestant the room disagreed most about — some loved them, some hated them.",
  fashion_stan:
    "You gave the single highest score in the outfit / costume category.",
  the_enabler: "You gave your 12 points to the room's overall winner.",
};

const PERSONALITY_KEY_SET = new Set<string>(PERSONALITY_AWARD_KEYS);

/**
 * Resolve the explainer for any award key. Returns null for category
 * awards (`best_<slug>`) and unknown keys so callers can suppress the
 * disclosure UI.
 */
export function explainerForAward(awardKey: string): string | null {
  if (!PERSONALITY_KEY_SET.has(awardKey)) return null;
  return PERSONALITY_AWARD_EXPLAINERS[awardKey as PersonalityAwardKey];
}
