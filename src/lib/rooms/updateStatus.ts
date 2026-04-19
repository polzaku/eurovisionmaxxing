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
  const roomId = input.roomId as string;
  const status = input.status as string;

  const { data: updated } = await deps.supabase
    .from("rooms")
    .update({ status })
    .eq("id", roomId)
    .select()
    .single();

  await deps.broadcastRoomEvent(roomId, { type: "status_changed", status });
  return { ok: true, room: mapRoom(updated as RoomRow) };
}
