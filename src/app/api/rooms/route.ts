import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/rooms
 * Create a new room.
 *
 * Body: { year, event, categories, announcementMode, allowNowPerforming, userId }
 * Returns: { room: { id, pin, ... } }
 *
 * TODO: Implement — generate PIN, check uniqueness, create room, add owner as member
 */
export async function POST(request: NextRequest) {
  return NextResponse.json(
    { error: "Not implemented" },
    { status: 501 }
  );
}
