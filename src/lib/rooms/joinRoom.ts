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
  input: JoinRoomInput,
  deps: JoinRoomDeps
): Promise<JoinRoomResult> {
  const roomId = input.roomId as string;
  const userId = input.userId as string;

  await deps.supabase
    .from("room_memberships")
    .upsert(
      { room_id: roomId, user_id: userId },
      { onConflict: "room_id,user_id", ignoreDuplicates: true }
    );

  const { data: userRow } = await deps.supabase
    .from("users")
    .select("display_name, avatar_seed")
    .eq("id", userId)
    .maybeSingle();

  const u = userRow as { display_name: string; avatar_seed: string };
  await deps.broadcastRoomEvent(roomId, {
    type: "user_joined",
    user: { id: userId, displayName: u.display_name, avatarSeed: u.avatar_seed },
  });

  return { ok: true };
}
