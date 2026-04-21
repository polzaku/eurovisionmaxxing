import { NextRequest, NextResponse } from "next/server";
import { runScoring } from "@/lib/rooms/runScoring";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { fetchContestants } from "@/lib/contestants";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/rooms/{id}/score
 * Body: { userId: string }
 * Admin-only. Triggers SPEC §9 scoring pipeline; transitions the room
 * `voting → scoring → announcing`.
 * Returns 200 { leaderboard } on success.
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
  const result = await runScoring(
    { roomId: params.id, userId: input.userId },
    {
      supabase: createServiceClient(),
      fetchContestants,
      broadcastRoomEvent: defaultBroadcastRoomEvent,
    },
  );

  if (result.ok) {
    return NextResponse.json({ leaderboard: result.leaderboard }, { status: 200 });
  }
  return apiError(
    result.error.code,
    result.error.message,
    result.status,
    result.error.field,
  );
}
