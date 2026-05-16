import { NextRequest, NextResponse } from "next/server";
import { startAnnouncing } from "@/lib/rooms/startAnnouncing";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/rooms/{id}/start-announcing
 * Body: { userId }
 *
 * TODO #10 slice B — owner advances from the `calibration` review phase
 * to `announcing`. Idempotent under concurrent calls via the status='calibration'
 * guard in the UPDATE.
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
  const result = await startAnnouncing(
    { roomId: params.id, userId: input.userId },
    {
      supabase: createServiceClient(),
      broadcastRoomEvent: defaultBroadcastRoomEvent,
    },
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
