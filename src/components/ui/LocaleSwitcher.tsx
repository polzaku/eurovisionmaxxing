"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  LOCALE_COOKIE,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  type SupportedLocale,
} from "@/i18n/config";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Locale display metadata. Flag + native name are intentionally NOT
 * translated — a user whose UI is currently in a foreign language needs
 * to recognise their own language to switch back. `Español` always says
 * `Español`.
 */
const LOCALE_META: Record<SupportedLocale, { flag: string; nativeName: string }> = {
  en: { flag: "🇬🇧", nativeName: "English" },
  es: { flag: "🇪🇸", nativeName: "Español" },
  uk: { flag: "🇺🇦", nativeName: "Українська" },
  fr: { flag: "🇫🇷", nativeName: "Français" },
  de: { flag: "🇩🇪", nativeName: "Deutsch" },
};

function writeLocaleCookie(locale: SupportedLocale): void {
  if (typeof document === "undefined") return;
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:";
  document.cookie =
    `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax` +
    (secure ? "; Secure" : "");
}

function writeLocaleStorage(locale: SupportedLocale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // localStorage unavailable (private mode / quota); cookie is the SoT
    // anyway. Fall through silently.
  }
}

/**
 * SPEC §21.4 / R10:340 — header chrome locale switcher. Flag emoji + ISO
 * trigger; popover lists all SUPPORTED_LOCALES with native names. Selecting
 * an option writes the NEXT_LOCALE cookie + localStorage emx_locale flag,
 * then router.refresh() re-renders the tree with next-intl's request
 * config picking up the new cookie.
 *
 * Suppressed on /room/{id}/present (TV deterministic; SPEC §21.4 step 4
 * future work).
 */
export default function LocaleSwitcher() {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const currentLocaleRaw = useLocale();
  const currentLocale: SupportedLocale = isSupportedLocale(currentLocaleRaw)
    ? currentLocaleRaw
    : "en";

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  // Close on ESC.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const handleSelect = useCallback(
    (locale: SupportedLocale) => {
      setOpen(false);
      if (locale === currentLocale) return;
      writeLocaleCookie(locale);
      writeLocaleStorage(locale);
      router.refresh();
    },
    [currentLocale, router],
  );

  // SPEC §21.4 step 4 / §10.3 — TV surface forces the admin's locale; the
  // switcher is suppressed so anyone passing by the TV can't change it.
  if (pathname?.endsWith("/present") || pathname?.includes("/present/")) {
    return null;
  }

  const meta = LOCALE_META[currentLocale];

  return (
    <div ref={containerRef} className="fixed top-3 right-14 z-30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="locale-switcher-trigger"
        data-locale={currentLocale}
        aria-label={t("localeSwitcher.label", { locale: meta.nativeName })}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-background/80 px-3 backdrop-blur text-sm font-medium hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-transform hover:scale-105 active:scale-95"
      >
        <span aria-hidden className="text-base leading-none">
          {meta.flag}
        </span>
        <span className="uppercase tracking-wider text-xs">
          {currentLocale}
        </span>
      </button>
      {open ? (
        <ul
          role="listbox"
          data-testid="locale-switcher-menu"
          aria-label={t("localeSwitcher.menuLabel")}
          className="absolute right-0 mt-2 min-w-[12rem] rounded-xl border border-border bg-background shadow-lg overflow-hidden"
        >
          {SUPPORTED_LOCALES.map((locale) => {
            const isCurrent = locale === currentLocale;
            const localeMeta = LOCALE_META[locale];
            return (
              <li key={locale} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  data-testid={`locale-switcher-option-${locale}`}
                  onClick={() => handleSelect(locale)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted focus:outline-none focus-visible:bg-muted transition-colors ${
                    isCurrent ? "bg-muted/60 font-semibold" : ""
                  }`}
                >
                  <span aria-hidden className="text-lg leading-none">
                    {localeMeta.flag}
                  </span>
                  <span className="flex-1">{localeMeta.nativeName}</span>
                  <span className="uppercase text-xs tracking-wider text-muted-foreground">
                    {locale}
                  </span>
                  {isCurrent ? (
                    <span aria-hidden className="text-primary">
                      ✓
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
