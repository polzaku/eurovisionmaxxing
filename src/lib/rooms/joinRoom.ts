import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface JoinRoomInput {
  roomId: unknown;
  userId: unknown;
}

export interface JoinRoomDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
}

export interface JoinRoomSuccess {
  ok: true;
}

export interface JoinRoomFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type JoinRoomResult = JoinRoomSuccess | JoinRoomFailure;

export async function joinRoomByMembership(
  _input: JoinRoomInput,
  _deps: JoinRoomDeps
): Promise<JoinRoomResult> {
  throw new Error("not implemented");
}
