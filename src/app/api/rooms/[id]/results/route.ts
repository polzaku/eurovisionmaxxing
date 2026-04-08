import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/rooms/{id}/results
 * Get full results (room must be announcing/done).
 *
 * TODO: Implement
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return NextResponse.json(
    { error: "Not implemented" },
    { status: 501 }
  );
}
