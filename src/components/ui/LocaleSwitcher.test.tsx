// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => mockLocale,
}));

let mockLocale = "en";
let mockPathname = "/";
const refreshSpy = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ refresh: refreshSpy }),
}));

import LocaleSwitcher from "./LocaleSwitcher";

describe("LocaleSwitcher", () => {
  const ORIGINAL_LOCAL_STORAGE = globalThis.localStorage;
  let store: Record<string, string>;

  beforeEach(() => {
    mockLocale = "en";
    mockPathname = "/";
    refreshSpy.mockClear();
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
    // Clear cookies between tests.
    document.cookie.split(";").forEach((c) => {
      const name = c.split("=")[0]?.trim();
      if (name) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      }
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: ORIGINAL_LOCAL_STORAGE,
    });
  });

  it("renders the current locale's flag + ISO code on the trigger", () => {
    render(<LocaleSwitcher />);
    const trigger = screen.getByTestId("locale-switcher-trigger");
    expect(trigger).toHaveAttribute("data-locale", "en");
    expect(trigger).toHaveTextContent("🇬🇧");
    expect(trigger).toHaveTextContent(/en/i);
  });

  it("renders the Spanish flag when the current locale is es", () => {
    mockLocale = "es";
    render(<LocaleSwitcher />);
    const trigger = screen.getByTestId("locale-switcher-trigger");
    expect(trigger).toHaveAttribute("data-locale", "es");
    expect(trigger).toHaveTextContent("🇪🇸");
  });

  it("opens the popover on trigger click and lists all 5 supported locales", () => {
    render(<LocaleSwitcher />);
    expect(screen.queryByTestId("locale-switcher-menu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("locale-switcher-trigger"));
    const menu = screen.getByTestId("locale-switcher-menu");
    expect(menu).toBeInTheDocument();
    // All 5 options present.
    for (const code of ["en", "es", "uk", "fr", "de"]) {
      expect(
        screen.getByTestId(`locale-switcher-option-${code}`),
      ).toBeInTheDocument();
    }
    // Native names render in the menu.
    expect(screen.getByText("English")).toBeInTheDocument();
    expect(screen.getByText("Español")).toBeInTheDocument();
    expect(screen.getByText("Українська")).toBeInTheDocument();
    expect(screen.getByText("Français")).toBeInTheDocument();
    expect(screen.getByText("Deutsch")).toBeInTheDocument();
  });

  it("marks the current locale option as aria-selected", () => {
    mockLocale = "fr";
    render(<LocaleSwitcher />);
    fireEvent.click(screen.getByTestId("locale-switcher-trigger"));
    const frOption = screen.getByTestId("locale-switcher-option-fr");
    expect(frOption).toHaveAttribute("aria-selected", "true");
    const enOption = screen.getByTestId("locale-switcher-option-en");
    expect(enOption).toHaveAttribute("aria-selected", "false");
  });

  it("writes the NEXT_LOCALE cookie + localStorage and refreshes the router on select", () => {
    render(<LocaleSwitcher />);
    fireEvent.click(screen.getByTestId("locale-switcher-trigger"));
    fireEvent.click(screen.getByTestId("locale-switcher-option-de"));
    expect(document.cookie).toContain("NEXT_LOCALE=de");
    expect(store.emx_locale).toBe("de");
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT refresh the router when the user selects the already-active locale", () => {
    render(<LocaleSwitcher />);
    fireEvent.click(screen.getByTestId("locale-switcher-trigger"));
    fireEvent.click(screen.getByTestId("locale-switcher-option-en"));
    // No cookie write expected (the locale didn't change).
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it("closes the popover when ESC is pressed", () => {
    render(<LocaleSwitcher />);
    fireEvent.click(screen.getByTestId("locale-switcher-trigger"));
    expect(screen.getByTestId("locale-switcher-menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("locale-switcher-menu")).not.toBeInTheDocument();
  });

  it("closes the popover on click outside the container", () => {
    render(
      <div>
        <button data-testid="outside">outside</button>
        <LocaleSwitcher />
      </div>,
    );
    fireEvent.click(screen.getByTestId("locale-switcher-trigger"));
    expect(screen.getByTestId("locale-switcher-menu")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(screen.queryByTestId("locale-switcher-menu")).not.toBeInTheDocument();
  });

  it("suppresses itself on /present routes", () => {
    mockPathname = "/room/abc-123/present";
    render(<LocaleSwitcher />);
    expect(
      screen.queryByTestId("locale-switcher-trigger"),
    ).not.toBeInTheDocument();
  });
});
