import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { createRoom } from "@/lib/rooms/create";
import { generatePin } from "@/lib/pin";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/rooms
 * Create a new room.
 *
 * Body: { year, event, categories, announcementMode, allowNowPerforming, userId }
 * Returns 201 with { room } on success.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_BODY", "Request body must be valid JSON.", 400);
  }

  if (typeof body !== "object" || body === null) {
    return apiError("INVALID_BODY", "Request body must be a JSON object.", 400);
  }

  const result = await createRoom(body as Parameters<typeof createRoom>[0], {
    supabase: createServiceClient(),
    generateRoomId: uuidv4,
    generatePin,
  });

  if (result.ok) {
    return NextResponse.json({ room: result.room }, { status: 201 });
  }
  return apiError(result.error.code, result.error.message, result.status, result.error.field);
}
