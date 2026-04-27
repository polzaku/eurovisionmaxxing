import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";

export interface LoadOwnPointsInput {
  roomId: unknown;
  userId: unknown;
}

export interface LoadOwnPointsDeps {
  supabase: SupabaseClient<Database>;
}

export interface OwnPointsEntry {
  contestantId: string;
  pointsAwarded: number;
  hotTake: string | null;
}

export interface LoadOwnPointsSuccess {
  ok: true;
  entries: OwnPointsEntry[];
}

export interface LoadOwnPointsFailure {
  ok: false;
  status: number;
  error: { code: ApiErrorCode; message: string; field?: string };
}

export type LoadOwnPointsResult = LoadOwnPointsSuccess | LoadOwnPointsFailure;

export async function loadOwnPoints(
  input: LoadOwnPointsInput,
  deps: LoadOwnPointsDeps,
): Promise<LoadOwnPointsResult> {
  const { roomId, userId } = input;
  if (typeof roomId !== "string" || roomId.length === 0) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "INVALID_BODY",
        message: "roomId must be a non-empty string.",
        field: "roomId",
      },
    };
  }
  if (typeof userId !== "string" || userId.length === 0) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "INVALID_BODY",
        message: "userId must be a non-empty string.",
        field: "userId",
      },
    };
  }

  const { supabase } = deps;

  // Confirm the room exists + is in a status where own-points are meaningful.
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, status")
    .eq("id", roomId)
    .single();
  if (roomError || !room) {
    return {
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND", message: "Room not found." },
    };
  }
  if (room.status !== "announcing" && room.status !== "done") {
    return {
      ok: false,
      status: 409,
      error: {
        code: "ROOM_NOT_ANNOUNCING",
        message: "Own-points are available only during announcing or done.",
      },
    };
  }

  // Auth: caller must be a member of the room.
  const { data: membership, error: memErr } = await supabase
    .from("room_memberships")
    .select("user_id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .single();
  if (memErr || !membership) {
    return {
      ok: false,
      status: 403,
      error: {
        code: "ROOM_NOT_FOUND",
        message: "You are not a member of this room.",
      },
    };
  }

  // Fetch the caller's own results rows (all of them — even
  // points_awarded = 0 ones, the consumer filters for display).
  const { data: results, error: resErr } = await supabase
    .from("results")
    .select("contestant_id, points_awarded")
    .eq("room_id", roomId)
    .eq("user_id", userId);
  if (resErr || !results) {
    return {
      ok: false,
      status: 500,
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to load own results.",
      },
    };
  }

  // Fetch the caller's hot takes for the same contestants (left-join in
  // memory — the votes table is keyed by (room_id, user_id, contestant_id)).
  const { data: votes, error: votesErr } = await supabase
    .from("votes")
    .select("contestant_id, hot_take")
    .eq("room_id", roomId)
    .eq("user_id", userId);
  if (votesErr || !votes) {
    return {
      ok: false,
      status: 500,
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to load own hot takes.",
      },
    };
  }
  const hotTakeByContestant = new Map<string, string | null>();
  for (const v of votes) {
    hotTakeByContestant.set(v.contestant_id, v.hot_take ?? null);
  }

  const entries: OwnPointsEntry[] = results.map((r) => ({
    contestantId: r.contestant_id,
    pointsAwarded: r.points_awarded,
    hotTake: hotTakeByContestant.get(r.contestant_id) ?? null,
  }));

  return { ok: true, entries };
}
