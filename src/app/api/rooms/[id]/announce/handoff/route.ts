import { NextRequest, NextResponse } from "next/server";
import { setDelegate } from "@/lib/rooms/setDelegate";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/rooms/{id}/announce/handoff
 * Body: { userId: string, takeControl: boolean }
 *
 * Owner-only. `takeControl: true` → owner takes over the announcement
 * (delegate_user_id := owner). `takeControl: false` → release back to
 * the original announcer (delegate_user_id := null). SPEC §10.2 step 7.
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

  const input = body as { userId?: unknown; takeControl?: unknown };
  const result = await setDelegate(
    {
      roomId: params.id,
      userId: input.userId,
      takeControl: input.takeControl,
    },
    {
      supabase: createServiceClient(),
      broadcastRoomEvent: defaultBroadcastRoomEvent,
    },
  );

  if (result.ok) {
    return NextResponse.json(
      { delegateUserId: result.delegateUserId },
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
