import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { claimIdentity } from "@/lib/auth/claim";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

const BCRYPT_ROUNDS = 10;

/**
 * POST /api/auth/claim
 * Body: { userId: string, roomId: string, displayName: string }
 * Merges the caller into an existing same-name identity in the room:
 * rotates rejoin_token_hash, refreshes last_seen_at, returns a new plaintext
 * rejoin token. (SPEC §4.3 "Different device" branch.)
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

  const result = await claimIdentity(
    body as { userId: unknown; roomId: unknown; displayName: unknown },
    {
      supabase: createServiceClient(),
      hashToken: (plaintext) => bcrypt.hash(plaintext, BCRYPT_ROUNDS),
      generateRejoinToken: uuidv4,
      now: () => new Date().toISOString(),
    },
  );

  if (result.ok) {
    return NextResponse.json(result.user, { status: 200 });
  }
  return apiError(result.error.code, result.error.message, result.status, result.error.field);
}
