import { NextRequest, NextResponse } from "next/server";
import { markReady } from "@/lib/rooms/markReady";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/rooms/{id}/ready
 * Body: { userId: string }
 *
 * User marks themselves ready in instant-mode announcing rooms.
 * Idempotent. SPEC §10.1.
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
  const result = await markReady(
    { roomId: params.id, userId: input.userId },
    {
      supabase: createServiceClient(),
      broadcastRoomEvent: defaultBroadcastRoomEvent,
    },
  );

  if (result.ok) {
    return NextResponse.json(
      {
        readyAt: result.readyAt,
        readyCount: result.readyCount,
        totalCount: result.totalCount,
      },
      { status: 200 },
    );
  }
  return apiError(
    result.error.code,
    result.error.message,
    result.status,
    result.error.field,
  );
}
