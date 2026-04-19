import { NextRequest, NextResponse } from "next/server";
import { getRoom } from "@/lib/rooms/get";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchContestants } from "@/lib/contestants";

/**
 * GET /api/rooms/{id}
 * Return the room, its memberships (with display_name + avatar_seed) and
 * the resolved contestant list for the room's year/event.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const result = await getRoom(
    { roomId: params.id },
    {
      supabase: createServiceClient(),
      fetchContestants,
    }
  );

  if (result.ok) {
    return NextResponse.json(result.data, { status: 200 });
  }
  return apiError(result.error.code, result.error.message, result.status, result.error.field);
}
