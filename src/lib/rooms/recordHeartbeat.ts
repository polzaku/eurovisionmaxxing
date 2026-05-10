import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";

export interface RecordHeartbeatInput {
  roomId: unknown;
  userId: unknown;
}

export interface RecordHeartbeatDeps {
  supabase: SupabaseClient<Database>;
}

export interface RecordHeartbeatSuccess {
  ok: true;
}

export interface RecordHeartbeatFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type RecordHeartbeatResult =
  | RecordHeartbeatSuccess
  | RecordHeartbeatFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): RecordHeartbeatFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

/**
 * SPEC §10.2.1 — write `room_memberships.last_seen_at = NOW()` for the
 * (roomId, userId) tuple. Called every 15 s by the `useRoomHeartbeat`
 * hook. The advance-time cascade reads this column to decide whether
 * to skip the next announcer.
 *
 * No status guard: heartbeats are accepted in any room status, so the
 * value is fresh at every transition (including the moment
 * `scoring → announcing` flips, when the pre-cascade fires).
 *
 * Membership-required: a non-member writing is a 404. (We don't leak
 * "the room exists but you're not in it" — same convention as the rest
 * of the rooms layer.)
 */
export async function recordHeartbeat(
  input: RecordHeartbeatInput,
  deps: RecordHeartbeatDeps,
): Promise<RecordHeartbeatResult> {
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

  const updateQuery = await deps.supabase
    .from("room_memberships")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("room_id", input.roomId)
    .eq("user_id", input.userId)
    .select("user_id")
    .maybeSingle();

  if (updateQuery.error) {
    return fail("INTERNAL_ERROR", "Could not record heartbeat.", 500);
  }
  if (!updateQuery.data) {
    return fail(
      "ROOM_NOT_FOUND",
      "Room or membership not found.",
      404,
    );
  }

  return { ok: true };
}
