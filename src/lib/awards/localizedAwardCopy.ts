import { PERSONALITY_AWARD_KEYS } from "./awardKeys";

const PERSONALITY_KEY_SET = new Set<string>(PERSONALITY_AWARD_KEYS);

type Translator = (
  key: string,
  values?: Record<string, string | number | undefined>,
) => string;

/**
 * SPEC §21.2 — render localized award names in the cinematic reveal.
 *
 * Personality awards (`biggest_stan`, `harshest_critic`, …) read from
 * `awards.personality.<key>.name`. Category awards (`best_<slug>`) read
 * the localised "Best {categoryName}" template — the category name itself
 * is intentionally NOT translated (admin-typed custom categories are out
 * of scope per §21.2; predefined templates use the user-typed value as a
 * pass-through). `your_neighbour` reads `awards.your_neighbour.name`.
 *
 * Fall back to the server-supplied `fallback` for unknown keys so older
 * `room_awards` rows ship through untouched.
 */
export function localizedAwardName(
  t: Translator,
  awardKey: string,
  fallback: string,
): string {
  if (PERSONALITY_KEY_SET.has(awardKey)) {
    return t(`awards.personality.${awardKey}.name`);
  }
  if (awardKey === "your_neighbour") {
    return t("awards.your_neighbour.name");
  }
  if (awardKey.startsWith("best_")) {
    // `fallback` is e.g. "Best Vocals" — strip the English prefix to
    // recover the category name, then re-wrap via the localized template.
    // Admin-typed custom names with their own "Best " prefix would
    // produce odd output ("Best Best X") in edge cases; we accept that as
    // a known limit of the MVP scope.
    const categoryName = fallback.replace(/^Best\s+/, "");
    return t("awards.bestCategory", { categoryName });
  }
  return fallback;
}

/**
 * Personality awards carry a numeric stat (avg, Pearson, variance) plus
 * a locale-keyed suffix template (`awards.personality.<key>.stat` with
 * `{value}`). Category awards keep the server-supplied label since the
 * unit suffix is locale-independent ("9.4 avg" reads correctly in every
 * supported locale for MVP).
 */
export function localizedAwardStat(
  t: Translator,
  awardKey: string,
  statValue: number | null | undefined,
  fallback: string | null | undefined,
): string | null {
  if (PERSONALITY_KEY_SET.has(awardKey) && statValue != null) {
    return t(`awards.personality.${awardKey}.stat`, {
      value: roundToOneDecimal(statValue),
    });
  }
  if (awardKey === "your_neighbour" && statValue != null) {
    return t("awards.personality.your_neighbour.stat", {
      value: roundToOneDecimal(statValue),
    });
  }
  return fallback ?? null;
}

// SPEC #12 — personality cards previously rendered the raw float ("avg
// 8.9123456 / 10"). Rounding centrally here keeps every locale's stat
// template clean without touching ICU number-formatting per-locale.
function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Plain-English explainers live in `awards.explainers.<key>` for every
 * personality key + `your_neighbour`. Category awards have none (their
 * meaning is self-evident from the name). Returns null for unknown keys.
 */
export function localizedAwardExplainer(
  t: Translator,
  awardKey: string,
): string | null {
  if (PERSONALITY_KEY_SET.has(awardKey)) {
    return t(`awards.explainers.${awardKey}`);
  }
  if (awardKey === "your_neighbour") {
    return t("awards.explainers.your_neighbour");
  }
  return null;
}
