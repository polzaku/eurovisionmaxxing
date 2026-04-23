import { NextRequest, NextResponse } from "next/server";
import { loadResults } from "@/lib/results/loadResults";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchContestants, fetchContestantsMeta } from "@/lib/contestants";

/**
 * GET /api/rooms/{id}/results
 * In-room read of the results surface. Same payload as `/api/results/{id}`
 * for 5a; the path exists as its own route so a future admin/announcer view
 * can diverge without touching the public share URL.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const result = await loadResults(
    { roomId: params.id },
    {
      supabase: createServiceClient(),
      fetchContestants,
      fetchContestantsMeta,
    },
  );

  if (result.ok) {
    return NextResponse.json(result.data, { status: 200 });
  }
  return apiError(
    result.error.code,
    result.error.message,
    result.status,
    result.error.field,
  );
}
