import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface RestoreSkippedInput {
  roomId: unknown;
  /** Caller's user id (must be the room owner per §6.7 in MVP). */
  userId: unknown;
  /** The user being restored (previously skipped). */
  restoreUserId: unknown;
}

export interface RestoreSkippedDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (
    roomId: string,
    event: RoomEventPayload,
  ) => Promise<void>;
}

export interface RestoreSkippedSuccess {
  ok: true;
  /** UUID of the user restored. */
  restoredUserId: string;
  restoredDisplayName: string;
  /** New announcement order with the restored user spliced in. */
  announcementOrder: string[];
  /** Updated skipped-user list (without the restored user). */
  announceSkippedUserIds: string[];
}

export interface RestoreSkippedFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type RestoreSkippedResult =
  | RestoreSkippedSuccess
  | RestoreSkippedFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): RestoreSkippedFailure {
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
};

/**
 * SPEC §10.2.1 — admin reverses a manual skip and gives the user
 * their dramatic reveal back. Companion to `skipAnnouncer.ts`
 * (PR #56).
 *
 * Mechanics per the spec ("re-inserts them after the current
 * announcer and clears the skip"):
 *
 *   1. Validate caller is room owner.
 *   2. Validate room is `announcing` (skip/restore is meaningless
 *      otherwise).
 *   3. Validate `restoreUserId` is currently in
 *      `rooms.announce_skipped_user_ids`. Returns 409 USER_NOT_SKIPPED
 *      if not — covers both "never skipped" and "already restored"
 *      cases idempotently.
 *   4. Mark the user's `announced=true` results back to `false` so
 *      the live leaderboard temporarily drops their points and the
 *      reveal sequence can replay them dramatically when the rotation
 *      reaches them. (Without this, the reveal queue would be empty
 *      when their turn starts and the rotation would skip them again.)
 *   5. Splice the user into `announcement_order` at
 *      `indexOf(announcing_user_id) + 1` so they get the next turn
 *      after the current announcer finishes.
 *   6. Remove from `announce_skipped_user_ids`.
 *   7. Persist via a single UPDATE conditioned on the read-time
 *      `announce_skipped_user_ids` to guard against concurrent
 *      restore + skip races (Supabase doesn't support full row-version
 *      compare-and-swap, but the array equality check is sufficient
 *      for the tiny window admin actions fight over).
 *   8. Broadcast `announce_skip_restored` so subscribers can drop the
 *      "skipped" marker from their roster panel without a refetch.
 *
 * Out of scope:
 *   - Co-admin authorisation (R1).
 *   - Restoring a user during `done` status (rejected as
 *     ROOM_NOT_ANNOUNCING; the show is over).
 *   - Restoring a user who never had any `points_awarded > 0` rows
 *     (rare degenerate case; the splice still happens but their
 *     reveal queue is empty and the rotation moves past them
 *     immediately — acceptable).
 */
