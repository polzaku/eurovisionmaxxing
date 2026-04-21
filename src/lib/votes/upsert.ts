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

export async function upsertVote(
  _input: UpsertVoteInput,
  _deps: UpsertVoteDeps
): Promise<UpsertVoteResult> {
  throw new Error("not implemented");
}
