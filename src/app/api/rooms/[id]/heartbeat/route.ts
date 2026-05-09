import { NextRequest, NextResponse } from "next/server";
import { recordHeartbeat } from "@/lib/rooms/recordHeartbeat";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * PATCH /api/rooms/{id}/heartbeat
 * Body: { userId }
 *
 * SPEC §10.2.1 — client heartbeat. Updates room_memberships.last_seen_at
 * so the advance-time cascade can decide whether the next announcer is
 * absent. Called by useRoomHeartbeat every 15 s on every mounted
 * <RoomPage> across all room statuses.
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
  const result = await recordHeartbeat(
    { roomId: params.id, userId: input.userId },
    { supabase: createServiceClient() },
  );

  if (result.ok) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }
  return apiError(
    result.error.code,
    result.error.message,
    result.status,
    result.error.field,
  );
}
