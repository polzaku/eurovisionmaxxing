import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/auth/onboard
 * Create new user, return userId + rejoinToken.
 *
 * Body: { displayName: string, avatarSeed: string }
 * Returns: { userId, rejoinToken, displayName, avatarSeed }
 *
 * TODO: Implement — hash rejoinToken with bcrypt, store user in DB
 */
export async function POST(request: NextRequest) {
  // TODO: Implementation
  return NextResponse.json(
    { error: "Not implemented" },
    { status: 501 }
  );
}
