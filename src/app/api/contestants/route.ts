import { NextRequest, NextResponse } from "next/server";
import { fetchContestants, ContestDataError } from "@/lib/contestants";
import type { EventType } from "@/types";

/**
 * GET /api/contestants?year=2026&event=final
 * Fetch contestants with cascade (API → hardcoded JSON fallback).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") ?? String(new Date().getFullYear()));
  const event = (searchParams.get("event") ?? "final") as EventType;

  if (!["semi1", "semi2", "final"].includes(event)) {
    return NextResponse.json(
      { error: "Invalid event type. Must be semi1, semi2, or final." },
      { status: 400 }
    );
  }

  try {
    const contestants = await fetchContestants(year, event);
    return NextResponse.json({ contestants, source: "api_or_fallback" });
  } catch (err) {
    if (err instanceof ContestDataError) {
      return NextResponse.json(
        { error: err.message },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: "Failed to fetch contestants" },
      { status: 500 }
    );
  }
}
