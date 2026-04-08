import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/rooms/{id}
 * Get room state.
 *
 * TODO: Implement — fetch room + members + contestants
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
