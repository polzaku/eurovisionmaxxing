import { NextRequest, NextResponse } from "next/server";
import { finishTheShow } from "@/lib/rooms/finishTheShow";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/rooms/{id}/finish-show
 * Body: { userId }
 *
 * Owner-only. Validates the room is in cascade-exhaust state
 * (status='announcing', announcing_user_id=null, batch_reveal_mode=false),
 * picks the first user in announce_skipped_user_ids with any
 * announced=false results, sets them as the active announcer with
 * batch_reveal_mode=true, and broadcasts batch_reveal_started.
 */
export async function POST(
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
  const result = await finishTheShow(
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
