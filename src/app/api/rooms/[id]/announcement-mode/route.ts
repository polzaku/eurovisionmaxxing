import { NextRequest, NextResponse } from "next/server";
import { updateAnnouncementMode } from "@/lib/rooms/updateAnnouncementMode";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * PATCH /api/rooms/{id}/announcement-mode
 * Body: { mode: "live" | "instant", userId: string }
 * Returns 200 { room } on success.
 *
 * SPEC §6.1 / TODO A2 — owner-only, lobby-only switch of the room's
 * announcement mode while still in setup. Year + event remain immutable;
 * categories edits deferred to V1.1.
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
  if (typeof body !== "object" || body === null) {
    return apiError("INVALID_BODY", "Request body must be a JSON object.", 400);
  }

  const input = body as { mode?: unknown; userId?: unknown };
  const result = await updateAnnouncementMode(
    { roomId: params.id, userId: input.userId, mode: input.mode },
    {
      supabase: createServiceClient(),
      broadcastRoomEvent: defaultBroadcastRoomEvent,
    },
  );

  if (result.ok) {
    return NextResponse.json({ room: result.room }, { status: 200 });
  }
  return apiError(
    result.error.code,
    result.error.message,
    result.status,
    result.error.field,
  );
}
