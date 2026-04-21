import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Contestant, EventType, Vote, VotingCategory } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";
import { scoreRoom, type LeaderboardEntry } from "@/lib/scoring";
import { ContestDataError } from "@/lib/contestants";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface RunScoringInput {
  roomId: unknown;
  userId: unknown;
}

export interface RunScoringDeps {
  supabase: SupabaseClient<Database>;
  fetchContestants: (year: number, event: EventType) => Promise<Contestant[]>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
}

export interface RunScoringSuccess {
  ok: true;
  leaderboard: LeaderboardEntry[];
}

export interface RunScoringFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type RunScoringResult = RunScoringSuccess | RunScoringFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): RunScoringFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

type RoomSelectRow = {
  id: string;
  status: string;
  owner_user_id: string;
  year: number;
  event: string;
  categories: VotingCategory[];
};

type VoteRow = Database["public"]["Tables"]["votes"]["Row"];

function mapVote(row: VoteRow): Vote {
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id,
    contestantId: row.contestant_id,
    scores: row.scores,
    missed: row.missed,
    hotTake: row.hot_take,
    updatedAt: row.updated_at,
  };
}

/**
 * Orchestrate the SPEC §9 scoring pipeline against Supabase.
 *
 * Transitions room `voting → scoring → announcing` (SPEC §9), fills missed
 * votes per SPEC §9.1, writes the `results` table per SPEC §9.5.
 *
 * Idempotent under retry: if a prior attempt reached `scoring` but crashed
 * before `announcing`, calling again reruns the work cleanly (votes UPDATEs
 * are no-ops when the filled values are already in place; results UPSERTs on
 * composite PK; the second status transition is conditional).
 */
export async function runScoring(
  input: RunScoringInput,
  deps: RunScoringDeps,
): Promise<RunScoringResult> {
  if (typeof input.roomId !== "string" || !UUID_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID.", 400, "roomId");
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return fail(
      "INVALID_USER_ID",
      "userId must be a non-empty string.",
      400,
      "userId",
    );
  }
  const roomId = input.roomId;
  const userId = input.userId;

  // 1. Load the room.
  const roomQuery = await deps.supabase
    .from("rooms")
    .select("id, status, owner_user_id, year, event, categories")
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const room = roomQuery.data as RoomSelectRow;

  // 2. Owner check.
  if (room.owner_user_id !== userId) {
    return fail(
      "FORBIDDEN",
      "Only the room owner can trigger scoring.",
      403,
    );
  }

  // 3. Status guard.
  if (room.status !== "voting" && room.status !== "scoring") {
    return fail(
      "ROOM_NOT_VOTING",
      "Scoring can only be triggered while the room is voting.",
      409,
    );
  }

  // 4. Transition voting→scoring (conditional, idempotent under retry).
  const toScoring = await deps.supabase
    .from("rooms")
    .update({ status: "scoring" })
    .eq("id", roomId)
    .in("status", ["voting", "scoring"])
    .select("id")
    .maybeSingle();

  if (toScoring.error || !toScoring.data) {
    return fail(
      "INTERNAL_ERROR",
      "Could not start scoring. Please try again.",
      500,
    );
  }

  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "status_changed",
      status: "scoring",
    });
  } catch (err) {
    console.warn(
      `broadcast 'status_changed:scoring' failed for room ${roomId}; state committed regardless:`,
      err,
    );
  }

  // 5. Load pipeline inputs.
  let contestants: Contestant[];
  try {
    contestants = await deps.fetchContestants(
      room.year,
      room.event as EventType,
    );
  } catch (err) {
    if (err instanceof ContestDataError) {
      return fail(
        "INTERNAL_ERROR",
        "Could not load contestant data for scoring.",
        500,
      );
    }
    throw err;
  }

  const membershipQuery = await deps.supabase
    .from("room_memberships")
    .select("user_id, joined_at")
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });

  if (membershipQuery.error) {
    return fail(
      "INTERNAL_ERROR",
      "Could not load room memberships for scoring.",
      500,
    );
  }
  const userIds = (membershipQuery.data ?? []).map(
    (m) => (m as { user_id: string }).user_id,
  );

  const votesQuery = await deps.supabase
    .from("votes")
    .select("*")
    .eq("room_id", roomId);

  if (votesQuery.error) {
    return fail(
      "INTERNAL_ERROR",
      "Could not load votes for scoring.",
      500,
    );
  }
  const rawVotes = ((votesQuery.data ?? []) as VoteRow[]).map(mapVote);

  // 6. Run the pure pipeline.
  const out = scoreRoom({
    categories: room.categories,
    contestants: contestants.map((c) => ({ id: c.id, country: c.country })),
    userIds,
    votes: rawVotes,
  });

  // 7. Write filled scores back for missed votes (preserve missed=true).
  for (const v of out.filledVotes) {
    if (!v.missed) continue;
    const upd = await deps.supabase
      .from("votes")
      .update({ scores: v.scores })
      .eq("id", v.id);
    if (upd.error) {
      return fail(
        "INTERNAL_ERROR",
        "Could not write filled vote scores.",
        500,
      );
    }
  }

  // 8. UPSERT results (SPEC §9.5).
  if (out.results.length > 0) {
    const rows = out.results.map((r) => ({
      room_id: roomId,
      user_id: r.userId,
      contestant_id: r.contestantId,
      weighted_score: r.weightedScore,
      rank: r.rank,
      points_awarded: r.pointsAwarded,
    }));
    const resultsUpsert = await deps.supabase
      .from("results")
      .upsert(rows, { onConflict: "room_id,user_id,contestant_id" });
    if (resultsUpsert.error) {
      return fail(
        "INTERNAL_ERROR",
        "Could not write scoring results.",
        500,
      );
    }
  }

  // 9. Transition scoring → announcing (conditional).
  const toAnnouncing = await deps.supabase
    .from("rooms")
    .update({ status: "announcing" })
    .eq("id", roomId)
    .eq("status", "scoring")
    .select("id")
    .maybeSingle();

  if (toAnnouncing.error || !toAnnouncing.data) {
    return fail(
      "INTERNAL_ERROR",
      "Could not finalise scoring. Please try again.",
      500,
    );
  }

  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "status_changed",
      status: "announcing",
    });
  } catch (err) {
    console.warn(
      `broadcast 'status_changed:announcing' failed for room ${roomId}; state committed regardless:`,
      err,
    );
  }

  return { ok: true, leaderboard: out.leaderboard };
}
