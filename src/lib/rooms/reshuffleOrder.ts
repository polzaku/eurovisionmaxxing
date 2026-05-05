import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface ReshuffleOrderInput {
  roomId: unknown;
  /** Caller's user id (must be the room owner per §6.7 in MVP). */
  userId: unknown;
}

export interface ReshuffleOrderDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (
    roomId: string,
    event: RoomEventPayload,
  ) => Promise<void>;
  /**
   * Optional shuffle hook so tests can inject a deterministic permutation.
   * Defaults to Fisher-Yates over Math.random().
   */
  shuffle?: <T>(arr: T[]) => T[];
}

export interface ReshuffleOrderSuccess {
  ok: true;
  /** New shuffled announcement_order. */
  announcementOrder: string[];
  /** First entry of the new order — the user up next. */
  announcingUserId: string;
}

export interface ReshuffleOrderFailure {
  ok: false;
  error: { code: ApiErrorCode; message: string; field?: string };
  status: number;
}

export type ReshuffleOrderResult =
  | ReshuffleOrderSuccess
  | ReshuffleOrderFailure;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  field?: string,
): ReshuffleOrderFailure {
  return {
    ok: false,
    error: field ? { code, message, field } : { code, message },
    status,
  };
}

function defaultShuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

type RoomRow = {
  id: string;
  status: string;
  owner_user_id: string;
  announcement_order: string[] | null;
  announcing_user_id: string | null;
  current_announce_idx: number | null;
};

/**
 * SPEC §10.2.1 — admin re-shuffles `rooms.announcement_order` before any
 * point has been revealed. Use case: admin sees an unfortunate draw
 * (quiet user first, party host last) and wants a different permutation
 * before the show starts.
 *
 * Hard gate: NO `results.announced=true` rows exist yet. Once any
 * announce_next has fired (even one point of one user), the order
 * becomes load-bearing narrative — re-shuffling mid-show would rewrite
 * history. The button surfacing this orchestrator must render only
 * before the first reveal.
 *
 * MVP scope:
 *   - Owner-only authorization (co-admin lands with R1).
 *   - Status === announcing (the order is meaningless before scoring;
 *     reshuffling at lobby would just be confusing).
 *   - Deterministic-friendly: `deps.shuffle` overridable for tests.
 *   - Broadcasts `announcement_order_reshuffled` so subscribers refresh
 *     the roster's order.
 */
export async function reshuffleOrder(
  input: ReshuffleOrderInput,
  deps: ReshuffleOrderDeps,
): Promise<ReshuffleOrderResult> {
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

  const roomId = input.roomId;
  const callerId = input.userId;

  // ─── Load room ──────────────────────────────────────────────────────────
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

  // ─── Guards ─────────────────────────────────────────────────────────────
  if (room.status !== "announcing") {
    return fail(
      "ROOM_NOT_ANNOUNCING",
      "Reshuffle is only available while the room is announcing.",
      409,
    );
  }
  if (callerId !== room.owner_user_id) {
    return fail(
      "FORBIDDEN",
      "Only the room owner can reshuffle the announcement order.",
      403,
    );
  }
  if (
    !room.announcement_order ||
    room.announcement_order.length === 0
  ) {
    return fail(
      "ROOM_NOT_ANNOUNCING",
      "No announcement order to reshuffle.",
      409,
    );
  }

  // ─── Hard gate: no point may have been announced yet ────────────────────
  // Once even one results.announced=true exists, reshuffling rewrites
  // narrative history. The TODO line 267 spec wording: "disabled once
  // any advance has happened".
  const { count: announcedCount, error: countErr } = await deps.supabase
    .from("results")
    .select("user_id", { count: "exact", head: true })
    .eq("room_id", roomId)
    .eq("announced", true);

  if (countErr) {
    return fail(
      "INTERNAL_ERROR",
      "Could not check announce progress.",
      500,
    );
  }
  if ((announcedCount ?? 0) > 0) {
    return fail(
      "ANNOUNCE_IN_PROGRESS",
      "Reshuffle is disabled once any point has been revealed.",
      409,
    );
  }

  // ─── Shuffle + persist ──────────────────────────────────────────────────
  const shuffle = deps.shuffle ?? defaultShuffle;
  const nextOrder = shuffle(room.announcement_order);
  const nextAnnouncingUserId = nextOrder[0];

  // Conditional UPDATE on (status, current_announce_idx === 0) — guards
  // against a race where another admin advanced between our count check
  // and our write. Belt and braces.
  const updateResult = await deps.supabase
    .from("rooms")
    .update({
      announcement_order: nextOrder,
      announcing_user_id: nextAnnouncingUserId,
      current_announce_idx: 0,
    })
    .eq("id", roomId)
    .eq("status", "announcing")
    .eq("current_announce_idx", 0)
    .select("id")
    .maybeSingle();

  if (updateResult.error) {
    return fail(
      "INTERNAL_ERROR",
      "Could not persist the reshuffle. Please try again.",
      500,
    );
  }
  if (!updateResult.data) {
    return fail(
      "ANNOUNCE_IN_PROGRESS",
      "The announcement progressed concurrently. Please refresh and try again.",
      409,
    );
  }

  // ─── Broadcast ──────────────────────────────────────────────────────────
  try {
    await deps.broadcastRoomEvent(roomId, {
      type: "announcement_order_reshuffled",
      announcementOrder: nextOrder,
      announcingUserId: nextAnnouncingUserId,
    });
  } catch (err) {
    console.warn(
      `broadcast 'announcement_order_reshuffled' failed for room ${roomId}; reshuffle committed regardless:`,
      err,
    );
  }

  return {
    ok: true,
    announcementOrder: nextOrder,
    announcingUserId: nextAnnouncingUserId,
  };
}
