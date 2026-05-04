import { NextRequest, NextResponse } from "next/server";
import { restoreSkipped } from "@/lib/rooms/restoreSkipped";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/rooms/{id}/announce/restore
 * Body: { userId, restoreUserId }
 *
 * SPEC §10.2.1 admin restore of a previously-skipped announcer.
 * Owner-only. Re-inserts `restoreUserId` into `announcement_order`
 * after the current announcer, removes them from
 * `announce_skipped_user_ids`, and un-marks their `announced=true`
 * results so the dramatic reveal can replay when the rotation
 * reaches them. Broadcasts `announce_skip_restored`.
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

  const input = body as { userId?: unknown; restoreUserId?: unknown };
  const result = await restoreSkipped(
    {
      roomId: params.id,
      userId: input.userId,
      restoreUserId: input.restoreUserId,
    },
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
