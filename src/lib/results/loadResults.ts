import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Contestant, EventType, RoomAward } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";
import { ContestDataError } from "@/lib/contestants";
import type { LeaderboardEntry } from "@/lib/results/formatRoomSummary";

export interface UserBreakdownPick {
  contestantId: string;
  pointsAwarded: number;
}

export interface UserBreakdown {
  userId: string;
  displayName: string;
  avatarSeed: string;
  picks: UserBreakdownPick[]; // sorted desc by points
}

export interface HotTakeEntry {
  userId: string;
  displayName: string;
  avatarSeed: string;
  contestantId: string;
  hotTake: string;
  /** SPEC §8.7.1 — non-null indicates the hot-take was edited after first save. */
  hotTakeEditedAt: string | null;
}

/**
 * Live announcer state attached to the `announcing` payload so the room UI
 * has everything it needs to render the reveal queue without a second
 * round-trip. Null when there are no eligible announcers (degenerate
 * empty-room case — see `runScoring` live-mode init).
 */
export interface AnnouncementState {
  announcingUserId: string;
  announcingDisplayName: string;
  announcingAvatarSeed: string;
  currentAnnounceIdx: number;
  /**
   * The reveal that's about to happen (announcer's results[idx]). Null if
   * the queue has been exhausted (server should have rotated by then but
   * keep null tolerant for transitional broadcasts).
   */
  pendingReveal: { contestantId: string; points: number } | null;
  /**
   * Total reveals planned for this announcer. Used by the UI to render
   * "{idx + 1} / {queueLength}" progress.
   */
  queueLength: number;
  /**
   * If non-null, the room owner has taken control via `POST /announce/handoff`
   * and is driving the reveals on the original announcer's behalf. The
   * announcer still owns the points being revealed (record-of-record); the
   * delegate is just tapping the button. The original announcer's UI shows
   * a passive "Admin is announcing for you" state when this is set.
   */
  delegateUserId: string | null;
  /**
   * 1-indexed position of the current announcer in `announcement_order`.
   * `1` means the first announcer is up; equals `announcerCount` when the
   * last one is mid-queue.
   */
  announcerPosition: number;
  /** Total number of eligible announcers in `announcement_order`. */
  announcerCount: number;
}

// Discriminated union per SPEC §12.5. `voting_ending` is forward-compat
// with TODO R0; current schema's CHECK constraint means it never appears.
export type ResultsData =
  | { status: "lobby"; pin: string; broadcastStartUtc: string | null }
  | { status: "voting" | "voting_ending"; pin: string }
  | { status: "scoring" }
  | {
      status: "announcing";
      year: number;
      event: EventType;
      pin: string;
      leaderboard: LeaderboardEntry[];
      contestants: Contestant[];
      announcement: AnnouncementState | null;
    }
  | {
      status: "done";
      year: number;
      event: EventType;
      pin: string;
      /** Room owner — clients with a matching session unlock admin moderation (§8.7.2). */
      ownerUserId: string;
      leaderboard: LeaderboardEntry[];
      contestants: Contestant[];
      breakdowns: UserBreakdown[];
      hotTakes: HotTakeEntry[];
      awards: RoomAward[];
      /** Roster (for awards rendering when winners aren't already in `breakdowns`). */
      members: Array<{
        userId: string;
        displayName: string;
        avatarSeed: string;
      }>;
    };

export interface LoadResultsInput {
  roomId: unknown;
}

export interface LoadResultsDeps {
  supabase: SupabaseClient<Database>;
  fetchContestants: (year: number, event: EventType) => Promise<Contestant[]>;
  fetchContestantsMeta: (
    year: number,
    event: EventType,
  ) => Promise<{ broadcastStartUtc: string | null }>;
}

export interface LoadResultsSuccess {
  ok: true;
  data: ResultsData;
}

export interface LoadResultsFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type LoadResultsResult = LoadResultsSuccess | LoadResultsFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): LoadResultsFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

