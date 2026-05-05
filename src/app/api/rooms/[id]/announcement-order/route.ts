import { NextRequest, NextResponse } from "next/server";
import { reshuffleOrder } from "@/lib/rooms/reshuffleOrder";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * PATCH /api/rooms/{id}/announcement-order
 * Body: { userId }
 *
 * SPEC §10.2.1 admin reshuffle of the live-mode announcement order.
 * Owner-only. Re-rolls `rooms.announcement_order` and resets
 * `current_announce_idx` to 0. Hard-gated on no `results.announced=true`
 * rows (i.e. before any point has been revealed) — once any reveal
 * fires, the order becomes load-bearing narrative.
 *
 * Returns 200 { announcementOrder, announcingUserId } on success.
 * 409 ANNOUNCE_IN_PROGRESS once the gate has closed.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_BODY", "Request body must be valid JSON.", 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return apiError("INVALID_BODY", "Request body must be a JSON object.", 400);
  }

  const input = body as { userId?: unknown };
  const result = await reshuffleOrder(
    { roomId: params.id, userId: input.userId },
    {
      supabase: createServiceClient(),
      broadcastRoomEvent: defaultBroadcastRoomEvent,
    },
  );

  if (result.ok) {
    const { ok: _ok, ...payload } = result;
    return NextResponse.json(payload, { status: 200 });
  }
  return apiError(
    result.error.code,
    result.error.message,
    result.status,
    result.error.field,
  );
}
