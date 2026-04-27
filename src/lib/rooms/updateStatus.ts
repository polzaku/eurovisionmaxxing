import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Room } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";
import { mapRoom, type RoomEventPayload } from "@/lib/rooms/shared";

export interface UpdateStatusInput {
  roomId: unknown;
  status: unknown;
  userId: unknown;
}

export interface UpdateStatusDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
  /** Injected for tests; defaults to `() => new Date()`. */
  now?: () => Date;
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
  "voting_ending",
  "done",
]);

const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  lobby: ["voting"],
  voting: ["voting_ending"],
  voting_ending: ["voting"],
  announcing: ["done"],
};

/** SPEC §6.3.1: 5-second undo window. */
const VOTING_ENDING_WINDOW_MS = 5000;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string
): UpdateStatusFailure {
  return { ok: false, error: field ? { code, message, field } : { code, message }, status };
}

type RoomRow = Database["public"]["Tables"]["rooms"]["Row"];

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
      "status must be one of 'voting', 'voting_ending', or 'done'.",
      400,
      "status"
    );
  }
  const roomId = input.roomId;
  const userId = input.userId;
  const status = input.status;
  const now = deps.now ? deps.now() : new Date();

  const roomQuery = await deps.supabase
    .from("rooms")
    .select("id, status, owner_user_id, voting_ends_at")
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const row = roomQuery.data as {
    id: string;
    status: string;
    owner_user_id: string;
    voting_ends_at: string | null;
  };

  if (row.owner_user_id !== userId) {
    return fail(
      "FORBIDDEN",
      "Only the room owner can change the room's status.",
      403
    );
  }

  const allowed = ALLOWED_TRANSITIONS[row.status] ?? [];
  if (!allowed.includes(status)) {
    return fail(
      "INVALID_TRANSITION",
      `Cannot transition from '${row.status}' to '${status}'.`,
      409
    );
  }

  // Special-case: undo voting_ending → voting only allowed before deadline.
  if (row.status === "voting_ending" && status === "voting") {
    if (!row.voting_ends_at || Date.parse(row.voting_ends_at) <= now.getTime()) {
      return fail(
        "INVALID_TRANSITION",
        "Undo window has already elapsed.",
        409
      );
    }
  }

  // Build the patch + broadcast.
  type RoomUpdate = Database["public"]["Tables"]["rooms"]["Update"];
  let patch: RoomUpdate;
  let broadcast: RoomEventPayload;
  if (row.status === "voting" && status === "voting_ending") {
    const votingEndsAt = new Date(now.getTime() + VOTING_ENDING_WINDOW_MS).toISOString();
    patch = { status, voting_ends_at: votingEndsAt };
    broadcast = { type: "voting_ending", votingEndsAt };
  } else if (row.status === "voting_ending" && status === "voting") {
    patch = { status, voting_ends_at: null };
    broadcast = { type: "status_changed", status };
  } else {
    patch = { status };
    broadcast = { type: "status_changed", status };
  }

  const updateResult = await deps.supabase
    .from("rooms")
    .update(patch)
    .eq("id", roomId)
    .select()
    .single();

  if (updateResult.error || !updateResult.data) {
    return fail("INTERNAL_ERROR", "Could not update room. Please try again.", 500);
  }

  try {
    await deps.broadcastRoomEvent(roomId, broadcast);
  } catch (err) {
    console.warn(
      `broadcast failed for room ${roomId}; state committed regardless:`,
      err
    );
  }

  return { ok: true, room: mapRoom(updateResult.data as RoomRow) };
}
