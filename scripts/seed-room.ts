#!/usr/bin/env tsx
/**
 * SPEC §17a.6 — fixture seeding for the smoke checklist.
 *
 * Usage:
 *   npm run seed:room -- <state>
 *
 * States (see SEED_STATES in `seed-helpers.ts`) — all 6 implemented:
 *   - lobby-with-3-guests
 *   - voting-half-done
 *   - voting-ending-mid-countdown
 *   - announcing-mid-queue-live
 *   - announcing-instant-all-ready
 *   - done-with-awards
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
  buildHalfScores,
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
        "  lobby-with-3-guests\n" +
        "  voting-half-done\n" +
        "  voting-ending-mid-countdown\n" +
        "  announcing-mid-queue-live\n" +
        "  announcing-instant-all-ready\n" +
        "  done-with-awards\n",
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
  const { voteRows, resultRows } = buildFullVotesAndResults(
    room.roomId,
    allUsers,
    contestants,
  );
  // For "done", every reveal has happened — mark all results announced.
  const announcedResults = resultRows.map((r) => ({ ...r, announced: true }));

  const { error: votesErr } = await db.from("votes").insert(voteRows);
  if (votesErr) bail(`Failed to insert votes: ${votesErr.message}`);
  const { error: resultsErr } = await db
    .from("results")
    .insert(announcedResults);
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

// ─── Shared row-build helpers used by multiple state builders ──────────────

interface FullVotesResult {
  /** Votes inserted (one per user × contestant) — full scores, no missed. */
  voteRows: Database["public"]["Tables"]["votes"]["Insert"][];
  /** Per-user × contestant × rank + Eurovision points. Sort order rotates per user. */
  resultRows: Database["public"]["Tables"]["results"]["Insert"][];
}

const EUROVISION_POINTS_FROM_RANK = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1];

/**
 * Build full vote + result row sets for a given user list × contestant list.
 * Used by every "post-voting" state (announcing live, announcing instant,
 * done). Each user gets a deterministic ranking that varies per-user so
 * the leaderboard isn't a flat tie. `announced` defaults to false; callers
 * override per-row for announcing-mid-queue.
 */
function buildFullVotesAndResults(
  roomId: string,
  users: SeededUser[],
  contestants: Contestant[],
): FullVotesResult {
  const voteRows = users.flatMap((u, ui) =>
    contestants.map((c) => ({
      room_id: roomId,
      user_id: u.userId,
      contestant_id: c.id,
      scores: buildFullScores(SEED_CATEGORIES, c.runningOrder + ui),
      missed: false,
      hot_take: ui === 0 && c.runningOrder === 1 ? "Stunning opening." : null,
    })),
  );
  const resultRows = users.flatMap((u, ui) => {
    const sorted = [...contestants].sort((a, b) => {
      const wa = (a.runningOrder * (ui + 1) * 7) % 100;
      const wb = (b.runningOrder * (ui + 1) * 7) % 100;
      return wb - wa;
    });
    return sorted.map((c, rank) => ({
      room_id: roomId,
      user_id: u.userId,
      contestant_id: c.id,
      weighted_score: 10 - rank,
      rank: rank + 1,
      points_awarded: EUROVISION_POINTS_FROM_RANK[rank] ?? 0,
      announced: false,
    }));
  });
  return { voteRows, resultRows };
}

// ─── Voting states ──────────────────────────────────────────────────────────

async function seedVotingHalfDone(db: Db): Promise<SeedReport> {
  // status=voting. Each user has half-filled scores on every contestant
  // (only the first ceil(N/2) categories scored). The voting screen
  // renders normally; the operator can score any contestant's remaining
  // categories or navigate around. EndOfVotingCard suppression: condition
  // (a) won't fire because the last contestant isn't fully scored.
  const owner = await insertSeededUser(db, 0);
  const guests = await Promise.all([
    insertSeededUser(db, 1),
    insertSeededUser(db, 2),
    insertSeededUser(db, 3),
  ]);
  const allUsers = [owner, ...guests];
  const room = await insertSeededRoom(db, owner.userId, { status: "voting" });
  for (const u of allUsers) {
    await insertMembership(db, room.roomId, u.userId);
  }
  const contestants = await fetchSeedContestants();

  const voteRows = allUsers.flatMap((u, ui) =>
    contestants.map((c) => ({
      room_id: room.roomId,
      user_id: u.userId,
      contestant_id: c.id,
      scores: buildHalfScores(SEED_CATEGORIES, c.runningOrder + ui),
      missed: false,
      hot_take: null,
    })),
  );
  const { error: votesErr } = await db.from("votes").insert(voteRows);
  if (votesErr) bail(`Failed to insert votes: ${votesErr.message}`);

  return {
    roomId: room.roomId,
    pin: room.pin,
    url: `/room/${room.roomId}`,
    notes: [
      `Status: voting — operator lands on the voting card with half-scored contestants.`,
      `4 users, ${contestants.length} contestants, only first ${Math.ceil(SEED_CATEGORIES.length / 2)} of ${SEED_CATEGORIES.length} categories filled per row.`,
      `EndOfVotingCard won't render until the operator fully scores the last contestant or condition (b) fires.`,
    ],
    ownerSession: {
      userId: owner.userId,
      rejoinToken: owner.rejoinToken,
    },
  };
}

