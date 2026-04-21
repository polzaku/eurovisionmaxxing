export const SUPPORTED_LOCALES = ["en", "es", "uk", "fr", "de"] as const;

export const DEFAULT_LOCALE: SupportedLocale = "en";

export const LOCALE_COOKIE = "NEXT_LOCALE";
export const LOCALE_STORAGE_KEY = "emx_locale";

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}
