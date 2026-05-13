import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { loadResults } from "@/lib/results/loadResults";
import { apiError } from "@/lib/api-errors";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchContestants, fetchContestantsMeta } from "@/lib/contestants";
import { buildResultsHtml } from "@/lib/export/buildResultsHtml";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isSupportedLocale,
} from "@/i18n/config";

const APP_HOSTNAME =
  process.env.NEXT_PUBLIC_APP_HOSTNAME ?? "eurovisionmaxxing.com";

function resolveLocale(): string {
  const raw = cookies().get(LOCALE_COOKIE)?.value;
  return isSupportedLocale(raw) ? raw : DEFAULT_LOCALE;
}

/**
 * GET /api/results/{id}/export.html
 *
 * Self-contained HTML export per SPEC §12.3. Requires rooms.status='done';
 * returns 409 RESULTS_NOT_READY for any earlier status.
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

  if (!result.ok) {
    return apiError(
      result.error.code,
      result.error.message,
      result.status,
      result.error.field,
    );
  }
  if (result.data.status !== "done") {
    return apiError("RESULTS_NOT_READY", "Results not ready.", 409);
  }

  const locale = resolveLocale();
  const t = await getTranslations({ locale, namespace: "export" });

  const { html, filename, bytes } = buildResultsHtml(result.data, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    t: (key, params) => t(key, params as any),
    now: () => new Date(),
    appHostname: APP_HOSTNAME,
  });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "public, max-age=300",
      "X-Content-Bytes": String(bytes),
    },
  });
}
