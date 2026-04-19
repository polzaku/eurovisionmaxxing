import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Room } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";

export interface RoomEventPayload {
  type: "status_changed";
  status: string;
}

export interface UpdateStatusInput {
  roomId: unknown;
  status: unknown;
  userId: unknown;
}

export interface UpdateStatusDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
}

export interface UpdateStatusSuccess {
  ok: true;
  room: Room;
}

export interface UpdateStatusFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type UpdateStatusResult = UpdateStatusSuccess | UpdateStatusFailure;

export async function updateRoomStatus(
  _input: UpdateStatusInput,
  _deps: UpdateStatusDeps
): Promise<UpdateStatusResult> {
  throw new Error("not implemented");
}
