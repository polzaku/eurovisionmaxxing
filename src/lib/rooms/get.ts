import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Contestant, EventType, Room } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";
import { ContestDataError } from "@/lib/contestants";
import { mapRoom } from "@/lib/rooms/shared";

export interface GetRoomInput {
  roomId: unknown;
  userId?: unknown;
}

export interface VoteView {
  contestantId: string;
  scores: Record<string, number | null> | null;
  missed: boolean;
  hotTake: string | null;
  updatedAt: string;
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
  votes: VoteView[];
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

  let votes: VoteView[] = [];
  if (input.userId !== undefined) {
    if (typeof input.userId !== "string" || !UUID_REGEX.test(input.userId)) {
      return fail("INVALID_USER_ID", "userId must be a valid UUID.", 400, "userId");
    }
    const userId = input.userId;
    const votesQuery = await deps.supabase
      .from("votes")
      .select("contestant_id, scores, missed, hot_take, updated_at")
      .eq("room_id", roomId)
      .eq("user_id", userId);

    if (!votesQuery.error && Array.isArray(votesQuery.data)) {
      votes = (votesQuery.data as Array<{
        contestant_id: string;
        scores: Record<string, number | null> | null;
        missed: boolean;
        hot_take: string | null;
        updated_at: string;
      }>).map((row) => ({
        contestantId: row.contestant_id,
        scores: row.scores,
        missed: row.missed,
        hotTake: row.hot_take,
        updatedAt: row.updated_at,
      }));
    }
  }

  return { ok: true, data: { room, memberships, contestants, votes } };
}
