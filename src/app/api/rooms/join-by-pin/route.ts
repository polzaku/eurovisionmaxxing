import { NextRequest, NextResponse } from "next/server";
import { joinByPin } from "@/lib/rooms/joinByPin";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/rooms/join-by-pin
 * Body: { pin: string, userId: string }
 * Returns 200 { roomId } on success.
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

  const result = await joinByPin(body as Parameters<typeof joinByPin>[0], {
    supabase: createServiceClient(),
  });

  if (result.ok) {
    return NextResponse.json({ roomId: result.roomId }, { status: 200 });
  }
  return apiError(result.error.code, result.error.message, result.status, result.error.field);
}
