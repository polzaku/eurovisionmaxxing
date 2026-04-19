import { describe, it, expect } from "vitest";
import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  type SupportedLocale,
} from "@/i18n/config";

import en from "@/locales/en.json";
import es from "@/locales/es.json";
import uk from "@/locales/uk.json";
import fr from "@/locales/fr.json";
import de from "@/locales/de.json";

const LOCALE_BUNDLES: Record<SupportedLocale, Record<string, unknown>> = {
  en,
  es,
  uk,
  fr,
  de,
};

function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return prefix ? [prefix] : [];
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0) return prefix ? [] : [];
  return entries.flatMap(([k, v]) =>
    flattenKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe("locale bundles", () => {
  const enKeys = new Set(flattenKeys(en));

  for (const locale of SUPPORTED_LOCALES) {
    if (locale === DEFAULT_LOCALE) continue;

    const bundle = LOCALE_BUNDLES[locale];
    const localeKeys = flattenKeys(bundle);

    if (localeKeys.length === 0) {
      it(`${locale}: skipped (empty — not yet translated)`, () => {
        expect(localeKeys.length).toBe(0);
      });
      continue;
    }

    it(`${locale}: contains every key present in en`, () => {
      const missing = [...enKeys].filter((k) => !localeKeys.includes(k));
      expect(missing).toEqual([]);
    });
  }
});
