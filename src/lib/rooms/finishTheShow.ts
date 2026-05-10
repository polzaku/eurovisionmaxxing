import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface FinishTheShowInput {
  roomId: unknown;
  userId: unknown;
}

export interface FinishTheShowDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (roomId: string, event: RoomEventPayload) => Promise<void>;
}

export interface FinishTheShowSuccess {
  ok: true;
  announcingUserId: string;
  displayName: string;
}

export interface FinishTheShowFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type FinishTheShowResult = FinishTheShowSuccess | FinishTheShowFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): FinishTheShowFailure {
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
  announcement_order: string[] | null;
  announcing_user_id: string | null;
  announce_skipped_user_ids: string[] | null;
  batch_reveal_mode: boolean;
};

/**
 * Owner-only "finish the show" action (SPEC §10.2.1 / R4).
 *
 * State guard: status='announcing' AND announcing_user_id=null AND
 * batch_reveal_mode=false. Picks the first user in
 * announce_skipped_user_ids that has any announced=false results.
 * Sets batch_reveal_mode=true, announcing_user_id=that_user,
 * current_announce_idx=0. Broadcasts batch_reveal_started.
 */
export async function finishTheShow(
  input: FinishTheShowInput,
  deps: FinishTheShowDeps,
): Promise<FinishTheShowResult> {
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
  const callerId = input.userId;

  // 1. Load room.
  const roomQuery = await deps.supabase
    .from("rooms")
    .select(
      "id, status, owner_user_id, announcement_order, announcing_user_id, announce_skipped_user_ids, batch_reveal_mode",
    )
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const room = roomQuery.data as RoomRow;

  // 2. Authorization — owner only.
  if (callerId !== room.owner_user_id) {
    return fail(
      "FORBIDDEN",
      "Only the room owner can finish the show.",
      403,
    );
  }

  // 3. State guard — cascade-exhausted state only.
  if (
    room.status !== "announcing" ||
    room.announcing_user_id !== null ||
    room.batch_reveal_mode === true
  ) {
    return fail(
      "NOT_IN_CASCADE_EXHAUST_STATE",
      "Finish the show is only available after the cascade exhausts.",
      409,
    );
  }

  // 4. Find the first skipped user with unrevealed results.
  const skippedIds = room.announce_skipped_user_ids ?? [];
  let firstAnnouncerId: string | null = null;

  for (const skippedId of skippedIds) {
    const pendingResult = await deps.supabase
      .from("results")
      .select("contestant_id")
      .eq("room_id", roomId)
      .eq("user_id", skippedId)
      .eq("announced", false)
      .limit(1)
      .maybeSingle();

    if (pendingResult.error) {
      return fail("INTERNAL_ERROR", "Could not query pending results.", 500);
    }
    if (pendingResult.data) {
      firstAnnouncerId = skippedId;
      break;
    }
  }

  if (firstAnnouncerId === null) {
    return fail(
      "NO_PENDING_REVEALS",
      "No skipped user has unrevealed points.",
      409,
    );
  }

  // 5. Conditional UPDATE — guards against concurrent calls.
  const updateRoom = await deps.supabase
    .from("rooms")
    .update({
      batch_reveal_mode: true,
      announcing_user_id: firstAnnouncerId,
      current_announce_idx: 0,
    })
    .eq("id", roomId)
    .eq("status", "announcing")
    .is("announcing_user_id", null)
    .eq("batch_reveal_mode", false)
    .select("id")
    .maybeSingle();

  if (updateRoom.error) {
    return fail("INTERNAL_ERROR", "Could not enter batch-reveal mode.", 500);
  }
  if (!updateRoom.data) {
    return fail(
      "FINISH_SHOW_RACED",
      "Another change happened first. Refresh and try again.",
      409,
    );
  }

  // 6. Look up the chosen announcer's display name.
  const userQuery = await deps.supabase
    .from("users")
    .select("display_name")
    .eq("id", firstAnnouncerId)
    .maybeSingle();

  const displayName =
    (userQuery.data as { display_name: string } | null)?.display_name ?? "";

  // 7. Broadcast batch_reveal_started (non-fatal).
  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "batch_reveal_started",
      announcingUserId: firstAnnouncerId,
      displayName,
    });
  } catch (err) {
    console.warn(
      `broadcast 'batch_reveal_started' failed for room ${roomId}; state committed regardless:`,
      err,
    );
  }

  return { ok: true, announcingUserId: firstAnnouncerId, displayName };
}
