import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface DeleteHotTakeInput {
  /** Room id (UUID) — from the URL. */
  roomId: unknown;
  /** Caller's user id (must be the room owner per §6.7 in MVP). */
  userId: unknown;
  /** The contestant whose hot-take is being deleted. */
  contestantId: unknown;
  /** The author of the hot-take being deleted (i.e. who wrote it). */
  targetUserId: unknown;
}

export interface DeleteHotTakeDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (
    roomId: string,
    event: RoomEventPayload,
  ) => Promise<void>;
}

export interface DeleteHotTakeSuccess {
  ok: true;
  /** True iff a row was modified (false when nothing was there to delete). */
  deleted: boolean;
}

export interface DeleteHotTakeFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type DeleteHotTakeResult =
  | DeleteHotTakeSuccess
  | DeleteHotTakeFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTESTANT_ID_REGEX = /^\d{4}-[a-z]{2}$/;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): DeleteHotTakeFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

/**
 * SPEC §8.7.2 — admin-driven hot-take deletion.
 *
 * Owner of the room (or co-admin per §6.7, post-R1) can delete any
 * user's hot-take at any room status. Deletion is silent (no
 * notification to the author per the spec's "they won't be notified"
 * directive). The row's other fields (scores, missed, points) are
 * preserved.
 *
 * MVP scope:
 *   - Owner-only authorization (co-admin support lands with R1).
 *   - Admin-side only — author self-deletion via clearing the textarea
 *     in `<HotTakeField>` already routes through `upsertVote` and
 *     covers the §8.7.2 author trash-icon use case approximately.
 *     A dedicated author trash icon on the voting card stays open.
 *   - Allowed during voting / voting_ending / scoring / announcing /
 *     done (per spec — moderation needs to work at any point). Status
 *     check enforces room exists; specific status gates would tighten
 *     against accidental misuse but no UX surface today drives them.
 *   - Broadcasts a `hot_take_deleted` event so live results / drawer
 *     surfaces can drop the deleted take without a refetch.
 *
 * Records the admin who performed the deletion in
 * `votes.hot_take_deleted_by_user_id` + a timestamp. Sets `hot_take`
 * and `hot_take_edited_at` to NULL (matches the §8.7.1 / §8.7.2
 * post-deletion shape).
 */
export async function deleteHotTake(
  input: DeleteHotTakeInput,
  deps: DeleteHotTakeDeps,
): Promise<DeleteHotTakeResult> {
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
    typeof input.targetUserId !== "string" ||
    !UUID_REGEX.test(input.targetUserId)
  ) {
    return fail(
      "INVALID_USER_ID",
      "targetUserId must be a UUID.",
      400,
      "targetUserId",
    );
  }
  if (
    typeof input.contestantId !== "string" ||
    !CONTESTANT_ID_REGEX.test(input.contestantId)
  ) {
    return fail(
      "INVALID_CONTESTANT_ID",
      "contestantId must look like '{year}-{countryCode}' (e.g. '2026-gb').",
      400,
      "contestantId",
    );
  }

  const roomId = input.roomId;
  const userId = input.userId;
  const targetUserId = input.targetUserId;
  const contestantId = input.contestantId;

  // ─── Room + admin-auth check ────────────────────────────────────────────
  const roomQuery = await deps.supabase
    .from("rooms")
    .select("id, owner_user_id")
    .eq("id", roomId)
    .maybeSingle();

  if (roomQuery.error || !roomQuery.data) {
    return fail("ROOM_NOT_FOUND", "Room not found.", 404);
  }
  const room = roomQuery.data as { id: string; owner_user_id: string };

  if (room.owner_user_id !== userId) {
    return fail(
      "FORBIDDEN",
      "Only the room owner can delete other users' hot-takes.",
      403,
    );
  }

  // ─── Update the vote row ────────────────────────────────────────────────
  // Idempotent — if no row exists or hot_take is already null, the
  // UPDATE affects 0 rows (we report deleted=false).
  const updateResult = await deps.supabase
    .from("votes")
    .update({
      hot_take: null,
      hot_take_edited_at: null,
      hot_take_deleted_by_user_id: userId,
      hot_take_deleted_at: new Date().toISOString(),
    })
    .eq("room_id", roomId)
    .eq("user_id", targetUserId)
    .eq("contestant_id", contestantId)
    .not("hot_take", "is", null)
    .select("user_id")
    .maybeSingle();

  if (updateResult.error) {
    return fail(
      "INTERNAL_ERROR",
      "Could not delete hot-take. Please try again.",
      500,
    );
  }

  const deleted = !!updateResult.data;

  if (deleted) {
    try {
      await deps.broadcastRoomEvent(roomId, {
        type: "hot_take_deleted",
        userId: targetUserId,
        contestantId,
        deletedByUserId: userId,
      });
    } catch (err) {
      console.warn(
        `broadcast 'hot_take_deleted' failed for room ${roomId}; deletion committed regardless:`,
        err,
      );
    }
  }

  return { ok: true, deleted };
}
