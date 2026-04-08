import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/rooms/{id}/join
 * Add user to room.
 *
 * Body: { userId }
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
