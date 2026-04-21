import { NextRequest, NextResponse } from "next/server";
import { updateRoomNowPerforming } from "@/lib/rooms/updateNowPerforming";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * PATCH /api/rooms/{id}/now-performing
 * Body: { contestantId: string, userId: string }
 * Returns 200 { room } on success.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_BODY", "Request body must be valid JSON.", 400);
  }
  if (typeof body !== "object" || body === null) {
    return apiError("INVALID_BODY", "Request body must be a JSON object.", 400);
  }

  const input = body as { contestantId?: unknown; userId?: unknown };
  const result = await updateRoomNowPerforming(
    {
      roomId: params.id,
      contestantId: input.contestantId,
      userId: input.userId,
    },
    {
      supabase: createServiceClient(),
      broadcastRoomEvent: defaultBroadcastRoomEvent,
    }
  );

  if (result.ok) {
    return NextResponse.json({ room: result.room }, { status: 200 });
  }
  return apiError(result.error.code, result.error.message, result.status, result.error.field);
}
