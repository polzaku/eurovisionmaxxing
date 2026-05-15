// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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

  it("does NOT render an inline TV-mode CTA — that surface moved to the AnnouncingView chooser (2026-05-15)", () => {
    render(<ScoringScreen />);
    expect(
      screen.queryByRole("link", { name: /Open TV mode/i }),
    ).toBeNull();
    expect(
      screen.queryByTestId("scoring-tv-mode-cta"),
    ).toBeNull();
  });
});
