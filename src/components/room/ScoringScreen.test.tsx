// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import ScoringScreen from "./ScoringScreen";

describe("ScoringScreen", () => {
  it("renders the role='status' heading with the locale-keyed title", () => {
    render(<ScoringScreen />);
    expect(screen.getByRole("status")).toHaveTextContent("scoring.title");
  });

  it("renders the subtitle copy", () => {
    render(<ScoringScreen />);
    expect(screen.getByText("scoring.subtitle")).toBeInTheDocument();
  });

  it("uses aria-live='polite' so screen readers announce the transition non-intrusively", () => {
    render(<ScoringScreen />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("applies the motion-safe shimmer class to the title (reduced-motion gated in globals.css)", () => {
    render(<ScoringScreen />);
    expect(screen.getByRole("status").className).toContain(
      "motion-safe:animate-shimmer",
    );
  });

  it("renders the data-testid hook for upstream queries", () => {
    const { container } = render(<ScoringScreen />);
    expect(
      container.querySelector("[data-testid='scoring-screen']"),
    ).toBeTruthy();
  });

  describe("host TV-mode CTA (live mode)", () => {
    beforeEach(() => {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { origin: "https://emx.test", href: "https://emx.test/room/x" },
      });
    });

    it("renders the TV-mode CTA when host is admin and mode is live", () => {
      render(
        <ScoringScreen
          roomId="room-1"
          isAdmin={true}
          announcementMode="live"
        />,
      );
      const tvLink = screen.getByRole("link", { name: /tvMode\.openButton/ });
      expect(tvLink).toHaveAttribute("href", "/room/room-1/present");
      expect(tvLink).toHaveAttribute("target", "_blank");
      expect(screen.getByText("scoring.tvMode.title")).toBeInTheDocument();
    });

    it("suppresses the CTA when announcementMode is instant", () => {
      render(
        <ScoringScreen
          roomId="room-1"
          isAdmin={true}
          announcementMode="instant"
        />,
      );
      expect(
        screen.queryByRole("link", { name: /tvMode\.openButton/ }),
      ).toBeNull();
    });

    it("suppresses the CTA when viewer is not the admin", () => {
      render(
        <ScoringScreen
          roomId="room-1"
          isAdmin={false}
          announcementMode="live"
        />,
      );
      expect(
        screen.queryByRole("link", { name: /tvMode\.openButton/ }),
      ).toBeNull();
    });

    it("copy-link button copies the absolute /present URL", async () => {
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      render(
        <ScoringScreen
          roomId="room-42"
          isAdmin={true}
          announcementMode="live"
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /tvMode\.copyButton/ }),
      );
      expect(writeText).toHaveBeenCalledWith(
        "https://emx.test/room/room-42/present",
      );
    });
  });
});
