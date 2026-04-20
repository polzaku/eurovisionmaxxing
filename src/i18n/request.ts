import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isSupportedLocale,
  type SupportedLocale,
} from "@/i18n/config";

// requestLocale (X-NEXT-INTL-LOCALE header) is intentionally unused — our middleware
// writes NEXT_LOCALE cookie instead of setting that header. The cookie is the SoT.
export default getRequestConfig(async () => {
  // NOTE: In Next 15, cookies() becomes async → change to: const raw = (await cookies()).get(...)
  const raw = cookies().get(LOCALE_COOKIE)?.value;
  const locale: SupportedLocale = isSupportedLocale(raw) ? raw : DEFAULT_LOCALE;

  // Always load en.json as the base; overlay locale-specific keys on top.
  // This means stub locales (e.g. es.json = {}) transparently fall back to English
  // without surfacing MISSING_MESSAGE errors.
  const enMessages = (await import("@/locales/en.json")).default;
  const localeMessages =
    locale === DEFAULT_LOCALE
      ? enMessages
      : { ...enMessages, ...(await import(`@/locales/${locale}.json`)).default };

  return { locale, messages: localeMessages };
});
