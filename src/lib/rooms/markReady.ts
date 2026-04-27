import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ApiErrorCode } from "@/lib/api-errors";
import type { RoomEventPayload } from "@/lib/rooms/shared";

export interface MarkReadyInput {
  roomId: unknown;
  userId: unknown;
}

export interface MarkReadyDeps {
  supabase: SupabaseClient<Database>;
  broadcastRoomEvent: (
    roomId: string,
    event: RoomEventPayload,
  ) => Promise<void>;
}

export interface MarkReadySuccess {
  ok: true;
  readyAt: string;
  readyCount: number;
  totalCount: number;
}

export interface MarkReadyFailure {
  ok: false;
  status: number;
  error: { code: ApiErrorCode; message: string; field?: string };
}

export type MarkReadyResult = MarkReadySuccess | MarkReadyFailure;

export async function markReady(
  input: MarkReadyInput,
  deps: MarkReadyDeps,
): Promise<MarkReadyResult> {
  const { roomId, userId } = input;
  if (typeof roomId !== "string" || roomId.length === 0) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "INVALID_BODY",
        message: "roomId must be a non-empty string.",
        field: "roomId",
      },
    };
  }
  if (typeof userId !== "string" || userId.length === 0) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "INVALID_BODY",
        message: "userId must be a non-empty string.",
        field: "userId",
      },
    };
  }

  const { supabase, broadcastRoomEvent } = deps;

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, status, announcement_mode")
    .eq("id", roomId)
    .single();

  if (roomError || !room) {
    return {
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND", message: "Room not found." },
    };
  }

  if (room.announcement_mode !== "instant") {
    return {
      ok: false,
      status: 409,
      error: {
        code: "ROOM_NOT_INSTANT",
        message: "Ready toggle is only available in instant-mode rooms.",
      },
    };
  }

  if (room.status !== "announcing") {
    return {
      ok: false,
      status: 409,
      error: {
        code: "ROOM_NOT_ANNOUNCING",
        message: "Ready toggle is only available during announcing.",
      },
    };
  }

  // Fetch existing membership (also serves as auth — no row → 403).
  const { data: existing, error: membershipError } = await supabase
    .from("room_memberships")
    .select("is_ready, ready_at")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .single();

  if (membershipError || !existing) {
    return {
      ok: false,
      status: 403,
      error: {
        code: "ROOM_NOT_FOUND",
        message: "You are not a member of this room.",
      },
    };
  }

  let readyAt: string;
  let didTransition = false;
  if (existing.is_ready && existing.ready_at) {
    readyAt = existing.ready_at;
  } else {
    const newReadyAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("room_memberships")
      .update({ is_ready: true, ready_at: newReadyAt })
      .eq("room_id", roomId)
      .eq("user_id", userId)
      .select("ready_at")
      .single();
    if (updateError || !updated) {
      return {
        ok: false,
        status: 500,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to mark membership ready.",
        },
      };
    }
    readyAt = updated.ready_at ?? newReadyAt;
    didTransition = true;
  }

  // Recount.
  const { data: rows, error: countError } = await supabase
    .from("room_memberships")
    .select("is_ready")
    .eq("room_id", roomId);
  if (countError || !rows) {
    return {
      ok: false,
      status: 500,
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to recount memberships.",
      },
    };
  }
  const readyCount = rows.filter((r) => r.is_ready).length;
  const totalCount = rows.length;

  if (didTransition) {
    await broadcastRoomEvent(roomId, {
      type: "member_ready",
      userId,
      readyAt,
      readyCount,
      totalCount,
    });
  }

  return { ok: true, readyAt, readyCount, totalCount };
}
