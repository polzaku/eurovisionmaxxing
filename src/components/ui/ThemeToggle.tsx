"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  applyTheme,
  nextTheme,
  readStoredTheme,
  writeStoredTheme,
  type Theme,
} from "@/lib/theme";

const ICON: Record<Theme, string> = {
  system: "🖥",
  light: "☼",
  dark: "🌙",
};

/**
 * SPEC §3.4 manual theme toggle. Three states cycle on tap:
 * **System → Light → Dark → System**. Persists to localStorage and
 * applies via `<html data-theme>` so the CSS overrides in globals.css
 * take precedence over `prefers-color-scheme`.
 */
export default function ThemeToggle() {
  const t = useTranslations();
  const pathname = usePathname();
  const [theme, setTheme] = useState<Theme>("system");
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on mount. The FOUC bootstrap script in the
  // root layout handles the data-theme attribute before paint; this just
  // syncs React state.
  useEffect(() => {
    setTheme(readStoredTheme());
    setHydrated(true);
  }, []);

  // SPEC §3.4 / §10.3 — suppress the toggle on /room/{id}/present so
  // the TV surface stays force-dark regardless of admin preference.
  // The pathname check is conservative: any path containing /present
  // is treated as the TV surface.
  if (pathname?.endsWith("/present") || pathname?.includes("/present/")) {
    return null;
  }

  const handleClick = () => {
    const next = nextTheme(theme);
    setTheme(next);
    writeStoredTheme(next);
    applyTheme(next);
  };

  // Until hydration completes, render the System-default icon to match
  // SSR output and avoid mismatch warnings.
  const renderTheme = hydrated ? theme : "system";

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="theme-toggle"
      data-theme-state={renderTheme}
      aria-label={t(`theme.toggleAria.${renderTheme}`)}
      className="fixed top-3 right-3 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background/80 backdrop-blur text-base hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-transform hover:scale-105 active:scale-95"
    >
      <span aria-hidden>{ICON[renderTheme]}</span>
    </button>
  );
}
