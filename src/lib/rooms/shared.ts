import type { Database } from "@/types/database";
import type { Room } from "@/types";

/** Discriminated union of realtime broadcast payloads on `room:{id}` channels (SPEC §15). */
export type RoomEventPayload =
  | { type: "status_changed"; status: string }
  | { type: "voting_ending"; votingEndsAt: string }
  | { type: "now_performing"; contestantId: string }
  | {
      type: "user_joined";
      user: { id: string; displayName: string; avatarSeed: string };
    }
  | {
      type: "voting_progress";
      userId: string;
      contestantId: string;
      scoredCount: number;
    }
  | {
      type: "announce_next";
      contestantId: string;
      points: number;
      announcingUserId: string;
    }
  | {
      type: "announce_skip";
      userId: string;
      displayName: string;
    }
  | {
      type: "announce_skip_restored";
      userId: string;
      displayName: string;
    }
  | {
      type: "announcement_order_reshuffled";
      announcementOrder: string[];
      announcingUserId: string;
    }
  | {
      type: "score_update";
      contestantId: string;
      newTotal: number;
      newRank: number;
    }
  | {
      type: "member_ready";
      userId: string;
      readyAt: string;
      readyCount: number;
      totalCount: number;
    }
  | { type: "contestants_refreshed" }
  | {
      type: "hot_take_deleted";
      userId: string;
      contestantId: string;
      deletedByUserId: string;
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
    votingEndsAt: row.voting_ends_at,
    votingEndedAt: row.voting_ended_at,
    createdAt: row.created_at,
  };
}

/**
 * Default production broadcast implementation. Route adapters inject this;
 * tests mock it.
 *
 * Uses Supabase's Realtime HTTP broadcast endpoint rather than the
 * supabase-js `channel().send()` path, which requires the sender to first
 * subscribe + await the `SUBSCRIBED` acknowledgement — adding 200-500ms of
 * latency per broadcast and failing silently in server-side Node contexts
 * without `ws` installed. The HTTP endpoint delivers to the same topic
 * without any subscribe handshake.
 *
 * Endpoint: `POST {SUPABASE_URL}/realtime/v1/api/broadcast`
 * Reference: https://supabase.com/docs/guides/realtime/broadcast#http
 */
export async function defaultBroadcastRoomEvent(
  roomId: string,
  event: RoomEventPayload
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "defaultBroadcastRoomEvent: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY missing"
    );
  }
  const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      messages: [
        {
          topic: `room:${roomId}`,
          event: "room_event",
          payload: event,
          private: false,
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(
      `defaultBroadcastRoomEvent: Supabase returned ${res.status} ${res.statusText}`
    );
  }
}