async function seedVotingEndingMidCountdown(db: Db): Promise<SeedReport> {
  // status=voting_ending with voting_ends_at set 30s in the future. Gives
  // the operator plenty of headroom to see the countdown UI, tap Undo,
  // or watch the auto-finalise fire.
  const COUNTDOWN_HEADROOM_S = 30;
  const owner = await insertSeededUser(db, 0);
  const guests = await Promise.all([
    insertSeededUser(db, 1),
    insertSeededUser(db, 2),
    insertSeededUser(db, 3),
  ]);
  const allUsers = [owner, ...guests];
  const endsAt = new Date(Date.now() + COUNTDOWN_HEADROOM_S * 1000);
  const room = await insertSeededRoom(db, owner.userId, {
    status: "voting_ending",
    voting_ends_at: endsAt.toISOString(),
  });
  for (const u of allUsers) {
    await insertMembership(db, room.roomId, u.userId);
  }
  const contestants = await fetchSeedContestants();

  // Half-scored votes — same as voting-half-done so the user has
  // something to look at on the screen behind the countdown toast.
  const voteRows = allUsers.flatMap((u, ui) =>
    contestants.map((c) => ({
      room_id: room.roomId,
      user_id: u.userId,
      contestant_id: c.id,
      scores: buildHalfScores(SEED_CATEGORIES, c.runningOrder + ui),
      missed: false,
      hot_take: null,
    })),
  );
  const { error: votesErr } = await db.from("votes").insert(voteRows);
  if (votesErr) bail(`Failed to insert votes: ${votesErr.message}`);

  return {
    roomId: room.roomId,
    pin: room.pin,
    url: `/room/${room.roomId}`,
    notes: [
      `Status: voting_ending — 30s countdown until auto-scoring fires (voting_ends_at = ${endsAt.toISOString()}).`,
      `Admin sees EndVotingCountdownToast with Undo button.`,
      `Guest sees EndingPill. Either can let the timer elapse to roll into runScoring.`,
    ],
    ownerSession: {
      userId: owner.userId,
      rejoinToken: owner.rejoinToken,
    },
  };
}

// ─── Announcing states ──────────────────────────────────────────────────────

