#!/usr/bin/env tsx
/**
 * SPEC §17a.6 — fixture seeding for the smoke checklist.
 *
 * Usage:
 *   npm run seed:room -- <state>
 *
 * States (see SEED_STATES in `seed-helpers.ts`):
 *   - lobby-with-3-guests           ✅ implemented
 *   - voting-half-done              🚧 stub
 *   - voting-ending-mid-countdown   🚧 stub
 *   - announcing-mid-queue-live     🚧 stub
 *   - announcing-instant-all-ready  🚧 stub
 *   - done-with-awards              ✅ implemented
 *
 * Each implemented state inserts a fresh room (PIN prefix `SEED`) plus
 * the membership / vote / result / award rows needed to render the
 * target room state, then prints `/room/{id}` and a CLI-shaped session
 * payload for the operator to paste into localStorage if they want to
 * "be" the owner. The cleanup script (`npm run seed:cleanup`) wipes
 * everything tagged with the `SEED` PIN prefix.
 *
 * Safety gates:
 *   1. Refuses to run if `NODE_ENV === "production"` unless
 *      `--allow-prod` is passed explicitly.
 *   2. Year is hardcoded to 9999 (the test-fixture year, gated to
 *      non-prod environments by `isTestFixtureYear()`).
 *   3. PIN prefix `SEED` makes seeded rooms easy to spot + delete.
 *
 * Implementation note:
 *   This is a CLI tool, not a Next.js route. It loads `.env.local`
 *   via tsx's `--env-file` flag (wired in the npm script) and uses
 *   `createServiceClient()` directly — same client server routes use.
 *   Service-role access bypasses RLS, which we need for the cross-table
 *   inserts.
 */

import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";
import type { Contestant } from "../src/types";
import {
  SEED_CATEGORIES,
  buildFullScores,
  buildSeedAvatarSeed,
  buildSeedDisplayName,
  buildSeedPin,
  isSeedState,
  type SeedState,
} from "./seed-helpers";

// ─── CLI argument parsing ───────────────────────────────────────────────────

interface CliArgs {
  state: SeedState;
  allowProd: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args = argv.slice(2); // drop node + script
  const positional = args.filter((a) => !a.startsWith("--"));
  const flags = new Set(args.filter((a) => a.startsWith("--")));

  if (positional.length !== 1 || !isSeedState(positional[0])) {
    bail(
      "Usage: npm run seed:room -- <state> [--allow-prod]\n\n" +
        "Available states:\n" +
        "  lobby-with-3-guests           ✅ implemented\n" +
        "  voting-half-done              🚧 stub\n" +
        "  voting-ending-mid-countdown   🚧 stub\n" +
        "  announcing-mid-queue-live     🚧 stub\n" +
        "  announcing-instant-all-ready  🚧 stub\n" +
        "  done-with-awards              ✅ implemented\n",
    );
  }

  return {
    state: positional[0],
    allowProd: flags.has("--allow-prod"),
  };
}

function bail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

// ─── Safety gates ───────────────────────────────────────────────────────────

function assertSafeEnvironment(allowProd: boolean): void {
  if (process.env.NODE_ENV === "production" && !allowProd) {
    bail(
      "Refusing to seed against NODE_ENV=production. Pass --allow-prod " +
        "if you really mean it (and remember the cleanup script).",
    );
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    bail(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY. The npm " +
        "script loads .env.local — make sure it has both keys.",
    );
  }
}

// ─── Supabase client (CLI flavour) ──────────────────────────────────────────

function createCliClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
  );
}

type Db = ReturnType<typeof createCliClient>;

// ─── Shared user/room creation helpers (impure — touch DB) ──────────────────

interface SeededUser {
  userId: string;
  displayName: string;
  avatarSeed: string;
  rejoinToken: string;
}

async function insertSeededUser(
  db: Db,
  idx: number,
): Promise<SeededUser> {
  const userId = randomUUID();
  const displayName = buildSeedDisplayName(idx);
  const avatarSeed = buildSeedAvatarSeed(idx);
  // Rejoin token is bcrypt-hashed at rest. We use a stable plaintext
  // per seeded user so the operator can copy it into localStorage if
  // they want to "be" that user.
  const rejoinToken = `seed-token-${userId.slice(0, 8)}`;
  const rejoinTokenHash = await bcrypt.hash(rejoinToken, 10);
  const { error } = await db.from("users").insert({
    id: userId,
    display_name: displayName,
    avatar_seed: avatarSeed,
    rejoin_token_hash: rejoinTokenHash,
  });
  if (error) bail(`Failed to insert seed user: ${error.message}`);
  return { userId, displayName, avatarSeed, rejoinToken };
}

