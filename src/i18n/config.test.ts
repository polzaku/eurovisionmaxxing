import { describe, it, expect } from "vitest";
import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_STORAGE_KEY,
  isSupportedLocale,
} from "@/i18n/config";

describe("i18n config", () => {
  it("exports the five SPEC §21.1 locales", () => {
    expect(SUPPORTED_LOCALES).toEqual(["en", "es", "uk", "fr", "de"]);
  });

  it("defaults to English", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("uses the SPEC-mandated cookie and storage key names", () => {
    expect(LOCALE_COOKIE).toBe("NEXT_LOCALE");
    expect(LOCALE_STORAGE_KEY).toBe("emx_locale");
  });

  it("isSupportedLocale narrows correctly", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("uk")).toBe(true);
    expect(isSupportedLocale("pt")).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
    expect(isSupportedLocale(42)).toBe(false);
  });
});
