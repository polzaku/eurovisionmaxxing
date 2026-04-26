import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface AdvanceAnnouncementInput {
  roomId: unknown;
  userId: unknown;
}

export interface AdvanceAnnouncementDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (
    roomId: string,
    event: RoomEventPayload,
  ) => Promise<void>;
}

export interface AdvanceAnnouncementSuccess {
  ok: true;
  contestantId: string;
  points: number;
  announcingUserId: string;
  newTotal: number;
  newRank: number;
  nextAnnouncingUserId: string | null;
  finished: boolean;
}

export interface AdvanceAnnouncementFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type AdvanceAnnouncementResult =
  | AdvanceAnnouncementSuccess
  | AdvanceAnnouncementFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): AdvanceAnnouncementFailure {
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
};

type AnnouncerResultRow = {
  contestant_id: string;
  points_awarded: number;
  rank: number;
  announced: boolean;
};

type LeaderboardRow = {
  contestant_id: string;
  points_awarded: number;
  announced: boolean;
};

/**
 * Advance the live-mode announcement pointer by one reveal (SPEC §10.2).
 *
 * Server is authoritative: the caller (current announcer or room owner)
 * triggers an advance, the server marks the corresponding `results.announced`
 * row, mutates the room state, and broadcasts. Conditional UPDATEs on
 * `(announcing_user_id, current_announce_idx)` make the operation safe
 * against concurrent callers — a raced advance returns 409 `ANNOUNCE_RACED`.
 *
 * When the current announcer's last point is revealed:
 * - If another user remains in `announcement_order`, the pointer rotates
 *   to them with `current_announce_idx = 0`.
 * - Otherwise the room transitions to `done`.
 */
export async function advanceAnnouncement(
  input: AdvanceAnnouncementInput,
  deps: AdvanceAnnouncementDeps,
): Promise<AdvanceAnnouncementResult> {
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

  // 1. Load room state.
  const roomQuery = await deps.supabase
    .from("rooms")
    .select(
      "id, status, owner_user_id, announcement_order, announcing_user_id, current_announce_idx",
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
      "Reveals are only available while the room is announcing.",
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
      "No active announcer to advance.",
      409,
    );
  }

  const expectedIdx = room.current_announce_idx ?? 0;
  const currentAnnouncer = room.announcing_user_id;

  // 3. Authorization: caller is current announcer OR owner.
  if (userId !== currentAnnouncer && userId !== room.owner_user_id) {
    return fail(
      "FORBIDDEN",
      "Only the current announcer or the room owner can advance the reveal.",
      403,
    );
  }

  // 4. Load the announcer's eligible (point-awarding) results, ordered so
  // that index 0 is the lowest-points pick (rank-10 → 1pt, rank-9 → 2pts,
  // … rank-1 → 12pts). For shorter rosters the announcer's reveal queue
  // truncates accordingly.
  const announcerResultsQuery = await deps.supabase
    .from("results")
    .select("contestant_id, points_awarded, rank, announced")
    .eq("room_id", roomId)
    .eq("user_id", currentAnnouncer)
    .gt("points_awarded", 0)
    .order("rank", { ascending: false });

  if (announcerResultsQuery.error) {
    return fail(
      "INTERNAL_ERROR",
      "Could not load reveal queue.",
      500,
    );
  }
  const announcerRows = (announcerResultsQuery.data ??
    []) as AnnouncerResultRow[];

  if (expectedIdx < 0 || expectedIdx >= announcerRows.length) {
    return fail(
      "ANNOUNCE_RACED",
      "The announcement state changed under us. Refresh and try again.",
      409,
    );
  }

  const revealRow = announcerRows[expectedIdx];

  // 5. Mark the chosen results row as announced (idempotent).
  const markAnnounced = await deps.supabase
    .from("results")
    .update({ announced: true })
    .eq("room_id", roomId)
    .eq("user_id", currentAnnouncer)
    .eq("contestant_id", revealRow.contestant_id);

  if (markAnnounced.error) {
    return fail(
      "INTERNAL_ERROR",
      "Could not record the reveal.",
      500,
    );
  }

  // 6. Determine the next state.
  const isLastForAnnouncer = expectedIdx + 1 >= announcerRows.length;
  let nextAnnouncingUserId: string | null = currentAnnouncer;
  let nextIdx = expectedIdx + 1;
  let finishedShow = false;

  if (isLastForAnnouncer) {
    const announcers = room.announcement_order;
    const pos = announcers.indexOf(currentAnnouncer);
    const nextPos = pos + 1;
    if (pos >= 0 && nextPos < announcers.length) {
      nextAnnouncingUserId = announcers[nextPos];
      nextIdx = 0;
    } else {
      nextAnnouncingUserId = null;
      nextIdx = 0;
      finishedShow = true;
    }
  }

  // 7. Conditional UPDATE on the room state. Guards against concurrent calls.
  const roomPatch: {
    announcing_user_id: string | null;
    current_announce_idx: number;
    status?: string;
  } = {
    announcing_user_id: nextAnnouncingUserId,
    current_announce_idx: nextIdx,
  };
  if (finishedShow) roomPatch.status = "done";

  const updateRoom = await deps.supabase
    .from("rooms")
    .update(roomPatch)
    .eq("id", roomId)
    .eq("status", "announcing")
    .eq("announcing_user_id", currentAnnouncer)
    .eq("current_announce_idx", expectedIdx)
    .select("id")
    .maybeSingle();

  if (updateRoom.error) {
    return fail(
      "INTERNAL_ERROR",
      "Could not advance the announcement.",
      500,
    );
  }
  if (!updateRoom.data) {
    return fail(
      "ANNOUNCE_RACED",
      "Another reveal happened first. Refresh and try again.",
      409,
    );
  }

  // 8. Build the broadcast payload from the post-update leaderboard.
  const allResultsQuery = await deps.supabase
    .from("results")
    .select("contestant_id, points_awarded, announced")
    .eq("room_id", roomId);

  let newTotal = revealRow.points_awarded;
  let newRank = 1;
  if (!allResultsQuery.error && allResultsQuery.data) {
    const totals = new Map<string, number>();
    for (const r of allResultsQuery.data as LeaderboardRow[]) {
      if (!r.announced) continue;
      totals.set(
        r.contestant_id,
        (totals.get(r.contestant_id) ?? 0) + r.points_awarded,
      );
    }
    const target = totals.get(revealRow.contestant_id) ?? 0;
    newTotal = target;
    // Competition ranking: count how many distinct totals strictly exceed.
    const distinct = [...totals.values()].sort((a, b) => b - a);
    let rank = 1;
    for (const v of distinct) {
      if (v > target) rank += 1;
      else break;
    }
    newRank = rank;
  }

  // 9. Broadcasts (non-fatal; mirror the rest of the codebase).
  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "announce_next",
      contestantId: revealRow.contestant_id,
      points: revealRow.points_awarded,
      announcingUserId: currentAnnouncer,
    });
  } catch (err) {
    console.warn(
      `broadcast 'announce_next' failed for room ${roomId}; state committed regardless:`,
      err,
    );
  }
  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "score_update",
      contestantId: revealRow.contestant_id,
      newTotal,
      newRank,
    });
  } catch (err) {
    console.warn(
      `broadcast 'score_update' failed for room ${roomId}; state committed regardless:`,
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
    contestantId: revealRow.contestant_id,
    points: revealRow.points_awarded,
    announcingUserId: currentAnnouncer,
    newTotal,
    newRank,
    nextAnnouncingUserId,
    finished: finishedShow,
  };
}
