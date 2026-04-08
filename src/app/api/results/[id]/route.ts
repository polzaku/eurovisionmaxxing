import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/results/{id}
 * Public read-only results (no auth).
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
