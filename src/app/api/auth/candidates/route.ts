import { NextRequest, NextResponse } from "next/server";
import { listCandidates } from "@/lib/auth/candidates";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/auth/candidates
 * Body: { displayName: string, roomId: string }
 * Returns: 200 { candidates: Array<{ userId, avatarSeed }> } — possibly empty.
 * Pre-flight for the same-name rejoin flow (SPEC §4.3). No writes.
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

  const result = await listCandidates(
    body as { displayName: unknown; roomId: unknown },
    { supabase: createServiceClient() },
  );

  if (result.ok) {
    return NextResponse.json({ candidates: result.candidates }, { status: 200 });
  }
  return apiError(result.error.code, result.error.message, result.status, result.error.field);
}
