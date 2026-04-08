import { NextRequest, NextResponse } from "next/server";

/**
 * PATCH /api/rooms/{id}/status
 * Admin: transition room status.
 *
 * Body: { status, userId }
 *
 * TODO: Implement
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return NextResponse.json(
    { error: "Not implemented" },
    { status: 501 }
  );
}
