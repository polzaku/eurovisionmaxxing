import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/rooms/{id}/votes
 * Upsert a user's vote for a contestant.
 *
 * Body: { userId, contestantId, scores, missed, hotTake }
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
