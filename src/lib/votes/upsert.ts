import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Vote } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface UpsertVoteInput {
  roomId: unknown;
  userId: unknown;
  contestantId: unknown;
  scores?: unknown;
  missed?: unknown;
  hotTake?: unknown;
  /**
   * True when the caller omitted `hotTake` entirely. False when they sent
   * `hotTake: null` (which clears) or a string (which overwrites). The
   * route adapter sets this by inspecting `Object.prototype.hasOwnProperty`
   * on the parsed body.
   */
  hotTakeOmitted?: boolean;
}

export interface UpsertVoteDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
}

export interface UpsertVoteSuccess {
  ok: true;
  vote: Vote;
  scoredCount: number;
}

export interface UpsertVoteFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type UpsertVoteResult = UpsertVoteSuccess | UpsertVoteFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTESTANT_ID_REGEX = /^\d{4}-[a-z]{2}$/;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): UpsertVoteFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

export async function upsertVote(
  input: UpsertVoteInput,
  deps: UpsertVoteDeps
): Promise<UpsertVoteResult> {
  if (typeof input.roomId !== "string" || !UUID_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID.", 400, "roomId");
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return fail(
      "INVALID_USER_ID",
      "userId must be a non-empty string.",
      400,
      "userId"
    );
  }
  if (
    typeof input.contestantId !== "string" ||
    !CONTESTANT_ID_REGEX.test(input.contestantId)
  ) {
    return fail(
      "INVALID_CONTESTANT_ID",
      "contestantId must look like '{year}-{countryCode}' (e.g. '2026-gb').",
      400,
      "contestantId"
    );
  }
  const roomId = input.roomId;
  const userId = input.userId;
  const contestantId = input.contestantId;

  const roomQuery = await deps.supabase
    .from("rooms")
    .select("id, status, categories")
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const roomRow = roomQuery.data as {
    id: string;
    status: string;
    categories: Array<{ name: string; weight: number; hint?: string }>;
  };

  const membershipQuery = await deps.supabase
    .from("room_memberships")
    .select("room_id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipQuery.error || !membershipQuery.data) {
    return fail(
      "FORBIDDEN",
      "You must join this room before voting.",
      403
    );
  }

  if (roomRow.status !== "voting") {
    return fail(
      "ROOM_NOT_VOTING",
      "Votes can only be cast while the room is in 'voting' status.",
      409
    );
  }

  // Body-shape validation (runs after room load so we can check category names)
  let scoresIn: Record<string, number> | undefined;
  if (input.scores !== undefined) {
    if (
      typeof input.scores !== "object" ||
      input.scores === null ||
      Array.isArray(input.scores)
    ) {
      return fail(
        "INVALID_BODY",
        "scores must be an object mapping category names to integers 1-10.",
        400,
        "scores"
      );
    }
    const categoryNames = new Set(roomRow.categories.map((c) => c.name));
    const parsed: Record<string, number> = {};
    for (const [key, value] of Object.entries(
      input.scores as Record<string, unknown>
    )) {
      if (!categoryNames.has(key)) {
        return fail(
          "INVALID_CATEGORY",
          `'${key}' is not a voting category for this room.`,
          400,
          `scores.${key}`
        );
      }
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 10
      ) {
        return fail(
          "INVALID_BODY",
          `Score for '${key}' must be an integer between 1 and 10.`,
          400,
          `scores.${key}`
        );
      }
      parsed[key] = value;
    }
    scoresIn = parsed;
  }

  if (input.missed !== undefined && typeof input.missed !== "boolean") {
    return fail("INVALID_BODY", "missed must be a boolean.", 400, "missed");
  }

  if (input.hotTake !== undefined) {
    if (input.hotTake !== null && typeof input.hotTake !== "string") {
      return fail(
        "INVALID_BODY",
        "hotTake must be a string, null, or omitted.",
        400,
        "hotTake"
      );
    }
    if (typeof input.hotTake === "string" && input.hotTake.length > 140) {
      return fail(
        "INVALID_BODY",
        "hotTake must be at most 140 characters.",
        400,
        "hotTake"
      );
    }
  }

  // Read existing row (may be null) for partial-merge semantics
  const existingQuery = await deps.supabase
    .from("votes")
    .select("scores, missed, hot_take")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .eq("contestant_id", contestantId)
    .maybeSingle();

  const existing = (existingQuery.data ?? null) as {
    scores: Record<string, number> | null;
    missed: boolean;
    hot_take: string | null;
  } | null;

  // Merge per design §4
  const mergedScores: Record<string, number> = {
    ...(existing?.scores ?? {}),
    ...(scoresIn ?? {}),
  };
  const mergedMissed =
    typeof input.missed === "boolean" ? input.missed : (existing?.missed ?? false);

  let mergedHotTake: string | null;
  if (input.hotTake !== undefined) {
    mergedHotTake = input.hotTake === null ? null : (input.hotTake as string);
  } else {
    mergedHotTake = existing?.hot_take ?? null;
  }

  const upsertPayload: Database["public"]["Tables"]["votes"]["Insert"] = {
    room_id: roomId,
    user_id: userId,
    contestant_id: contestantId,
    scores: mergedScores,
    missed: mergedMissed,
    hot_take: mergedHotTake,
  };

  const upsertResult = await deps.supabase
    .from("votes")
    .upsert(upsertPayload, { onConflict: "room_id,user_id,contestant_id" })
    .select()
    .single();

  if (upsertResult.error || !upsertResult.data) {
    return fail("INTERNAL_ERROR", "Could not save vote. Please try again.", 500);
  }

  const row = upsertResult.data as Database["public"]["Tables"]["votes"]["Row"];
  const vote: Vote = {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id,
    contestantId: row.contestant_id,
    scores: row.scores,
    missed: row.missed,
    hotTake: row.hot_take,
    updatedAt: row.updated_at,
  };

  // §5 of design: missed row → broadcast 0 regardless of scores object
  const scoredCount = vote.missed
    ? 0
    : Object.keys(vote.scores ?? {}).length;

  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "voting_progress",
      userId,
      contestantId,
      scoredCount,
    });
  } catch (err) {
    console.warn(
      `broadcast 'voting_progress' failed for room ${roomId}; state committed regardless:`,
      err
    );
  }

  return { ok: true, vote, scoredCount };
}
