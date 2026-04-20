import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Room } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";
import { mapRoom, type RoomEventPayload } from "@/lib/rooms/shared";

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

type RoomRow = Database["public"]["Tables"]["rooms"]["Row"];

export async function updateRoomNowPerforming(
  input: UpdateNowPerformingInput,
  deps: UpdateNowPerformingDeps
): Promise<UpdateNowPerformingResult> {
  const roomId = input.roomId as string;
  const contestantId = input.contestantId as string;

  const { data: updated } = await deps.supabase
    .from("rooms")
    .update({ now_performing_id: contestantId })
    .eq("id", roomId)
    .select()
    .single();

  await deps.broadcastRoomEvent(roomId, {
    type: "now_performing",
    contestantId,
  });
  return { ok: true, room: mapRoom(updated as RoomRow) };
}
