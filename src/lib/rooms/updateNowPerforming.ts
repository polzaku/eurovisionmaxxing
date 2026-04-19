import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Room } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface UpdateNowPerformingInput {
  roomId: unknown;
  contestantId: unknown;
  userId: unknown;
}

export interface UpdateNowPerformingDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
}

export interface UpdateNowPerformingSuccess {
  ok: true;
  room: Room;
}

export interface UpdateNowPerformingFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type UpdateNowPerformingResult =
  | UpdateNowPerformingSuccess
  | UpdateNowPerformingFailure;

export async function updateRoomNowPerforming(
  _input: UpdateNowPerformingInput,
  _deps: UpdateNowPerformingDeps
): Promise<UpdateNowPerformingResult> {
  throw new Error("not implemented");
}
