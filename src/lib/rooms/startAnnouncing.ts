import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface StartAnnouncingInput {
  roomId: unknown;
  userId: unknown;
}

export interface StartAnnouncingDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (
    roomId: string,
    event: RoomEventPayload,
  ) => Promise<void>;
}

export interface StartAnnouncingSuccess {
  ok: true;
}

export interface StartAnnouncingFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type StartAnnouncingResult =
  | StartAnnouncingSuccess
  | StartAnnouncingFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): StartAnnouncingFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

/**
 * TODO #10 slice B — transitions a room from `calibration` to
 * `announcing`. Owner-only. The calibration phase is a pre-announce
 * review where every member peeks at their own 1→12 picks; the owner
 * triggers this once the room is ready to see the reveals play out.
 *
 * State writes are minimal — the announcement_order, first announcer,
 * and (for short style) the auto-batched lower reveals were all
 * prepared by `runScoring` before the calibration transition. This
 * function just flips the status flag and broadcasts a status_changed
 * event so every client transitions out of CalibrationView at the
 * same moment.
 */
export async function startAnnouncing(
  input: StartAnnouncingInput,
  deps: StartAnnouncingDeps,
): Promise<StartAnnouncingResult> {
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
    .select("id, status, owner_user_id")
    .eq("id", roomId)
    .maybeSingle();
  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const room = roomQuery.data as {
    id: string;
    status: string;
    owner_user_id: string | null;
  };

  if (room.owner_user_id !== userId) {
    return fail(
      "FORBIDDEN",
      "Only the room owner can start announcements.",
      403,
    );
  }

  if (room.status !== "calibration") {
    return fail(
      "ROOM_NOT_CALIBRATING",
      `Cannot start announcements when the room is '${room.status}'.`,
      409,
    );
  }

  const update = await deps.supabase
    .from("rooms")
    .update({ status: "announcing" })
    .eq("id", roomId)
    .eq("status", "calibration") // guard against concurrent transitions
    .select("id")
    .maybeSingle();

  if (update.error || !update.data) {
    return fail(
      "INTERNAL_ERROR",
      "Could not transition room to announcing.",
      500,
    );
  }

  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "status_changed",
      status: "announcing",
    });
  } catch (err) {
    console.warn(
      `broadcast 'status_changed' failed for room ${roomId}; state committed regardless:`,
      err,
    );
  }

  return { ok: true };
}
