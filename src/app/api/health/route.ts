import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 * Lightweight health check — runs a trivial Supabase query so that
 * uptime monitors (e.g. UptimeRobot) keep the free-tier project awake.
 */
export async function GET() {
  const supabase = createServiceClient();
  const { error } = await supabase.from("rooms").select("id").limit(1);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true });
}