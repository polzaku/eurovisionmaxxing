/**
 * Pure helpers for `scripts/seed-room.ts`. Everything in this file is
 * deterministic / data-only — testable without hitting Supabase.
 *
 * The seeder writes rows tagged with the `SEED` PIN prefix so the
 * companion cleanup script can wipe them with `DELETE WHERE pin LIKE 'SEED%'`.
 */

import { PIN_CHARSET } from "../src/types";

export const SEED_PIN_PREFIX = "SEED";
export const SEED_USER_FIRST_NAMES = [
  "Alice",
  "Bob",
  "Carol",
  "Dave",
  "Erin",
  "Felix",
] as const;

/** Default 3-category template for seeded rooms (weight 1 across the board). */
export const SEED_CATEGORIES: ReadonlyArray<{
  name: string;
  weight: number;
  hint: string;
}> = [
  { name: "Vocals", weight: 1, hint: "Technical delivery and control" },
  { name: "Staging", weight: 1, hint: "Movement, energy, visuals" },
  { name: "Vibes", weight: 1, hint: "How did it feel?" },
];

/**
 * SEED + 2 random chars from PIN_CHARSET. ~1024 combinations after the
 * marker prefix; collision is unlikely under normal seeding loads. The
 * prefix is the load-bearing part — it's how the cleanup script
 * identifies seeded rooms.
 */
export function buildSeedPin(rng: () => number = Math.random): string {
  const chars = PIN_CHARSET;
  const tail =
    chars[Math.floor(rng() * chars.length)] +
    chars[Math.floor(rng() * chars.length)];
  return `${SEED_PIN_PREFIX}${tail}`;
}

export function isSeedPin(pin: string): boolean {
  return pin.startsWith(SEED_PIN_PREFIX);
}

export function buildSeedDisplayName(idx: number): string {
  return `Seed ${SEED_USER_FIRST_NAMES[idx % SEED_USER_FIRST_NAMES.length]}`;
}

export function buildSeedAvatarSeed(idx: number): string {
  return `seed-${SEED_USER_FIRST_NAMES[idx % SEED_USER_FIRST_NAMES.length].toLowerCase()}`;
}

/**
 * Deterministic mid-range scores for a single contestant — every category
 * filled with a value in 1..10. The `seed` parameter (typically the
 * contestant's running order) keeps scores stable per row but varied
 * across the room so the leaderboard isn't a flat tie.
 */
export function buildFullScores(
  categories: ReadonlyArray<{ name: string }>,
  seed: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < categories.length; i++) {
    const v = ((seed * (i + 1) * 7) % 10) + 1; // 1..10
    out[categories[i].name] = v;
  }
  return out;
}

/**
 * Half-filled scores: only the first half of categories are filled.
 * Used by `voting-half-done` — leaves the user mid-progress on each
 * contestant.
 */
export function buildHalfScores(
  categories: ReadonlyArray<{ name: string }>,
  seed: number,
): Record<string, number> {
  const full = buildFullScores(categories, seed);
  const half: Record<string, number> = {};
  const cutoff = Math.ceil(categories.length / 2);
  for (let i = 0; i < cutoff; i++) {
    half[categories[i].name] = full[categories[i].name];
  }
  return half;
}

/**
 * The set of state names the seeder accepts. Adding a new state means
 * also adding the matching builder function in `seed-room.ts` and a
 * mention in `scripts/README.md`.
 */
export const SEED_STATES = [
  "lobby-with-3-guests",
  "voting-half-done",
  "voting-ending-mid-countdown",
  "announcing-mid-queue-live",
  "announcing-instant-all-ready",
  "done-with-awards",
] as const;

export type SeedState = (typeof SEED_STATES)[number];

export function isSeedState(s: string): s is SeedState {
  return (SEED_STATES as readonly string[]).includes(s);
}
