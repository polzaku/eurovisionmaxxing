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

// ─── Pure builder: buildAnnouncingCascadeAbsent ──────────────────────────────

export interface SeedUserRow {
  id: string;
  display_name: string;
  avatar_seed: string;
}

export interface SeedMembershipRow {
  user_id: string;
  is_ready: boolean;
  last_seen_at: string | null;
}

export interface SeedRoomRow {
  status: string;
  announcement_mode: string;
  announcement_order: string[] | null;
  announcing_user_id: string | null;
  current_announce_idx: number | null;
  announce_skipped_user_ids: string[];
}

export interface AnnouncingCascadeAbsentFixture {
  users: SeedUserRow[];
  room: SeedRoomRow;
  memberships: SeedMembershipRow[];
}

export interface BuildAnnouncingCascadeAbsentOpts {
  now?: Date;
  pin?: string;
}

/**
 * SPEC §10.2.1 — seed an announcing room that drives the cascade-skip
 * path. Order [A, B, C, D]: A is the active announcer (fresh), B and C
 * are absent (last_seen_at ~60s ago), D is fresh. After A finishes
 * their reveal queue, the cascade skips B and C, lands on D.
 *
 * Pure function — no DB side-effects. The companion impure seeder in
 * `seed-room.ts` calls this and persists the rows.
 */
export function buildAnnouncingCascadeAbsent(
  opts: BuildAnnouncingCascadeAbsentOpts = {},
): AnnouncingCascadeAbsentFixture {
  const now = opts.now ?? new Date();
  const fresh = new Date(now.getTime() - 5_000).toISOString();
  const stale = new Date(now.getTime() - 60_000).toISOString();

  // Build 4 deterministic seed users (indices 0–3).
  const users: SeedUserRow[] = [0, 1, 2, 3].map((i) => ({
    id: `cascade-absent-user-${i}`,
    display_name: buildSeedDisplayName(i),
    avatar_seed: buildSeedAvatarSeed(i),
  }));

  const [a, b, c, d] = users;
  const order = [a.id, b.id, c.id, d.id];

  const room: SeedRoomRow = {
    status: "announcing",
    announcement_mode: "live",
    announcement_order: order,
    announcing_user_id: a.id,
    current_announce_idx: 0,
    announce_skipped_user_ids: [],
  };

  const memberships: SeedMembershipRow[] = [
    { user_id: a.id, is_ready: false, last_seen_at: fresh },
    { user_id: b.id, is_ready: false, last_seen_at: stale },
    { user_id: c.id, is_ready: false, last_seen_at: stale },
    { user_id: d.id, is_ready: false, last_seen_at: fresh },
  ];

  return { users, room, memberships };
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
  "announcing-cascade-absent",
] as const;

export type SeedState = (typeof SEED_STATES)[number];

export function isSeedState(s: string): s is SeedState {
  return (SEED_STATES as readonly string[]).includes(s);
}