type RoomBase = {
  id: string;
  status: string;
  pin: string;
  year: number;
  event: string;
  owner_user_id: string;
  announcement_order: string[] | null;
  announcing_user_id: string | null;
  current_announce_idx: number | null;
  delegate_user_id: string | null;
};

type ResultRow = {
  user_id: string;
  contestant_id: string;
  points_awarded: number;
  announced: boolean;
};

interface MembershipWithUser {
  user_id: string;
  users: { display_name: string; avatar_seed: string } | null;
}

interface VoteHotTakeRow {
  user_id: string;
  contestant_id: string;
  hot_take: string | null;
  hot_take_edited_at: string | null;
}

/**
 * Build a leaderboard from raw result rows. Competition ranking
 * (ties share the position; subsequent ranks skip, e.g. 1, 2, 2, 4).
 * Order: totalPoints desc, contestant_id asc as a deterministic tiebreak.
 */
function buildLeaderboard(rows: ResultRow[]): LeaderboardEntry[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    totals.set(
      r.contestant_id,
      (totals.get(r.contestant_id) ?? 0) + r.points_awarded,
    );
  }
  const sorted = [...totals.entries()]
    .map(([contestantId, totalPoints]) => ({ contestantId, totalPoints }))
    .sort((a, b) => {
      if (a.totalPoints !== b.totalPoints) return b.totalPoints - a.totalPoints;
      return a.contestantId.localeCompare(b.contestantId);
    });

  const leaderboard: LeaderboardEntry[] = [];
  let prevPoints: number | null = null;
  let prevRank = 0;
  sorted.forEach((e, idx) => {
    const rank = prevPoints !== null && e.totalPoints === prevPoints
      ? prevRank
      : idx + 1;
    leaderboard.push({ ...e, rank });
    prevPoints = e.totalPoints;
    prevRank = rank;
  });
  return leaderboard;
}

/**
 * §12.5 results loader. Returns one of five discriminated shapes keyed by
 * `rooms.status`. Never throws; all failures surface as `LoadResultsFailure`.
 */
export async function loadResults(
  input: LoadResultsInput,
  deps: LoadResultsDeps,
): Promise<LoadResultsResult> {
  if (typeof input.roomId !== "string" || !UUID_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID.", 400, "roomId");
  }
  const roomId = input.roomId;

  const roomQuery = await deps.supabase
    .from("rooms")
    .select(
      "id, status, pin, year, event, owner_user_id, announcement_order, announcing_user_id, current_announce_idx, delegate_user_id",
    )
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error) {
    return fail("INTERNAL_ERROR", "Could not load room.", 500);
  }
  if (!roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const room = roomQuery.data as RoomBase;
  const event = room.event as EventType;

  switch (room.status) {
    case "lobby": {
      try {
        const meta = await deps.fetchContestantsMeta(room.year, event);
        return {
          ok: true,
          data: {
            status: "lobby",
            pin: room.pin,
            broadcastStartUtc: meta.broadcastStartUtc,
          },
        };
      } catch (err) {
        if (err instanceof ContestDataError) {
          return {
            ok: true,
            data: { status: "lobby", pin: room.pin, broadcastStartUtc: null },
          };
        }
        throw err;
      }
    }
    case "voting":
    case "voting_ending":
      return {
        ok: true,
        data: { status: room.status, pin: room.pin },
      };
    case "scoring":
      return { ok: true, data: { status: "scoring" } };
    case "announcing":
      return loadAnnouncing(room, event, deps);
    case "done":
      return loadDone(room, event, deps);
    default:
      // Unknown status — treat as voting placeholder rather than 500.
      return {
        ok: true,
        data: { status: "voting", pin: room.pin },
      };
  }
}

