import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Room, AnnouncementStyle } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";
import { mapRoom, type RoomEventPayload } from "@/lib/rooms/shared";

export type AnnouncementMode = "live" | "instant";

export interface UpdateAnnouncementModeInput {
  roomId: unknown;
  userId: unknown;
  mode: unknown;
  /** Optional style patch (SPEC §10.2.2). Mode stays required; style is optional. */
  style?: unknown;
}

export interface UpdateAnnouncementModeDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (
    roomId: string,
    event: RoomEventPayload,
  ) => Promise<void>;
}

export interface UpdateAnnouncementModeSuccess {
  ok: true;
  room: Room;
}

export interface UpdateAnnouncementModeFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type UpdateAnnouncementModeResult =
  | UpdateAnnouncementModeSuccess
  | UpdateAnnouncementModeFailure;

type RoomRow = Database["public"]["Tables"]["rooms"]["Row"];

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): UpdateAnnouncementModeFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

/**
 * SPEC §6.1 / TODO A2 — owner can switch announcement_mode while the room
 * is still in the lobby (no announcement state machine running yet).
 * Year + event remain immutable; categories edits are deferred to V1.1.
 *
 * Now also accepts an optional `style` patch (SPEC §10.2.2). Mode stays
 * required for backwards compatibility; style is purely additive.
 *
 * No new RoomEvent variant — clients react via the existing
 * `status_changed` refetch path on next load. (Mode change in lobby is
 * a low-frequency event; broadcasting status_changed forces a clean
 * refetch and keeps the wire-protocol surface tight.)
 */
export async function updateAnnouncementMode(
  input: UpdateAnnouncementModeInput,
  deps: UpdateAnnouncementModeDeps,
): Promise<UpdateAnnouncementModeResult> {
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
  if (input.mode !== "live" && input.mode !== "instant") {
    return fail(
      "INVALID_ANNOUNCEMENT_MODE",
      "mode must be 'live' or 'instant'.",
      400,
      "mode",
    );
  }

  if (
    input.style !== undefined &&
    (typeof input.style !== "string" || (input.style !== "full" && input.style !== "short"))
  ) {
    return fail(
      "INVALID_ANNOUNCEMENT_STYLE",
      "announcementStyle must be one of full, short.",
      400,
      "style",
    );
  }

  const roomId = input.roomId;
  const userId = input.userId;
  const mode = input.mode as AnnouncementMode;

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
      "Only the room owner can change announcement mode.",
      403,
    );
  }

  if (row.status !== "lobby") {
    return fail(
      "ROOM_NOT_IN_LOBBY",
      "Announcement mode can only be changed while the room is in the lobby.",
      409,
    );
  }

  const updatePatch: { announcement_mode: AnnouncementMode; announcement_style?: AnnouncementStyle } = {
    announcement_mode: mode,
  };
  if (input.style !== undefined) {
    updatePatch.announcement_style = input.style as AnnouncementStyle;
  }

  const updateResult = await deps.supabase
    .from("rooms")
    .update(updatePatch)
    .eq("id", roomId)
    .select()
    .single();

  if (updateResult.error || !updateResult.data) {
    return fail(
      "INTERNAL_ERROR",
      "Could not update room. Please try again.",
      500,
    );
  }

  // Reuse the status_changed broadcast as a 'reload your room state' signal.
  // The status hasn't actually changed; the client just needs to refetch
  // to pick up the new announcement_mode.
  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "status_changed",
      status: row.status,
    });
  } catch (err) {
    console.warn(
      `broadcast 'status_changed' failed for room ${roomId} after mode change; state committed regardless:`,
      err,
    );
  }

  return { ok: true, room: mapRoom(updateResult.data as RoomRow) };
}
