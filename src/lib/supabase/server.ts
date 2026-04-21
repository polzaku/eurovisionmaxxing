import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Server-side Supabase client using the secret key.
 * Use this in API routes — bypasses RLS.
 *
 * Passes `cache: 'no-store'` to the underlying fetch so Next.js App Router's
 * fetch instrumentation doesn't cache our Postgrest GETs. Without this,
 * reads can return stale values after writes (e.g. a GET /api/rooms/{id}
 * fired just after a PATCH /status can still report the old status).
 */
export function createServiceClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, cache: "no-store" }),
      },
    }
  );
}