async function loadAnnouncing(
  room: RoomBase,
  event: EventType,
  deps: LoadResultsDeps,
): Promise<LoadResultsResult> {
  const resultsQuery = await deps.supabase
    .from("results")
    .select("user_id, contestant_id, points_awarded, announced")
    .eq("room_id", room.id)
    .eq("announced", true);

  if (resultsQuery.error) {
    return fail("INTERNAL_ERROR", "Could not load live leaderboard.", 500);
  }

  let contestants: Contestant[];
  try {
    contestants = await deps.fetchContestants(room.year, event);
  } catch (err) {
    if (err instanceof ContestDataError) {
      return fail("INTERNAL_ERROR", "Could not load contestants.", 500);
    }
    throw err;
  }

  const rows = (resultsQuery.data ?? []) as ResultRow[];
  const leaderboard = buildLeaderboardSeeded(rows, contestants);

  // Load announcer state — name + avatar + pending reveal queue.
  let announcement: AnnouncementState | null = null;
  if (room.announcing_user_id) {
    const announcerId = room.announcing_user_id;
    const userQuery = await deps.supabase
      .from("users")
      .select("display_name, avatar_seed")
      .eq("id", announcerId)
      .maybeSingle();
    if (userQuery.error) {
      return fail("INTERNAL_ERROR", "Could not load announcer.", 500);
    }
    const announcerRowsQuery = await deps.supabase
      .from("results")
      .select("contestant_id, points_awarded")
      .eq("room_id", room.id)
      .eq("user_id", announcerId)
      .gt("points_awarded", 0)
      .order("rank", { ascending: false });
    if (announcerRowsQuery.error) {
      return fail("INTERNAL_ERROR", "Could not load announcer queue.", 500);
    }
    const announcerRows = (announcerRowsQuery.data ?? []) as Array<{
      contestant_id: string;
      points_awarded: number;
    }>;
    const idx = room.current_announce_idx ?? 0;
    const pending =
      idx >= 0 && idx < announcerRows.length
        ? {
            contestantId: announcerRows[idx].contestant_id,
            points: announcerRows[idx].points_awarded,
          }
        : null;
    const announcerUser = (userQuery.data ?? null) as
      | { display_name: string; avatar_seed: string }
      | null;
    const order = room.announcement_order ?? [];
    const positionIdx = order.indexOf(announcerId);
    announcement = {
      announcingUserId: announcerId,
      announcingDisplayName: announcerUser?.display_name ?? "",
      announcingAvatarSeed: announcerUser?.avatar_seed ?? "",
      currentAnnounceIdx: idx,
      pendingReveal: pending,
      queueLength: announcerRows.length,
      delegateUserId: room.delegate_user_id ?? null,
      announcerPosition: positionIdx >= 0 ? positionIdx + 1 : 1,
      announcerCount: order.length || 1,
    };
  }

  return {
    ok: true,
    data: {
      status: "announcing",
      year: room.year,
      event,
      pin: room.pin,
      leaderboard,
      contestants,
      announcement,
    },
  };
}

