import { NextRequest, NextResponse } from "next/server";
import { skipAnnouncer } from "@/lib/rooms/skipAnnouncer";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/rooms/{id}/announce/skip
 * Body: { userId }
 *
 * SPEC §10.2.1 admin-driven absent-announcer skip. Owner-only. The
 * skipped user's points are silently marked `announced = true` so the
 * live leaderboard reflects them, the announcement pointer advances
 * past them, and an `announce_skip` event is broadcast on the channel.
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
  const result = await skipAnnouncer(
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
