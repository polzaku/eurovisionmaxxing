import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Room } from "@/types";
import type { ApiErrorCode } from "@/lib/api-errors";
import { mapRoom, type RoomEventPayload } from "@/lib/rooms/shared";
import { validateCategories } from "@/lib/rooms/validateCategories";

export interface UpdateRoomCategoriesInput {
  roomId: unknown;
  userId: unknown;
  categories: unknown;
}

export interface UpdateRoomCategoriesDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (
    roomId: string,
    event: RoomEventPayload,
  ) => Promise<void>;
}

export interface UpdateRoomCategoriesSuccess {
  ok: true;
  room: Room;
}

export interface UpdateRoomCategoriesFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type UpdateRoomCategoriesResult =
  | UpdateRoomCategoriesSuccess
  | UpdateRoomCategoriesFailure;

type RoomRow = Database["public"]["Tables"]["rooms"]["Row"];

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): UpdateRoomCategoriesFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

/**
 * SPEC §6.1 / TODO A2 — owner can swap the room's category template
 * (or pass a fully custom array) while still in the lobby. Year +
 * event remain immutable per spec; this is the categories-edit half
 * of A2 (announcement-mode-edit shipped in PR #66).
 *
 * Reuses `validateCategories` so the validation is identical to the
 * room-creation path. Owner-only, lobby-only.
 *
 * No new RoomEvent variant — reuses `status_changed` as a "reload your
 * room state" signal so subscribers refetch on next render.
 */
export async function updateRoomCategories(
  input: UpdateRoomCategoriesInput,
  deps: UpdateRoomCategoriesDeps,
): Promise<UpdateRoomCategoriesResult> {
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

  const catResult = validateCategories(input.categories);
  if (!catResult.ok) {
    return fail(catResult.code, catResult.message, catResult.status, catResult.field);
  }

  const roomId = input.roomId;
  const userId = input.userId;
  const normalized = catResult.normalized;

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
      "Only the room owner can edit categories.",
      403,
    );
  }

  if (row.status !== "lobby") {
    return fail(
      "ROOM_NOT_IN_LOBBY",
      "Categories can only be edited while the room is in the lobby.",
      409,
    );
  }

  const updateResult = await deps.supabase
    .from("rooms")
    .update({ categories: normalized })
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
  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "status_changed",
      status: row.status,
    });
  } catch (err) {
    console.warn(
      `broadcast 'status_changed' failed for room ${roomId} after categories edit; state committed regardless:`,
      err,
    );
  }

  return { ok: true, room: mapRoom(updateResult.data as RoomRow) };
}
