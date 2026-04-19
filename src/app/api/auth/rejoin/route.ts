import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { rejoinUser } from "@/lib/auth/rejoin";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/auth/rejoin
 * Validate a returning user's rejoin token and refresh last_seen_at.
 * Body: { userId: string, rejoinToken: string, roomId?: string }
 * Returns: 200 { userId, displayName, avatarSeed } on success.
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

  const result = await rejoinUser(
    body as { userId: unknown; rejoinToken: unknown; roomId?: unknown },
    {
      supabase: createServiceClient(),
      compareToken: (plaintext, hash) => bcrypt.compare(plaintext, hash),
      now: () => new Date().toISOString(),
    }
  );

  if (result.ok) {
    return NextResponse.json(result.user, { status: 200 });
  }
  return apiError(result.error.code, result.error.message, result.status, result.error.field);
}
