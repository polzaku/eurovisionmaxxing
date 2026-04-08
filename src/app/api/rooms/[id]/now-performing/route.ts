import { NextRequest, NextResponse } from "next/server";

/**
 * PATCH /api/rooms/{id}/now-performing
 * Admin: set current performer.
 *
 * Body: { contestantId, userId }
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
