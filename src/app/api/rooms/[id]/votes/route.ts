import { NextRequest, NextResponse } from "next/server";
import { upsertVote } from "@/lib/votes/upsert";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/rooms/{id}/votes
 * Body: {
 *   userId: string,
 *   contestantId: string,
 *   scores?: { [categoryName: string]: number },
 *   missed?: boolean,
 *   hotTake?: string | null
 * }
 * Returns 200 { vote, scoredCount } on success. See
 * docs/superpowers/specs/2026-04-21-votes-upsert-design.md for semantics.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
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
    contestantId?: unknown;
    scores?: unknown;
    missed?: unknown;
    hotTake?: unknown;
  };

  const result = await upsertVote(
    {
      roomId: params.id,
      userId: input.userId,
      contestantId: input.contestantId,
      scores: input.scores,
      missed: input.missed,
      hotTake: input.hotTake,
    },
    {
      supabase: createServiceClient(),
      broadcastRoomEvent: defaultBroadcastRoomEvent,
    }
  );

  if (result.ok) {
    return NextResponse.json(
      { vote: result.vote, scoredCount: result.scoredCount },
      { status: 200 }
    );
  }
  return apiError(
    result.error.code,
    result.error.message,
    result.status,
    result.error.field
  );
}
