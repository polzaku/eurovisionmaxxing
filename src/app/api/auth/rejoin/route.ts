import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/auth/rejoin
 * Validate rejoinToken, return session.
 *
 * Body: { userId: string, rejoinToken: string, roomId?: string }
 * Returns: { valid: boolean, userId, displayName, avatarSeed }
 *
 * TODO: Implement — bcrypt compare token, refresh session expiry
 */
export async function POST(request: NextRequest) {
  return NextResponse.json(
    { error: "Not implemented" },
    { status: 501 }
  );
}
