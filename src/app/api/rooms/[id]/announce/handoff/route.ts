import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/rooms/{id}/announce/handoff
 * Admin takes over for a user.
 *
 * Body: { adminUserId, targetUserId }
 *
 * TODO: Implement
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return NextResponse.json(
    { error: "Not implemented" },
    { status: 501 }
  );
}