async function loadDone(
  room: RoomBase,
  event: EventType,
  deps: LoadResultsDeps,
): Promise<LoadResultsResult> {
  const resultsQuery = await deps.supabase
    .from("results")
    .select("user_id, contestant_id, points_awarded, announced")
    .eq("room_id", room.id);

  if (resultsQuery.error) {
    return fail("INTERNAL_ERROR", "Could not load results.", 500);
  }
  const resultRows = (resultsQuery.data ?? []) as ResultRow[];

  const membershipsQuery = await deps.supabase
    .from("room_memberships")
    .select("user_id, users(display_name, avatar_seed)")
    .eq("room_id", room.id);

  if (membershipsQuery.error) {
    return fail("INTERNAL_ERROR", "Could not load room memberships.", 500);
  }
  const memberRows = (membershipsQuery.data ?? []) as MembershipWithUser[];
  const userLookup = new Map<
    string,
    { displayName: string; avatarSeed: string }
  >();
  for (const m of memberRows) {
    if (m.users) {
      userLookup.set(m.user_id, {
        displayName: m.users.display_name,
        avatarSeed: m.users.avatar_seed,
      });
    }
  }

  const hotTakesQuery = await deps.supabase
    .from("votes")
    .select("user_id, contestant_id, hot_take, hot_take_edited_at")
    .eq("room_id", room.id)
    .not("hot_take", "is", null);

  if (hotTakesQuery.error) {
    return fail("INTERNAL_ERROR", "Could not load hot takes.", 500);
  }
  const hotTakeRows = (hotTakesQuery.data ?? []) as VoteHotTakeRow[];

  const awardsQuery = await deps.supabase
    .from("room_awards")
    .select("*")
    .eq("room_id", room.id);

  if (awardsQuery.error) {
    return fail("INTERNAL_ERROR", "Could not load awards.", 500);
  }
  const awardRows = (awardsQuery.data ?? []) as Array<
    Database["public"]["Tables"]["room_awards"]["Row"]
  >;
  const awards: RoomAward[] = awardRows.map((row) => ({
    roomId: row.room_id,
    awardKey: row.award_key,
    awardName: row.award_name,
    winnerUserId: row.winner_user_id,
    winnerUserIdB: row.winner_user_id_b,
    winnerContestantId: row.winner_contestant_id,
    statValue: row.stat_value,
    statLabel: row.stat_label,
  }));

  let contestants: Contestant[];
  try {
    contestants = await deps.fetchContestants(room.year, event);
  } catch (err) {
    if (err instanceof ContestDataError) {
      return fail("INTERNAL_ERROR", "Could not load contestants.", 500);
    }
    throw err;
  }

  const leaderboard = buildLeaderboardSeeded(resultRows, contestants);

  // Breakdowns: per user, drop rows with pointsAwarded === 0 (ranks 11+).
  const byUser = new Map<string, UserBreakdownPick[]>();
  for (const r of resultRows) {
    if (r.points_awarded <= 0) continue;
    const list = byUser.get(r.user_id) ?? [];
    list.push({
      contestantId: r.contestant_id,
      pointsAwarded: r.points_awarded,
    });
    byUser.set(r.user_id, list);
  }
  const breakdowns: UserBreakdown[] = [];
  for (const [userId, picks] of byUser.entries()) {
    const info = userLookup.get(userId);
    if (!info) continue;
    picks.sort((a, b) => b.pointsAwarded - a.pointsAwarded);
    breakdowns.push({
      userId,
      displayName: info.displayName,
      avatarSeed: info.avatarSeed,
      picks,
    });
  }
  breakdowns.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const hotTakes: HotTakeEntry[] = [];
  for (const row of hotTakeRows) {
    if (!row.hot_take || row.hot_take.trim() === "") continue;
    const info = userLookup.get(row.user_id);
    if (!info) continue;
    hotTakes.push({
      userId: row.user_id,
      displayName: info.displayName,
      avatarSeed: info.avatarSeed,
      contestantId: row.contestant_id,
      hotTake: row.hot_take,
      hotTakeEditedAt: row.hot_take_edited_at,
    });
  }

  const members = [...userLookup.entries()].map(([userId, info]) => ({
    userId,
    displayName: info.displayName,
    avatarSeed: info.avatarSeed,
  }));

  return {
    ok: true,
    data: {
      status: "done",
      year: room.year,
      event,
      pin: room.pin,
      ownerUserId: room.owner_user_id,
      leaderboard,
      contestants,
      breakdowns,
      hotTakes,
      awards,
      members,
    },
  };
}

/**
 * Build the leaderboard including every contestant in the room's field, not
 * just the ones that currently have points. Missing contestants appear with
 * 0 pts at the tail (alphabetical).
 */
function buildLeaderboardSeeded(
  rows: ResultRow[],
  contestants: Contestant[],
): LeaderboardEntry[] {
  const totals = new Map<string, number>();
  for (const c of contestants) totals.set(c.id, 0);
  for (const r of rows) {
    totals.set(
      r.contestant_id,
      (totals.get(r.contestant_id) ?? 0) + r.points_awarded,
    );
  }
  return buildLeaderboard(
    [...totals.entries()].map(([contestant_id, points]) => ({
      user_id: "",
      contestant_id,
      points_awarded: points,
      announced: true,
    })),
  );
}
