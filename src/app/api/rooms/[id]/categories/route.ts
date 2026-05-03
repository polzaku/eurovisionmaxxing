import { NextRequest, NextResponse } from "next/server";
import { updateRoomCategories } from "@/lib/rooms/updateRoomCategories";
import { defaultBroadcastRoomEvent } from "@/lib/rooms/shared";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * PATCH /api/rooms/{id}/categories
 * Body: { categories: VotingCategory[], userId: string }
 * Returns 200 { room } on success.
 *
 * SPEC §6.1 / TODO A2 — owner-only, lobby-only swap of the room's
 * categories array (template change or custom). Year + event remain
 * immutable per spec. Validation matches the room-creation path
 * exactly (shared `validateCategories` helper).
 */
export async function PATCH(
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

  const input = body as { categories?: unknown; userId?: unknown };
  const result = await updateRoomCategories(
    {
      roomId: params.id,
      userId: input.userId,
      categories: input.categories,
    },
    {
      supabase: createServiceClient(),
      broadcastRoomEvent: defaultBroadcastRoomEvent,
    },
  );

  if (result.ok) {
    return NextResponse.json({ room: result.room }, { status: 200 });
  }
  return apiError(
    result.error.code,
    result.error.message,
    result.status,
    result.error.field,
  );
}
