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

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_REQUESTED_STATUSES: ReadonlySet<string> = new Set([
  "voting",
  "done",
]);

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): UpdateStatusFailure {
  return { ok: false, error: field ? { code, message, field } : { code, message }, status };
}

type RoomRow = Database["public"]["Tables"]["rooms"]["Row"];

function mapRoom(row: RoomRow): Room {
  return {
    id: row.id,
    pin: row.pin,
    year: row.year,
    event: row.event as Room["event"],
    categories: row.categories,
    ownerUserId: row.owner_user_id,
    status: row.status as Room["status"],
    announcementMode: row.announcement_mode as Room["announcementMode"],
    announcementOrder: row.announcement_order,
    announcingUserId: row.announcing_user_id,
    currentAnnounceIdx: row.current_announce_idx,
    nowPerformingId: row.now_performing_id,
    allowNowPerforming: row.allow_now_performing,
    createdAt: row.created_at,
  };
}

export async function updateRoomStatus(
  input: UpdateStatusInput,
  deps: UpdateStatusDeps
): Promise<UpdateStatusResult> {
  if (typeof input.roomId !== "string" || !UUID_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID.", 400, "roomId");
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return fail("INVALID_USER_ID", "userId must be a non-empty string.", 400, "userId");
  }
  if (typeof input.status !== "string" || !ALLOWED_REQUESTED_STATUSES.has(input.status)) {
    return fail(
      "INVALID_STATUS",
      "status must be one of 'voting' or 'done'.",
      400,
      "status"
    );
  }
  const roomId = input.roomId;
  const userId = input.userId;
  const status = input.status;

  const roomQuery = await deps.supabase
    .from("rooms")
    .select("id, status, owner_user_id")
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const row = roomQuery.data as {
    id: string;
    status: string;
    owner_user_id: string;
  };

  if (row.owner_user_id !== userId) {
    return fail(
      "FORBIDDEN",
      "Only the room owner can change the room's status.",
      403
    );
  }

  const { data: updated } = await deps.supabase
    .from("rooms")
    .update({ status })
    .eq("id", roomId)
    .select()
    .single();

  await deps.broadcastRoomEvent(roomId, { type: "status_changed", status });
  return { ok: true, room: mapRoom(updated as RoomRow) };
}
