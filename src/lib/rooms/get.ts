import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Contestant, EventType, Room } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";
import { ContestDataError } from "@/lib/contestants";

export interface GetRoomInput {
  roomId: unknown;
}

export interface GetRoomDeps {
  supabase: SupabaseClient<Database>;
  fetchContestants: (year: number, event: EventType) => Promise<Contestant[]>;
}

export interface MembershipView {
  userId: string;
  displayName: string;
  avatarSeed: string;
  joinedAt: string;
  isReady: boolean;
}

export interface GetRoomData {
  room: Room;
  memberships: MembershipView[];
  contestants: Contestant[];
}

export interface GetRoomSuccess {
  ok: true;
  data: GetRoomData;
}

export interface GetRoomFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type GetRoomResult = GetRoomSuccess | GetRoomFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RoomRow = Database["public"]["Tables"]["rooms"]["Row"];

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): GetRoomFailure {
  return { ok: false, error: field ? { code, message, field } : { code, message }, status };
}

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

interface MembershipJoinedRow {
  user_id: string;
  joined_at: string;
  is_ready: boolean;
  users: { display_name: string; avatar_seed: string } | null;
}

function mapMembership(row: MembershipJoinedRow): MembershipView | null {
  if (!row.users) return null;
  return {
    userId: row.user_id,
    displayName: row.users.display_name,
    avatarSeed: row.users.avatar_seed,
    joinedAt: row.joined_at,
    isReady: row.is_ready,
  };
}

export async function getRoom(
  input: GetRoomInput,
  deps: GetRoomDeps
): Promise<GetRoomResult> {
  if (typeof input.roomId !== "string" || !UUID_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a valid UUID.", 400, "roomId");
  }
  const roomId = input.roomId;

  const roomQuery = await deps.supabase
    .from("rooms")
    .select("*")
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error) {
    return fail("INTERNAL_ERROR", "Could not load room. Please try again.", 500);
  }
  if (!roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }

  const room = mapRoom(roomQuery.data as RoomRow);

  const membershipQuery = await deps.supabase
    .from("room_memberships")
    .select("user_id, joined_at, is_ready, users(display_name, avatar_seed)")
    .eq("room_id", roomId);

  if (membershipQuery.error) {
    return fail("INTERNAL_ERROR", "Could not load room. Please try again.", 500);
  }

  const memberships = ((membershipQuery.data ?? []) as MembershipJoinedRow[])
    .map(mapMembership)
    .filter((m): m is MembershipView => m !== null);

  let contestants: Contestant[];
  try {
    contestants = await deps.fetchContestants(room.year, room.event);
  } catch (err) {
    if (err instanceof ContestDataError) {
      return fail(
        "INTERNAL_ERROR",
        "Could not load contestant data for this event.",
        500
      );
    }
    throw err;
  }

  return { ok: true, data: { room, memberships, contestants } };
}
