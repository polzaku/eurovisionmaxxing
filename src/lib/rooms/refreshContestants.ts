import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Contestant, EventType } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface RefreshContestantsInput {
  roomId: unknown;
  userId: unknown;
}

export interface RefreshContestantsDeps {
  supabase: SupabaseClient<Database>;
  fetchContestants: (
    year: number,
    event: EventType,
    options?: { bypassCache?: boolean },
  ) => Promise<Contestant[]>;
  broadcastRoomEvent: (
    roomId: string,
    event: RoomEventPayload,
  ) => Promise<void>;
}

export interface RefreshContestantsSuccess {
  ok: true;
  contestants: Contestant[];
}

export interface RefreshContestantsFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type RefreshContestantsResult =
  | RefreshContestantsSuccess
  | RefreshContestantsFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): RefreshContestantsFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

/**
 * SPEC §5.1d admin-driven contestant refresh. Re-runs the §5.1 cascade with
 * cache bypass, broadcasts `contestants_refreshed` so all clients reload,
 * and returns the fresh list. Owner-only, lobby-only.
 *
 * Note: server-side rate limit (1 per 30 s per room, per spec) is *not*
 * enforced here — the LobbyView button enforces a UI-side cooldown which
 * is sufficient for the single-admin lobby surface. A persistent rate
 * limit would require a `rooms.last_contestant_refresh_at` column; deferred
 * to V2 / R1 (when co-admin support lands).
 */
export async function refreshContestants(
  input: RefreshContestantsInput,
  deps: RefreshContestantsDeps,
): Promise<RefreshContestantsResult> {
  if (typeof input.roomId !== "string" || !UUID_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID.", 400, "roomId");
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return fail(
      "INVALID_USER_ID",
      "userId must be a non-empty string.",
      400,
      "userId",
    );
  }
  const roomId = input.roomId;
  const userId = input.userId;

  const roomQuery = await deps.supabase
    .from("rooms")
    .select("id, status, owner_user_id, year, event")
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const row = roomQuery.data as {
    id: string;
    status: string;
    owner_user_id: string;
    year: number;
    event: EventType;
  };

  if (row.owner_user_id !== userId) {
    return fail(
      "FORBIDDEN",
      "Only the room owner can refresh contestants.",
      403,
    );
  }

  if (row.status !== "lobby") {
    return fail(
      "ROOM_NOT_IN_LOBBY",
      "Contestants can only be refreshed while the room is in the lobby.",
      409,
    );
  }

  let contestants: Contestant[];
  try {
    contestants = await deps.fetchContestants(row.year, row.event, {
      bypassCache: true,
    });
  } catch (err) {
    console.warn(
      `refreshContestants fetch failed for room ${roomId} (${row.year}/${row.event}):`,
      err,
    );
    return fail(
      "INTERNAL_ERROR",
      "Could not load contestants from the upstream source.",
      500,
    );
  }

  try {
    await deps.broadcastRoomEvent(roomId, { type: "contestants_refreshed" });
  } catch (err) {
    console.warn(
      `broadcast 'contestants_refreshed' failed for room ${roomId}; refresh succeeded regardless:`,
      err,
    );
  }

  return { ok: true, contestants };
}
