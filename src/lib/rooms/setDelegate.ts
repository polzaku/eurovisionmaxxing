import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface SetDelegateInput {
  roomId: unknown;
  userId: unknown;
  /**
   * `true` → the room owner takes control (delegate_user_id := owner).
   * `false` → release back to the original announcer (delegate_user_id := null).
   */
  takeControl: unknown;
}

export interface SetDelegateDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (
    roomId: string,
    event: RoomEventPayload,
  ) => Promise<void>;
}

export interface SetDelegateSuccess {
  ok: true;
  delegateUserId: string | null;
}

export interface SetDelegateFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type SetDelegateResult = SetDelegateSuccess | SetDelegateFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): SetDelegateFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

type RoomRow = {
  id: string;
  status: string;
  owner_user_id: string;
  announcing_user_id: string | null;
};

/**
 * Toggle the admin handoff for the live announce flow (SPEC §10.2 step 7).
 *
 * - `takeControl: true` → owner takes over, `delegate_user_id := owner`.
 *   Future `advanceAnnouncement` calls accept the owner as authorised.
 *   Spec semantics: the points being revealed still belong to
 *   `announcing_user_id`; the admin is just driving on their behalf.
 * - `takeControl: false` → release, `delegate_user_id := null`.
 *
 * Only the room owner can toggle. Only valid while the room is announcing.
 * Broadcasts `status_changed:announcing` to nudge clients to refetch the
 * announcement state (where the new `delegateUserId` is exposed).
 */
export async function setDelegate(
  input: SetDelegateInput,
  deps: SetDelegateDeps,
): Promise<SetDelegateResult> {
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
  if (typeof input.takeControl !== "boolean") {
    return fail(
      "INVALID_BODY",
      "takeControl must be a boolean.",
      400,
      "takeControl",
    );
  }
  const roomId = input.roomId;
  const userId = input.userId;
  const takeControl = input.takeControl;

  const roomQuery = await deps.supabase
    .from("rooms")
    .select("id, status, owner_user_id, announcing_user_id")
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const room = roomQuery.data as RoomRow;

  if (room.owner_user_id !== userId) {
    return fail(
      "FORBIDDEN",
      "Only the room owner can take or release announcer control.",
      403,
    );
  }

  if (room.status !== "announcing") {
    return fail(
      "ROOM_NOT_ANNOUNCING",
      "Handoff is only available while the room is announcing.",
      409,
    );
  }

  const newDelegate = takeControl ? room.owner_user_id : null;

  const update = await deps.supabase
    .from("rooms")
    .update({ delegate_user_id: newDelegate })
    .eq("id", roomId)
    .eq("status", "announcing")
    .select("id")
    .maybeSingle();

  if (update.error || !update.data) {
    return fail("INTERNAL_ERROR", "Could not update handoff.", 500);
  }

  // Re-broadcast `status_changed:announcing` as a cheap "refetch nudge" —
  // clients reload the announcement state and see the new `delegateUserId`.
  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "status_changed",
      status: "announcing",
    });
  } catch (err) {
    console.warn(
      `broadcast 'status_changed:announcing' (handoff) failed for room ${roomId}; state committed regardless:`,
      err,
    );
  }

  return { ok: true, delegateUserId: newDelegate };
}
