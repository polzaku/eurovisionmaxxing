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
  _deps: UpsertVoteDeps
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
  throw new Error("not implemented");
}
