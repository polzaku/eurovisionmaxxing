import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";
import { applySingleSkip } from "@/lib/rooms/applySingleSkip";

export interface SkipAnnouncerInput {
  roomId: unknown;
  userId: unknown;
}

export interface SkipAnnouncerDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (
    roomId: string,
    event: RoomEventPayload,
  ) => Promise<void>;
}

export interface SkipAnnouncerSuccess {
  ok: true;
  /** UUID of the user who was skipped. */
  skippedUserId: string;
  /** Display name of the skipped user (forwarded into the broadcast). */
  skippedDisplayName: string;
  /** Next announcer in the rotation, or null if the show is finishing. */
  nextAnnouncingUserId: string | null;
  finished: boolean;
}

export interface SkipAnnouncerFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type SkipAnnouncerResult =
  | SkipAnnouncerSuccess
  | SkipAnnouncerFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): SkipAnnouncerFailure {
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
  current_announce_idx: number | null;
  announce_skipped_user_ids: string[] | null;
};

/**
 * Admin-driven skip of the current announcer (SPEC §10.2.1). Used when an
 * announcer is absent at their turn — the admin keeps the show moving by
 * advancing past them. The skipped user's points are silently marked
 * `announced = true` so the live leaderboard reflects them, but the
 * dramatic per-point reveal is suppressed (per spec — points are not
 * revealed in MVP for skipped users).
 *
 * MVP scope:
 *   - Owner-only authorization (co-admin / delegate skip lands later
 *     with the rest of R1 / R4 follow-ups).
 *   - No automatic presence detection — the admin uses their judgment.
 *   - No restore / reshuffle / batch-reveal modes.
 *   - The skipped user's id is appended to `rooms.announce_skipped_user_ids`
 *     so future iterations can render a "skipped" tag in the roster panel.
 */
export async function skipAnnouncer(
  input: SkipAnnouncerInput,
  deps: SkipAnnouncerDeps,
): Promise<SkipAnnouncerResult> {
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
      "id, status, owner_user_id, announcement_order, announcing_user_id, current_announce_idx, announce_skipped_user_ids",
    )
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const room = roomQuery.data as RoomRow;

  // 2. Status guard.
  if (room.status !== "announcing") {
    return fail(
      "ROOM_NOT_ANNOUNCING",
      "Skip is only available while the room is announcing.",
      409,
    );
  }
  if (
    !room.announcement_order ||
    room.announcement_order.length === 0 ||
    !room.announcing_user_id
  ) {
    return fail(
      "ROOM_NOT_ANNOUNCING",
      "No active announcer to skip.",
      409,
    );
  }

  // 3. Owner-only authorization.
  if (callerId !== room.owner_user_id) {
    return fail(
      "FORBIDDEN",
      "Only the room owner can skip an absent announcer.",
      403,
    );
  }

  const skippedUserId = room.announcing_user_id;
  const expectedIdx = room.current_announce_idx ?? 0;

  // 4. Look up the skipped user's display name (forwarded into the broadcast
  // so clients can render "{name} isn't here — their points are skipped").
  const userQuery = await deps.supabase
    .from("users")
    .select("display_name")
    .eq("id", skippedUserId)
    .maybeSingle();

  if (userQuery.error || !userQuery.data) {
    return fail("INTERNAL_ERROR", "Could not read skipped user.", 500);
  }
  const skippedDisplayName = (userQuery.data as { display_name: string })
    .display_name;

  // 5. Determine next announcer (advance past current in the order).
  const announcers = room.announcement_order;
  const pos = announcers.indexOf(skippedUserId);
  const nextPos = pos + 1;
  let nextAnnouncingUserId: string | null = null;
  let finishedShow = false;
  if (pos >= 0 && nextPos < announcers.length) {
    nextAnnouncingUserId = announcers[nextPos];
  } else {
    finishedShow = true;
  }

  // 6. Mark all of the skipped user's not-yet-announced results as
  // announced so the live leaderboard reflects their points immediately.
  const skipResult = await applySingleSkip(
    { roomId, skippedUserId },
    { supabase: deps.supabase },
  );
  if (!skipResult.ok) {
    return fail(skipResult.error.code, skipResult.error.message, 500);
  }

  // 7. Conditional UPDATE on the room state. Guards against concurrent calls.
  const prevSkipped = room.announce_skipped_user_ids ?? [];
  const nextSkipped = prevSkipped.includes(skippedUserId)
    ? prevSkipped
    : [...prevSkipped, skippedUserId];
  const roomPatch: {
    announcing_user_id: string | null;
    current_announce_idx: number;
    announce_skipped_user_ids: string[];
    status?: string;
  } = {
    announcing_user_id: nextAnnouncingUserId,
    current_announce_idx: 0,
    announce_skipped_user_ids: nextSkipped,
  };
  if (finishedShow) roomPatch.status = "done";

  const updateRoom = await deps.supabase
    .from("rooms")
    .update(roomPatch)
    .eq("id", roomId)
    .eq("status", "announcing")
    .eq("announcing_user_id", skippedUserId)
    .eq("current_announce_idx", expectedIdx)
    .select("id")
    .maybeSingle();

  if (updateRoom.error) {
    return fail("INTERNAL_ERROR", "Could not advance the announcement.", 500);
  }
  if (!updateRoom.data) {
    return fail(
      "ANNOUNCE_RACED",
      "Another change happened first. Refresh and try again.",
      409,
    );
  }

  // 8. Broadcasts (non-fatal).
  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "announce_skip",
      userId: skippedUserId,
      displayName: skippedDisplayName,
    });
  } catch (err) {
    console.warn(
      `broadcast 'announce_skip' failed for room ${roomId}; state committed regardless:`,
      err,
    );
  }
  if (finishedShow) {
    try {
      await deps.broadcastRoomEvent(roomId, {
        type: "status_changed",
        status: "done",
      });
    } catch (err) {
      console.warn(
        `broadcast 'status_changed:done' failed for room ${roomId}; state committed regardless:`,
        err,
      );
    }
  }

  return {
    ok: true,
    skippedUserId,
    skippedDisplayName,
    nextAnnouncingUserId,
    finished: finishedShow,
  };
}
