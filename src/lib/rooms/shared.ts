import type { Database } from "@/types/database";
import type { Room } from "@/types";
import { createServiceClient } from "@/lib/supabase/server";

/** Discriminated union of realtime broadcast payloads on `room:{id}` channels (SPEC §15). */
export type RoomEventPayload =
  | { type: "status_changed"; status: string }
  | { type: "now_performing"; contestantId: string }
  | {
      type: "user_joined";
      user: { id: string; displayName: string; avatarSeed: string };
    };

type RoomRow = Database["public"]["Tables"]["rooms"]["Row"];

/** Maps a rooms row to the domain Room. */
export function mapRoom(row: RoomRow): Room {
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

/** Default production broadcast implementation. Route adapters inject this; tests mock it. */
export async function defaultBroadcastRoomEvent(
  roomId: string,
  event: RoomEventPayload
): Promise<void> {
  const supabase = createServiceClient();
  const channel = supabase.channel(`room:${roomId}`);
  try {
    await channel.send({
      type: "broadcast",
      event: "room_event",
      payload: event,
    });
  } finally {
    await supabase.removeChannel(channel);
  }
}