interface SeededRoom {
  roomId: string;
  pin: string;
  ownerUserId: string;
}

async function insertSeededRoom(
  db: Db,
  ownerUserId: string,
  overrides: Partial<Database["public"]["Tables"]["rooms"]["Insert"]> = {},
): Promise<SeededRoom> {
  const roomId = randomUUID();
  const pin = buildSeedPin();
  const { error } = await db.from("rooms").insert({
    id: roomId,
    pin,
    year: 9999, // test-fixture year — gated to non-prod by isTestFixtureYear()
    event: "final",
    categories: [...SEED_CATEGORIES],
    owner_user_id: ownerUserId,
    status: "lobby",
    announcement_mode: "live",
    ...overrides,
  });
  if (error) bail(`Failed to insert seed room: ${error.message}`);
  return { roomId, pin, ownerUserId };
}

async function insertMembership(
  db: Db,
  roomId: string,
  userId: string,
  isReady = false,
): Promise<void> {
  const { error } = await db.from("room_memberships").insert({
    room_id: roomId,
    user_id: userId,
    is_ready: isReady,
    ready_at: isReady ? new Date().toISOString() : null,
  });
  if (error) bail(`Failed to insert membership: ${error.message}`);
}

async function fetchSeedContestants(): Promise<Contestant[]> {
  // Year 9999 fixture — synthetic 5-row contestant list bundled in
  // data/contestants/9999/final.json. Same shape the room would resolve
  // at runtime via the contestants cascade.
  const raw = (await import("../data/contestants/9999/final.json", {
    assert: { type: "json" },
  })) as { default?: unknown };
  // The JSON file exports an array directly; the dynamic import wraps
  // it in `default` under ES modules.
  const arr = (raw.default ?? raw) as Array<{
    country: string;
    artist: string;
    song: string;
    runningOrder: number;
  }>;
  return arr.map((c) => {
    const code = c.country.slice(0, 2).toLowerCase();
    return {
      id: `9999-${code}`,
      country: c.country,
      countryCode: code,
      flagEmoji: "🏳️",
      artist: c.artist,
      song: c.song,
      runningOrder: c.runningOrder,
      year: 9999,
      event: "final" as const,
    };
  });
}

// ─── State builders ─────────────────────────────────────────────────────────

interface SeedReport {
  roomId: string;
  pin: string;
  url: string;
  notes: string[];
  ownerSession: { userId: string; rejoinToken: string };
}

async function seedLobbyWith3Guests(db: Db): Promise<SeedReport> {
  // 1 owner + 3 guests, all in the room, status=lobby. Operator takes
  // over the owner's session via the printed userId/rejoinToken.
  const owner = await insertSeededUser(db, 0);
  const guests = await Promise.all([
    insertSeededUser(db, 1),
    insertSeededUser(db, 2),
    insertSeededUser(db, 3),
  ]);
  const room = await insertSeededRoom(db, owner.userId);
  await insertMembership(db, room.roomId, owner.userId);
  for (const g of guests) {
    await insertMembership(db, room.roomId, g.userId);
  }
  return {
    roomId: room.roomId,
    pin: room.pin,
    url: `/room/${room.roomId}`,
    notes: [
      `Owner: ${owner.displayName} (${owner.userId})`,
      `Guests: ${guests.map((g) => g.displayName).join(", ")}`,
      `Status: lobby — admin can tap "Start voting" or edit categories.`,
    ],
    ownerSession: {
      userId: owner.userId,
      rejoinToken: owner.rejoinToken,
    },
  };
}

