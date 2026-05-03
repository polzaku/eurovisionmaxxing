export type Theme = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "emx_theme";

export function isTheme(value: unknown): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

export function nextTheme(current: Theme): Theme {
  if (current === "system") return "light";
  if (current === "light") return "dark";
  return "system";
}

/**
 * Read the persisted theme from localStorage. Falls back to "system" on
 * private mode / missing key / parse failure.
 */
export function readStoredTheme(): Theme {
  try {
    if (typeof window === "undefined") return "system";
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(raw)) return raw;
    return "system";
  } catch {
    return "system";
  }
}

export function writeStoredTheme(theme: Theme): void {
  try {
    if (typeof window === "undefined") return;
    if (theme === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    /* private mode / quota — silently no-op */
  }
}

/**
 * Apply the theme to <html data-theme="..."> so the [data-theme] CSS
 * overrides in globals.css kick in. "system" → remove the attribute so
 * the @media (prefers-color-scheme) rule wins.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  if (theme === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}
