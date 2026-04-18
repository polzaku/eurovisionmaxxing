import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { onboardUser } from "@/lib/auth/onboard";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

const BCRYPT_ROUNDS = 10;

/**
 * POST /api/auth/onboard
 * Create a new user and return { userId, rejoinToken, displayName, avatarSeed }.
 * The plaintext rejoinToken is returned to the client only here; only the bcrypt
 * hash is persisted.
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

  const result = await onboardUser(body as { displayName: unknown; avatarSeed: unknown }, {
    supabase: createServiceClient(),
    hashToken: (plaintext) => bcrypt.hash(plaintext, BCRYPT_ROUNDS),
    generateUserId: uuidv4,
    generateRejoinToken: uuidv4,
  });

  if (result.ok) {
    return NextResponse.json(result.user, { status: 201 });
  }
  return apiError(result.error.code, result.error.message, result.status, result.error.field);
}