async function seedDoneWithAwards(db: Db): Promise<SeedReport> {
  // Full end-of-show payload: 4 users, votes on every contestant,
  // results rows with ranks + points_awarded, two sample awards.
  const owner = await insertSeededUser(db, 0);
  const guests = await Promise.all([
    insertSeededUser(db, 1),
    insertSeededUser(db, 2),
    insertSeededUser(db, 3),
  ]);
  const allUsers = [owner, ...guests];
  const room = await insertSeededRoom(db, owner.userId, {
    status: "done",
    voting_ended_at: new Date().toISOString(),
  });
  for (const u of allUsers) {
    await insertMembership(db, room.roomId, u.userId);
  }

  const contestants = await fetchSeedContestants();

  // Votes: each user fully scores every contestant with a deterministic
  // pattern so leaderboards are non-trivial.
  const voteRows = allUsers.flatMap((u, ui) =>
    contestants.map((c) => ({
      room_id: room.roomId,
      user_id: u.userId,
      contestant_id: c.id,
      scores: buildFullScores(SEED_CATEGORIES, c.runningOrder + ui),
      missed: false,
      hot_take: ui === 0 && c.runningOrder === 1 ? "Stunning opening." : null,
    })),
  );
  const { error: votesErr } = await db.from("votes").insert(voteRows);
  if (votesErr) bail(`Failed to insert votes: ${votesErr.message}`);

  // Results: per-user × contestant, with rank + Eurovision points.
  // Eurovision points-from-rank: 12, 10, 8, 7, 6, 5, 4, 3, 2, 1, 0…
  const eurovisionPoints = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1];
  const resultRows = allUsers.flatMap((u, ui) => {
    // Stable per-user ranking: rotate the contestant order so each user
    // has a different #1.
    const sorted = [...contestants].sort((a, b) => {
      const wa = (a.runningOrder * (ui + 1) * 7) % 100;
      const wb = (b.runningOrder * (ui + 1) * 7) % 100;
      return wb - wa;
    });
    return sorted.map((c, rank) => ({
      room_id: room.roomId,
      user_id: u.userId,
      contestant_id: c.id,
      weighted_score: 10 - rank, // synthetic but ordered
      rank: rank + 1,
      points_awarded: eurovisionPoints[rank] ?? 0,
      announced: true,
    }));
  });
  const { error: resultsErr } = await db.from("results").insert(resultRows);
  if (resultsErr) bail(`Failed to insert results: ${resultsErr.message}`);

  // Two demo awards so the awards section renders something. Real
  // awards computation would normally populate via runScoring + computeAwards.
  const { error: awardsErr } = await db.from("room_awards").insert([
    {
      room_id: room.roomId,
      award_key: "best_vocals",
      award_name: "Best Vocals",
      winner_contestant_id: contestants[0]?.id ?? null,
      stat_value: 9.2,
      stat_label: "Average score",
    },
    {
      room_id: room.roomId,
      award_key: "biggest_stan",
      award_name: "Biggest stan",
      winner_user_id: guests[0].userId,
      stat_value: 8.7,
      stat_label: "Mean score given",
    },
  ]);
  if (awardsErr) bail(`Failed to insert awards: ${awardsErr.message}`);

  return {
    roomId: room.roomId,
    pin: room.pin,
    url: `/room/${room.roomId}`,
    notes: [
      `Status: done — /results/${room.roomId} renders the static page.`,
      `4 users, ${contestants.length} contestants, votes + results + 2 awards seeded.`,
      `Owner ${owner.displayName} sees "Create another room" CTA.`,
    ],
    ownerSession: {
      userId: owner.userId,
      rejoinToken: owner.rejoinToken,
    },
  };
}

function notImplementedYet(state: SeedState): never {
  bail(
    `State "${state}" is scoped in SPEC §17a.6 but not yet implemented in ` +
      `this script. See the SeedReport pattern in seedLobbyWith3Guests + ` +
      `seedDoneWithAwards. The implementation needs to insert: rooms + ` +
      `memberships + votes (where applicable) + results + awards in the ` +
      `target shape. Open a follow-up PR to extend.`,
  );
}

const STATE_BUILDERS: Record<SeedState, (db: Db) => Promise<SeedReport>> = {
  "lobby-with-3-guests": seedLobbyWith3Guests,
  "done-with-awards": seedDoneWithAwards,
  "voting-half-done": async () => notImplementedYet("voting-half-done"),
  "voting-ending-mid-countdown": async () =>
    notImplementedYet("voting-ending-mid-countdown"),
  "announcing-mid-queue-live": async () =>
    notImplementedYet("announcing-mid-queue-live"),
  "announcing-instant-all-ready": async () =>
    notImplementedYet("announcing-instant-all-ready"),
};

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  assertSafeEnvironment(args.allowProd);

  const db = createCliClient();
  const builder = STATE_BUILDERS[args.state];
  const report = await builder(db);

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  console.log("");
  console.log(`✅ Seeded "${args.state}"`);
  console.log("");
  console.log(`   Room URL:  ${baseUrl}${report.url}`);
  console.log(`   PIN:       ${report.pin}`);
  console.log(`   Room ID:   ${report.roomId}`);
  console.log("");
  for (const note of report.notes) console.log(`   • ${note}`);
  console.log("");
  console.log(`   Owner session (paste into browser localStorage as 'emx_session'):`);
  console.log(
    `   ${JSON.stringify({
      userId: report.ownerSession.userId,
      rejoinToken: report.ownerSession.rejoinToken,
      version: 1,
    })}`,
  );
  console.log("");
  console.log(`   Cleanup:   npm run seed:cleanup`);
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
