import { NextRequest, NextResponse } from "next/server";
import { loadResults } from "@/lib/results/loadResults";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchContestants, fetchContestantsMeta } from "@/lib/contestants";

/**
 * GET /api/results/{id}
 * Public read-only results. Returns one of five discriminated shapes per
 * SPEC §12.5 — never 404s when the room is valid but pre-`done`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  // TODO #10 (slice A) — `asUser` is a hint for spoiler-gating
  // (`announcerOwnBreakdown`); never used to authorise writes.
  const asUser = request.nextUrl.searchParams.get("asUser") ?? undefined;
  const result = await loadResults(
    { roomId: params.id, callerUserId: asUser },
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
