import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/rooms/{id}/score
 * Admin: trigger scoring engine.
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
