import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isSupportedLocale,
  type SupportedLocale,
} from "@/i18n/config";

export default getRequestConfig(async () => {
  const raw = cookies().get(LOCALE_COOKIE)?.value;
  const locale: SupportedLocale = isSupportedLocale(raw) ? raw : DEFAULT_LOCALE;
  const messages = (await import(`@/locales/${locale}.json`)).default;
  return { locale, messages };
});