async function seedAnnouncingMidQueueLive(db: Db): Promise<SeedReport> {
  // status=announcing, mode=live. 4 announcers in the order. The first
  // user has fully announced; the second user is mid-queue with 3 of 5
  // reveals done; the remaining 2 users haven't started.
  const owner = await insertSeededUser(db, 0);
  const guests = await Promise.all([
    insertSeededUser(db, 1),
    insertSeededUser(db, 2),
    insertSeededUser(db, 3),
  ]);
  const allUsers = [owner, ...guests];
  const order = allUsers.map((u) => u.userId);
  const announcingUserId = order[1]; // second user — mid-queue
  const REVEALS_DONE_FOR_CURRENT = 3;

  const room = await insertSeededRoom(db, owner.userId, {
    status: "announcing",
    announcement_mode: "live",
    announcement_order: order,
    announcing_user_id: announcingUserId,
    current_announce_idx: REVEALS_DONE_FOR_CURRENT,
    voting_ended_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  });
  for (const u of allUsers) {
    await insertMembership(db, room.roomId, u.userId);
  }

  const contestants = await fetchSeedContestants();
  const { voteRows, resultRows } = buildFullVotesAndResults(
    room.roomId,
    allUsers,
    contestants,
  );

  // Mark the right rows as announced=true:
  //   - All of the FIRST announcer's results (they're "done")
  //   - The lowest-points-awarded REVEALS_DONE_FOR_CURRENT rows of the
  //     current announcer (Eurovision live reveal goes 1pt → 12pt, so
  //     "done" means the smallest points_awarded values have been
  //     called out already).
  const firstAnnouncerId = order[0];
  const adjustedResults = resultRows.map((r) => {
    if (r.user_id === firstAnnouncerId) {
      return { ...r, announced: true };
    }
    return r;
  });
  // Sort the current announcer's rows by points_awarded ascending,
  // mark the first N as announced.
  const currentRows = adjustedResults.filter(
    (r) => r.user_id === announcingUserId,
  );
  currentRows
    .sort((a, b) => (a.points_awarded ?? 0) - (b.points_awarded ?? 0))
    .slice(0, REVEALS_DONE_FOR_CURRENT)
    .forEach((r) => {
      r.announced = true;
    });

  const { error: votesErr } = await db.from("votes").insert(voteRows);
  if (votesErr) bail(`Failed to insert votes: ${votesErr.message}`);
  const { error: resultsErr } = await db
    .from("results")
    .insert(adjustedResults);
  if (resultsErr) bail(`Failed to insert results: ${resultsErr.message}`);

  const announcerName = allUsers.find((u) => u.userId === announcingUserId)
    ?.displayName ?? "?";
  return {
    roomId: room.roomId,
    pin: room.pin,
    url: `/room/${room.roomId}`,
    notes: [
      `Status: announcing (live). Order: ${allUsers.map((u) => u.displayName).join(" → ")}.`,
      `Currently announcing: ${announcerName} — ${REVEALS_DONE_FOR_CURRENT} of 5 reveals done.`,
      `Owner sees "Announce for {name}" CTA + roster panel. Operator can also visit /room/{id}/present for the TV view.`,
    ],
    ownerSession: {
      userId: owner.userId,
      rejoinToken: owner.rejoinToken,
    },
  };
}

async function seedAnnouncingInstantAllReady(db: Db): Promise<SeedReport> {
  // status=announcing, mode=instant. Every member is_ready=true so the
  // admin's "Reveal final results" CTA is enabled (canRevealAll fires
  // when readyCount === totalCount per nextRevealCtaState).
  const owner = await insertSeededUser(db, 0);
  const guests = await Promise.all([
    insertSeededUser(db, 1),
    insertSeededUser(db, 2),
    insertSeededUser(db, 3),
  ]);
  const allUsers = [owner, ...guests];
  const room = await insertSeededRoom(db, owner.userId, {
    status: "announcing",
    announcement_mode: "instant",
    voting_ended_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  });
  for (const u of allUsers) {
    // Mark every member ready so the admin CTA fires.
    await insertMembership(db, room.roomId, u.userId, /* isReady */ true);
  }

  const contestants = await fetchSeedContestants();
  const { voteRows, resultRows } = buildFullVotesAndResults(
    room.roomId,
    allUsers,
    contestants,
  );
  const { error: votesErr } = await db.from("votes").insert(voteRows);
  if (votesErr) bail(`Failed to insert votes: ${votesErr.message}`);
  const { error: resultsErr } = await db.from("results").insert(resultRows);
  if (resultsErr) bail(`Failed to insert results: ${resultsErr.message}`);

  return {
    roomId: room.roomId,
    pin: room.pin,
    url: `/room/${room.roomId}`,
    notes: [
      `Status: announcing (instant). All 4 members marked ready.`,
      `Admin's "Reveal final results" CTA is enabled (no countdown — canRevealAll fires immediately).`,
      `Operator can also test "Reveal anyway" + the always-available admin override.`,
    ],
    ownerSession: {
      userId: owner.userId,
      rejoinToken: owner.rejoinToken,
    },
  };
}

const STATE_BUILDERS: Record<SeedState, (db: Db) => Promise<SeedReport>> = {
  "lobby-with-3-guests": seedLobbyWith3Guests,
  "voting-half-done": seedVotingHalfDone,
  "voting-ending-mid-countdown": seedVotingEndingMidCountdown,
  "announcing-mid-queue-live": seedAnnouncingMidQueueLive,
  "announcing-instant-all-ready": seedAnnouncingInstantAllReady,
  "done-with-awards": seedDoneWithAwards,
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
