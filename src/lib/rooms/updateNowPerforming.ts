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

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTESTANT_ID_MAX_LEN = 20;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): UpdateNowPerformingFailure {
  return { ok: false, error: field ? { code, message, field } : { code, message }, status };
}

export async function updateRoomNowPerforming(
  input: UpdateNowPerformingInput,
  deps: UpdateNowPerformingDeps
): Promise<UpdateNowPerformingResult> {
  if (typeof input.roomId !== "string" || !UUID_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID.", 400, "roomId");
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return fail("INVALID_USER_ID", "userId must be a non-empty string.", 400, "userId");
  }
  if (
    typeof input.contestantId !== "string" ||
    input.contestantId.length === 0 ||
    input.contestantId.length > CONTESTANT_ID_MAX_LEN
  ) {
    return fail(
      "INVALID_CONTESTANT_ID",
      `contestantId must be a string between 1 and ${CONTESTANT_ID_MAX_LEN} characters.`,
      400,
      "contestantId"
    );
  }
  const roomId = input.roomId;
  const userId = input.userId;
  const contestantId = input.contestantId;

  const roomQuery = await deps.supabase
    .from("rooms")
    .select("id, status, owner_user_id, allow_now_performing")
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const row = roomQuery.data as {
    id: string;
    status: string;
    owner_user_id: string;
    allow_now_performing: boolean;
  };

  if (row.owner_user_id !== userId) {
    return fail(
      "FORBIDDEN",
      "Only the room owner can set the currently-performing contestant.",
      403
    );
  }

  if (!row.allow_now_performing) {
    return fail(
      "NOW_PERFORMING_DISABLED",
      "This room did not enable the 'now performing' feature.",
      409
    );
  }

  if (row.status !== "voting") {
    return fail(
      "ROOM_NOT_VOTING",
      "The now-performing pointer can only be set while the room is voting.",
      409
    );
  }

  const updateResult = await deps.supabase
    .from("rooms")
    .update({ now_performing_id: contestantId })
    .eq("id", roomId)
    .select()
    .single();

  if (updateResult.error || !updateResult.data) {
    return fail("INTERNAL_ERROR", "Could not update room. Please try again.", 500);
  }

  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "now_performing",
      contestantId,
    });
  } catch (err) {
    console.warn(
      `broadcast 'now_performing' failed for room ${roomId}; state committed regardless:`,
      err
    );
  }

  return { ok: true, room: mapRoom(updateResult.data as RoomRow) };
}
