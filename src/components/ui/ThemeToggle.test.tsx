// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import ThemeToggle from "./ThemeToggle";
import { THEME_STORAGE_KEY } from "@/lib/theme";

describe("ThemeToggle", () => {
  // jsdom's localStorage is fragile in this setup (.clear / .removeItem
  // aren't functions); follow the project pattern in
  // emxHintsSeen.test.ts and stub it via defineProperty.
  const ORIGINAL_LOCAL_STORAGE = globalThis.localStorage;
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
      },
    });
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: ORIGINAL_LOCAL_STORAGE,
    });
    delete document.documentElement.dataset.theme;
  });

  it("renders the System icon by default when no localStorage value", async () => {
    render(<ThemeToggle />);
    // Wait for the hydration useEffect.
    await act(async () => {
      await Promise.resolve();
    });
    const btn = screen.getByTestId("theme-toggle");
    expect(btn).toHaveAttribute("data-theme-state", "system");
  });

  it("hydrates from localStorage if a saved theme exists", async () => {
    store[THEME_STORAGE_KEY] = "dark";
    render(<ThemeToggle />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("theme-toggle")).toHaveAttribute(
      "data-theme-state",
      "dark",
    );
  });

  it("cycles System → Light → Dark → System on each click", async () => {
    render(<ThemeToggle />);
    await act(async () => {
      await Promise.resolve();
    });
    const btn = screen.getByTestId("theme-toggle");
    expect(btn).toHaveAttribute("data-theme-state", "system");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("data-theme-state", "light");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("data-theme-state", "dark");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("data-theme-state", "system");
  });

  it("persists the theme to localStorage on each click (system removes the key)", async () => {
    render(<ThemeToggle />);
    await act(async () => {
      await Promise.resolve();
    });
    const btn = screen.getByTestId("theme-toggle");
    fireEvent.click(btn); // light
    expect(store[THEME_STORAGE_KEY]).toBe("light");
    fireEvent.click(btn); // dark
    expect(store[THEME_STORAGE_KEY]).toBe("dark");
    fireEvent.click(btn); // back to system → key removed
    expect(store[THEME_STORAGE_KEY]).toBeUndefined();
  });

  it("applies the theme to <html data-theme>; system removes the attribute", async () => {
    render(<ThemeToggle />);
    await act(async () => {
      await Promise.resolve();
    });
    const btn = screen.getByTestId("theme-toggle");
    fireEvent.click(btn); // light
    expect(document.documentElement.dataset.theme).toBe("light");
    fireEvent.click(btn); // dark
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.click(btn); // system
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("rotates aria-label per state for screen readers", async () => {
    render(<ThemeToggle />);
    await act(async () => {
      await Promise.resolve();
    });
    const btn = screen.getByTestId("theme-toggle");
    expect(btn).toHaveAttribute("aria-label", "theme.toggleAria.system");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-label", "theme.toggleAria.light");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-label", "theme.toggleAria.dark");
  });

  it("falls back to System if localStorage holds an invalid value", async () => {
    store[THEME_STORAGE_KEY] = "auto-magic";
    render(<ThemeToggle />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("theme-toggle")).toHaveAttribute(
      "data-theme-state",
      "system",
    );
  });
});
