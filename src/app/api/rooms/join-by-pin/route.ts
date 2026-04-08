import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/rooms/join-by-pin
 * Resolve PIN → roomId, add membership.
 *
 * Body: { pin: string, userId: string }
 * Returns: { roomId: string }
 *
 * TODO: Implement — lookup room by PIN, check status, add membership
 */
export async function POST(request: NextRequest) {
  return NextResponse.json(
    { error: "Not implemented" },
    { status: 501 }
  );
}
