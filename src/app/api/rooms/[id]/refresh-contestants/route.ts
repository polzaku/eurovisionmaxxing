import { NextRequest, NextResponse } from "next/server";
import { refreshContestants } from "@/lib/rooms/refreshContestants";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchContestants } from "@/lib/contestants";

/**
 * POST /api/rooms/{id}/refresh-contestants
 * Body: { userId: string }
 * Returns 200 { contestants: Contestant[] } on success.
 *
 * SPEC §5.1d — admin-only, lobby-only, broadcasts `contestants_refreshed`
 * so all subscribers reload their contestant view.
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
  if (typeof body !== "object" || body === null) {
    return apiError("INVALID_BODY", "Request body must be a JSON object.", 400);
  }

  const input = body as { userId?: unknown };
  const result = await refreshContestants(
    { roomId: params.id, userId: input.userId },
    {
      supabase: createServiceClient(),
      fetchContestants,
      broadcastRoomEvent: defaultBroadcastRoomEvent,
    },
  );

  if (result.ok) {
    return NextResponse.json(
      { contestants: result.contestants },
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
