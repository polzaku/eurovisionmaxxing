import { NextRequest, NextResponse } from "next/server";
import { loadOwnPoints } from "@/lib/rooms/loadOwnPoints";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/rooms/{id}/own-points
 * Body: { userId: string }
 *
 * Returns the calling user's per-contestant Eurovision points + hot
 * takes, when room status is `announcing` or `done`. SPEC §3.2 of
 * Phase 5c.1 spec — used by InstantAnnouncingView.
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
  const result = await loadOwnPoints(
    { roomId: params.id, userId: input.userId },
    { supabase: createServiceClient() },
  );

  if (result.ok) {
    return NextResponse.json({ entries: result.entries }, { status: 200 });
  }
  return apiError(
    result.error.code,
    result.error.message,
    result.status,
    result.error.field,
  );
}
