import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isSupportedLocale,
  type SupportedLocale,
} from "@/i18n/config";
import enMessages from "@/locales/en.json";

export function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = result[key];
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      existing !== null &&
      typeof existing === "object" &&
      !Array.isArray(existing)
    ) {
      result[key] = deepMerge(
        existing as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

// requestLocale (X-NEXT-INTL-LOCALE header) is intentionally unused — our middleware
// writes NEXT_LOCALE cookie instead of setting that header. The cookie is the SoT.
export default getRequestConfig(async () => {
  // NOTE: In Next 15, cookies() becomes async → change to: const raw = (await cookies()).get(...)
  const raw = cookies().get(LOCALE_COOKIE)?.value;
  const locale: SupportedLocale = isSupportedLocale(raw) ? raw : DEFAULT_LOCALE;

  // Always merge the requested locale on top of en so partial translations
  // don't surface MISSING_MESSAGE errors. en is the canonical fallback per SPEC §21.1.
  if (locale === DEFAULT_LOCALE) {
    return { locale, messages: enMessages };
  }
  const overlay = (await import(`@/locales/${locale}.json`)).default as Record<
    string,
    unknown
  >;
  const messages = deepMerge(
    enMessages as Record<string, unknown>,
    overlay,
  ) as typeof enMessages;
  return { locale, messages };
});
