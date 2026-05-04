import { NextRequest, NextResponse } from "next/server";
import { deleteHotTake } from "@/lib/votes/deleteHotTake";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * DELETE /api/rooms/{id}/votes/{contestantId}/hot-take
 * Body: { userId: string, targetUserId: string }
 *
 * Admin-only. SPEC §8.7.2 — owner of the room (or co-admin per §6.7,
 * post-R1) can delete any user's hot-take at any room status. The
 * `userId` in the body is the caller (admin); `targetUserId` is the
 * author of the hot-take to remove. Returns 200 { deleted: boolean }
 * on success.
 *
 * Auth lives in the orchestrator (`deleteHotTake`) — see
 * `src/lib/votes/deleteHotTake.ts`. Broadcasts `hot_take_deleted` so
 * live results / drawer surfaces can drop the row without a refetch.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; contestantId: string } },
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

  const input = body as {
    userId?: unknown;
    targetUserId?: unknown;
  };

  const result = await deleteHotTake(
    {
      roomId: params.id,
      userId: input.userId,
      contestantId: params.contestantId,
      targetUserId: input.targetUserId,
    },
    {
      supabase: createServiceClient(),
      broadcastRoomEvent: defaultBroadcastRoomEvent,
    },
  );

  if (result.ok) {
    return NextResponse.json({ deleted: result.deleted }, { status: 200 });
  }
  return apiError(
    result.error.code,
    result.error.message,
    result.status,
    result.error.field,
  );
}
