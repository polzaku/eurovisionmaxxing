import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";
import { isAbsent } from "@/lib/rooms/isAbsent";
import { applySingleSkip } from "@/lib/rooms/applySingleSkip";

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
  now?: () => Date;
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
  cascadeExhausted: boolean;
  cascadedSkippedUserIds: string[];
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
  delegate_user_id: string | null;
  announce_skipped_user_ids: string[] | null;
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
 *   At rotation time, each candidate's `room_memberships.last_seen_at` is
 *   checked via `isAbsent`. Absent users are accumulated and skipped until
 *   a present user is found or the order exhausts (SPEC §10.2.1).
 * - Otherwise the room transitions to `done`.
 *
 * The optional `nowOverride` parameter is for deterministic testing; pass
 * `undefined` (or omit) in production.
 */
export async function advanceAnnouncement(
  input: AdvanceAnnouncementInput,
  deps: AdvanceAnnouncementDeps,
  nowOverride?: Date,
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
      "id, status, owner_user_id, announcement_order, announcing_user_id, current_announce_idx, delegate_user_id, announce_skipped_user_ids",
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

  // 3. Authorization: caller is current announcer, delegate, OR owner.
  // The owner always retains the ability to drive (handoff is a UX
  // affordance, not a security boundary).
  const isAnnouncer = userId === currentAnnouncer;
  const isDelegate =
    !!room.delegate_user_id && userId === room.delegate_user_id;
  const isOwner = userId === room.owner_user_id;
  if (!isAnnouncer && !isDelegate && !isOwner) {
    return fail(
      "FORBIDDEN",
      "Only the current announcer, the delegate, or the room owner can advance the reveal.",
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
  let cascadeExhausted = false;
  const cascadedSkippedUserIds: string[] = [];

  if (isLastForAnnouncer) {
    const announcers = room.announcement_order;
    const pos = announcers.indexOf(currentAnnouncer);
    const nextPos = pos + 1;
    if (pos >= 0 && nextPos < announcers.length) {
      // Rotate to the next user — but first cascade-check for absence.
      // Snapshot "now" once so all probes in this call use the same instant.
      const now = nowOverride ?? (deps.now ? deps.now() : new Date());

      let probePos = nextPos;
      let foundPresent = false;

      while (probePos < announcers.length) {
        const candidateId = announcers[probePos];

        // Query this candidate's membership last_seen_at.
        const membershipQuery = await deps.supabase
          .from("room_memberships")
          .select("last_seen_at")
          .eq("room_id", roomId)
          .eq("user_id", candidateId)
          .maybeSingle();

        const lastSeenAt =
          membershipQuery.data?.last_seen_at ?? null;
        const absent = isAbsent(lastSeenAt as string | null, now);

        if (absent) {
          cascadedSkippedUserIds.push(candidateId);
          probePos += 1;
        } else {
          // Present — this is our next announcer.
          nextAnnouncingUserId = candidateId;
          nextIdx = 0;
          foundPresent = true;
          break;
        }
      }

      if (foundPresent) {
        // SPEC §10.2.1 line 967 — silent-mark only when show continues.
        for (const skippedUserId of cascadedSkippedUserIds) {
          const skipResult = await applySingleSkip(
            { roomId, skippedUserId },
            { supabase: deps.supabase },
          );
          if (!skipResult.ok) {
            return fail(skipResult.error.code, skipResult.error.message, 500);
          }
        }
      } else {
        cascadeExhausted = true;
        nextAnnouncingUserId = null;
        nextIdx = 0;
        // SPEC §10.2.1 line 981 — keep pending for batch reveal. No silent-mark.
      }
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
    announce_skipped_user_ids?: string[];
    status?: string;
  } = {
    announcing_user_id: nextAnnouncingUserId,
    current_announce_idx: nextIdx,
  };
  if (finishedShow) roomPatch.status = "done";

  // If the cascade accumulated any skipped users, append them to the existing list.
  if (cascadedSkippedUserIds.length > 0) {
    const prevSkipped = room.announce_skipped_user_ids ?? [];
    const nextSkipped = [
      ...prevSkipped,
      ...cascadedSkippedUserIds.filter((id) => !prevSkipped.includes(id)),
    ];
    roomPatch.announce_skipped_user_ids = nextSkipped;
  }

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

  // After the room UPDATE commits — emit announce_skip broadcasts in cascade order
  // BEFORE announce_next / score_update.
  if (cascadedSkippedUserIds.length > 0) {
    // Bulk-fetch display names.
    const usersQuery = await deps.supabase
      .from("users")
      .select("id, display_name")
      .in("id", cascadedSkippedUserIds);

    const usersData = (usersQuery.data ?? []) as Array<{
      id: string;
      display_name: string;
    }>;
    const nameById = new Map(usersData.map((u) => [u.id, u.display_name]));

    for (const skippedId of cascadedSkippedUserIds) {
      const displayName = nameById.get(skippedId) ?? skippedId;
      try {
        await deps.broadcastRoomEvent(roomId, {
          type: "announce_skip",
          userId: skippedId,
          displayName,
        });
      } catch (err) {
        console.warn(
          `broadcast 'announce_skip' failed for room ${roomId} user ${skippedId}; state committed regardless:`,
          err,
        );
      }
    }
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
    cascadeExhausted,
    cascadedSkippedUserIds,
  };
}
