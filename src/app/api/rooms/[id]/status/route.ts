import { NextRequest, NextResponse } from "next/server";
import { updateRoomStatus, type RoomEventPayload } from "@/lib/rooms/updateStatus";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

async function defaultBroadcastRoomEvent(
  roomId: string,
  event: RoomEventPayload
): Promise<void> {
  const supabase = createServiceClient();
  const channel = supabase.channel(`room:${roomId}`);
  try {
    await channel.send({
      type: "broadcast",
      event: "room_event",
      payload: event,
    });
  } finally {
    await supabase.removeChannel(channel);
  }
}

/**
 * PATCH /api/rooms/{id}/status
 * Body: { status: 'voting' | 'done', userId: string }
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

  const input = body as { status?: unknown; userId?: unknown };
  const result = await updateRoomStatus(
    { roomId: params.id, status: input.status, userId: input.userId },
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