export async function restoreSkipped(
  input: RestoreSkippedInput,
  deps: RestoreSkippedDeps,
): Promise<RestoreSkippedResult> {
  // ─── Input validation ────────────────────────────────────────────────────
  if (typeof input.roomId !== "string" || !UUID_REGEX.test(input.roomId)) {
    return fail("INVALID_ROOM_ID", "roomId must be a UUID.", 400, "roomId");
  }
  if (typeof input.userId !== "string" || !UUID_REGEX.test(input.userId)) {
    return fail(
      "INVALID_USER_ID",
      "userId must be a UUID.",
      400,
      "userId",
    );
  }
  if (
    typeof input.restoreUserId !== "string" ||
    !UUID_REGEX.test(input.restoreUserId)
  ) {
    return fail(
      "INVALID_USER_ID",
      "restoreUserId must be a UUID.",
      400,
      "restoreUserId",
    );
  }

  const roomId = input.roomId;
  const callerId = input.userId;
  const restoreUserId = input.restoreUserId;

  // ─── Load room ──────────────────────────────────────────────────────────
  const roomQuery = await deps.supabase
    .from("rooms")
    .select(
      "id, status, owner_user_id, announcement_order, announcing_user_id, announce_skipped_user_ids",
    )
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const room = roomQuery.data as RoomRow;

  // ─── Status guard ───────────────────────────────────────────────────────
  if (room.status !== "announcing") {
    return fail(
      "ROOM_NOT_ANNOUNCING",
      "Restore is only available while the room is announcing.",
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
      "No active announcer to anchor the restore against.",
      409,
    );
  }

  // ─── Owner-only authorization ───────────────────────────────────────────
  if (callerId !== room.owner_user_id) {
    return fail(
      "FORBIDDEN",
      "Only the room owner can restore a skipped announcer.",
      403,
    );
  }

  // ─── Skip-list membership check ─────────────────────────────────────────
  const skippedList = room.announce_skipped_user_ids ?? [];
  if (!skippedList.includes(restoreUserId)) {
    return fail(
      "USER_NOT_SKIPPED",
      "That user isn't in the skipped list — nothing to restore.",
      409,
      "restoreUserId",
    );
  }

  // ─── Look up display name (forwarded into the broadcast) ────────────────
  const userQuery = await deps.supabase
    .from("users")
    .select("display_name")
    .eq("id", restoreUserId)
    .maybeSingle();

  if (userQuery.error || !userQuery.data) {
    return fail("INTERNAL_ERROR", "Could not read restored user.", 500);
  }
  const restoredDisplayName = (userQuery.data as { display_name: string })
    .display_name;

  // ─── Un-mark results so reveals can fire dramatically ───────────────────
  // Only flip rows with points_awarded > 0 — those are the ones the
  // reveal queue iterates. Rows with 0 points are leaderboard noise
  // and shouldn't drive the reveal sequence.
  const unmarkResults = await deps.supabase
    .from("results")
    .update({ announced: false })
    .eq("room_id", roomId)
    .eq("user_id", restoreUserId)
    .gt("points_awarded", 0);

  if (unmarkResults.error) {
    return fail(
      "INTERNAL_ERROR",
      "Could not un-mark restored user's results.",
      500,
    );
  }

  // ─── Splice into announcement_order at currentIdx+1 ─────────────────────
  const currentIdx = room.announcement_order.indexOf(room.announcing_user_id);
  // Defensive: if announcing_user_id isn't in the order somehow (shouldn't
  // happen in practice), splice at the end — they get a turn last.
  const insertAt = currentIdx >= 0 ? currentIdx + 1 : room.announcement_order.length;
  const nextOrder = [
    ...room.announcement_order.slice(0, insertAt),
    restoreUserId,
    ...room.announcement_order.slice(insertAt),
  ];

  // ─── Remove from skipped list ───────────────────────────────────────────
  const nextSkipped = skippedList.filter((u) => u !== restoreUserId);

  // ─── Conditional UPDATE (compare-and-swap on skipped list) ──────────────
  const updateResult = await deps.supabase
    .from("rooms")
    .update({
      announcement_order: nextOrder,
      announce_skipped_user_ids: nextSkipped,
    })
    .eq("id", roomId)
    .eq("status", "announcing")
    .contains("announce_skipped_user_ids", [restoreUserId])
    .select("id")
    .maybeSingle();

  if (updateResult.error) {
    return fail(
      "INTERNAL_ERROR",
      "Could not persist the restore. Please try again.",
      500,
    );
  }
  if (!updateResult.data) {
    // Race: someone else (probably another admin) restored or skipped
    // between our read and our write. Surface as 409 so the caller
    // can retry / refresh.
    return fail(
      "USER_NOT_SKIPPED",
      "The skipped list changed concurrently. Please refresh and try again.",
      409,
      "restoreUserId",
    );
  }

  // ─── Broadcast ──────────────────────────────────────────────────────────
  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "announce_skip_restored",
      userId: restoreUserId,
      displayName: restoredDisplayName,
    });
  } catch (err) {
    console.warn(
      `broadcast 'announce_skip_restored' failed for room ${roomId}; restore committed regardless:`,
      err,
    );
  }

  return {
    ok: true,
    restoredUserId: restoreUserId,
    restoredDisplayName,
    announcementOrder: nextOrder,
    announceSkippedUserIds: nextSkipped,
  };
}
