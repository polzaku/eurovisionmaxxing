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

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UNJOINABLE_STATUSES: ReadonlySet<string> = new Set([
  "scoring",
  "announcing",
  "done",
]);

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): JoinRoomFailure {
  return { ok: false, error: field ? { code, message, field } : { code, message }, status };
}

export async function joinRoomByMembership(
  input: JoinRoomInput,
  deps: JoinRoomDeps
): Promise<JoinRoomResult> {
  if (typeof input.roomId !== "string" || !UUID_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID.", 400, "roomId");
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return fail("INVALID_USER_ID", "userId must be a non-empty string.", 400, "userId");
  }
  const roomId = input.roomId;
  const userId = input.userId;

  const roomQuery = await deps.supabase
    .from("rooms")
    .select("id, status")
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const row = roomQuery.data as { id: string; status: string };

  if (UNJOINABLE_STATUSES.has(row.status)) {
    return fail(
      "ROOM_NOT_JOINABLE",
      "This room is no longer accepting new members.",
      409
    );
  }

  const { error: upsertError } = await deps.supabase
    .from("room_memberships")
    .upsert(
      { room_id: roomId, user_id: userId },
      { onConflict: "room_id,user_id", ignoreDuplicates: true }
    );

  if (upsertError) {
    return fail("INTERNAL_ERROR", "Could not join room. Please try again.", 500);
  }

  const userQuery = await deps.supabase
    .from("users")
    .select("display_name, avatar_seed")
    .eq("id", userId)
    .maybeSingle();

  if (userQuery.error || !userQuery.data) {
    return fail("INTERNAL_ERROR", "Could not read user record.", 500);
  }
  const u = userQuery.data as { display_name: string; avatar_seed: string };

  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "user_joined",
      user: { id: userId, displayName: u.display_name, avatarSeed: u.avatar_seed },
    });
  } catch (err) {
    console.warn(
      `broadcast 'user_joined' failed for room ${roomId}; state committed regardless:`,
      err
    );
  }

  return { ok: true };
}
