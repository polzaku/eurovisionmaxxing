// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  // Honour the namespace passed to useTranslations() so tests can assert
  // the fully-qualified key path (e.g. "present.announcerPicks.title").
  useTranslations: (namespace?: string) =>
    (key: string, params?: Record<string, unknown>) => {
      const full = namespace ? `${namespace}.${key}` : key;
      return params ? `${full}:${JSON.stringify(params)}` : full;
    },
}));

import AnnouncerPicksPanel from "./AnnouncerPicksPanel";
import type { AnnouncerPick } from "@/lib/present/announcerBatch";

const PICKS: AnnouncerPick[] = [
  {
    contestantId: "2026-fr",
    country: "France",
    flagEmoji: "🇫🇷",
    points: 1,
  },
  {
    contestantId: "2026-se",
    country: "Sweden",
    flagEmoji: "🇸🇪",
    points: 7,
  },
];

describe("<AnnouncerPicksPanel>", () => {
  it("renders the announcer-name title", () => {
    render(<AnnouncerPicksPanel announcerDisplayName="Alice" picks={[]} />);
    const panel = screen.getByTestId("present-announcer-picks");
    expect(panel).toHaveTextContent("present.announcerPicks.title");
    expect(panel.textContent).toContain('"name":"Alice"');
  });

  it("renders one row per pick with flag + country + delta", () => {
    render(
      <AnnouncerPicksPanel announcerDisplayName="Alice" picks={PICKS} />,
    );
    const seRow = screen.getByTestId("present-pick-2026-se");
    expect(seRow).toHaveTextContent("Sweden");
    expect(seRow).toHaveTextContent("🇸🇪");
    expect(seRow).toHaveTextContent("+7");
    const frRow = screen.getByTestId("present-pick-2026-fr");
    expect(frRow).toHaveTextContent("France");
    expect(frRow).toHaveTextContent("+1");
  });

  it("renders the empty-state copy when no picks and no pending 12", () => {
    render(<AnnouncerPicksPanel announcerDisplayName="Alice" picks={[]} />);
    expect(
      screen.getByTestId("present-announcer-picks-empty"),
    ).toHaveTextContent("present.announcerPicks.empty");
  });

  it("does NOT render the empty state when picks exist", () => {
    render(
      <AnnouncerPicksPanel announcerDisplayName="Alice" picks={PICKS} />,
    );
    expect(
      screen.queryByTestId("present-announcer-picks-empty"),
    ).not.toBeInTheDocument();
  });

  it("renders the pendingTwelve footer when the prop is true", () => {
    render(
      <AnnouncerPicksPanel
        announcerDisplayName="Alice"
        picks={PICKS}
        pendingTwelve
      />,
    );
    expect(
      screen.getByTestId("present-announcer-picks-pending-twelve"),
    ).toHaveTextContent("present.announcerPicks.pendingTwelve");
  });

  it("renders pendingTwelve footer even with no picks (waiting on the 12)", () => {
    render(
      <AnnouncerPicksPanel
        announcerDisplayName="Alice"
        picks={[]}
        pendingTwelve
      />,
    );
    expect(
      screen.getByTestId("present-announcer-picks-pending-twelve"),
    ).toBeInTheDocument();
    // Empty-state copy suppressed because we're showing the 12 teaser.
    expect(
      screen.queryByTestId("present-announcer-picks-empty"),
    ).not.toBeInTheDocument();
  });
});
