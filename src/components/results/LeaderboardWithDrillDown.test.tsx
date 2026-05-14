// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import LeaderboardWithDrillDown, {
  type LeaderboardWithDrillDownLabels,
} from "./LeaderboardWithDrillDown";
import type { Contestant } from "@/types";
import type { LeaderboardEntry } from "@/lib/results/formatRoomSummary";
import type { ContestantBreakdown } from "@/lib/results/buildContestantBreakdowns";

const SWEDEN: Contestant = {
  id: "2026-se",
  country: "Sweden",
  countryCode: "se",
  flagEmoji: "🇸🇪",
  artist: "ABBA Tribute",
  song: "Waterloo Returns",
  runningOrder: 1,
  event: "final",
  year: 2026,
};

const NORWAY: Contestant = {
  id: "2026-no",
  country: "Norway",
  countryCode: "no",
  flagEmoji: "🇳🇴",
  artist: "Tester",
  song: "Tester",
  runningOrder: 2,
  event: "final",
  year: 2026,
};

const CONTESTANTS: Contestant[] = [SWEDEN, NORWAY];

const LEADERBOARD: LeaderboardEntry[] = [
  { contestantId: "2026-se", totalPoints: 22, rank: 1 },
  { contestantId: "2026-no", totalPoints: 0, rank: 2 },
];

const CONTESTANT_BREAKDOWNS: ContestantBreakdown[] = [
  {
    contestantId: "2026-se",
    gives: [
      { userId: "u-alice", displayName: "Alice", avatarSeed: "a", pointsAwarded: 12 },
      { userId: "u-bob", displayName: "Bob", avatarSeed: "b", pointsAwarded: 10 },
    ],
  },
  // Norway intentionally absent — exercises the empty-state branch.
];

const LABELS: LeaderboardWithDrillDownLabels = {
  title: "Leaderboard",
  drillDownHeading: "Points received",
  drillDownEmpty: "No points received from anyone in the room.",
  toggleAria: (country) => `Show points breakdown for ${country}`,
  formatGivePoints: (points) => `${points} ${points === 1 ? "pt" : "pts"}`,
};

describe("LeaderboardWithDrillDown", () => {
  it("renders the section title and one row per leaderboard entry", () => {
    render(
      <LeaderboardWithDrillDown
        leaderboard={LEADERBOARD}
        contestants={CONTESTANTS}
        contestantBreakdowns={CONTESTANT_BREAKDOWNS}
        labels={LABELS}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Leaderboard" }),
    ).toBeInTheDocument();
    // The outer <ol> holds one <li> per contestant; inner drill-down gives
    // are also <li>s but live in their own <ul>. Scope to the leaderboard ol.
    const orderedList = document.querySelector("ol")!;
    expect(within(orderedList).getAllByRole("listitem").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(orderedList.children).toHaveLength(2);
  });

  it("renders rank, flag, country, total points for each row", () => {
    render(
      <LeaderboardWithDrillDown
        leaderboard={LEADERBOARD}
        contestants={CONTESTANTS}
        contestantBreakdowns={CONTESTANT_BREAKDOWNS}
        labels={LABELS}
      />,
    );
    expect(screen.getByText("Sweden")).toBeInTheDocument();
    expect(screen.getByText("Norway")).toBeInTheDocument();
    expect(screen.getByText("22")).toBeInTheDocument();
  });

  it("collapses the drill-down by default (details not open)", () => {
    render(
      <LeaderboardWithDrillDown
        leaderboard={LEADERBOARD}
        contestants={CONTESTANTS}
        contestantBreakdowns={CONTESTANT_BREAKDOWNS}
        labels={LABELS}
      />,
    );
    const detailsList = document.querySelectorAll("details");
    expect(detailsList).toHaveLength(2);
    for (const d of detailsList) {
      expect(d).not.toHaveAttribute("open");
    }
  });

  it("renders one give per voter inside the open drill-down, points desc", () => {
    render(
      <LeaderboardWithDrillDown
        leaderboard={LEADERBOARD}
        contestants={CONTESTANTS}
        contestantBreakdowns={CONTESTANT_BREAKDOWNS}
        labels={LABELS}
      />,
    );
    // Open Sweden's row programmatically — userEvent.click on summary toggles
    // <details> in jsdom but we read the rendered children directly to verify
    // ordering regardless of open-state, since they're always in the DOM.
    const swedenRow = screen.getAllByRole("listitem")[0];
    const drillDownItems = within(swedenRow)
      .getAllByRole("listitem"); // inner gives
    expect(drillDownItems.map((li) => li.textContent)).toEqual([
      "Alice12 pts",
      "Bob10 pts",
    ]);
  });

  it("renders the empty-state copy when a contestant has no breakdown entry", () => {
    render(
      <LeaderboardWithDrillDown
        leaderboard={LEADERBOARD}
        contestants={CONTESTANTS}
        contestantBreakdowns={CONTESTANT_BREAKDOWNS}
        labels={LABELS}
      />,
    );
    expect(
      screen.getByText("No points received from anyone in the room."),
    ).toBeInTheDocument();
  });

  it("applies the toggleAria label to each summary so screen readers announce the country", () => {
    render(
      <LeaderboardWithDrillDown
        leaderboard={LEADERBOARD}
        contestants={CONTESTANTS}
        contestantBreakdowns={CONTESTANT_BREAKDOWNS}
        labels={LABELS}
      />,
    );
    expect(
      document.querySelector(
        'summary[aria-label="Show points breakdown for Sweden"]',
      ),
    ).not.toBeNull();
    expect(
      document.querySelector(
        'summary[aria-label="Show points breakdown for Norway"]',
      ),
    ).not.toBeNull();
  });

  it("uses the formatGivePoints callback for both singular and plural points", () => {
    const breakdowns: ContestantBreakdown[] = [
      {
        contestantId: "2026-se",
        gives: [
          { userId: "u-alice", displayName: "Alice", avatarSeed: "a", pointsAwarded: 12 },
          { userId: "u-bob", displayName: "Bob", avatarSeed: "b", pointsAwarded: 1 },
        ],
      },
    ];
    render(
      <LeaderboardWithDrillDown
        leaderboard={LEADERBOARD}
        contestants={CONTESTANTS}
        contestantBreakdowns={breakdowns}
        labels={LABELS}
      />,
    );
    expect(screen.getByText("12 pts")).toBeInTheDocument();
    expect(screen.getByText("1 pt")).toBeInTheDocument();
  });

  it("toggles `open` on the <details> when summary is clicked", () => {
    render(
      <LeaderboardWithDrillDown
        leaderboard={LEADERBOARD}
        contestants={CONTESTANTS}
        contestantBreakdowns={CONTESTANT_BREAKDOWNS}
        labels={LABELS}
      />,
    );
    const summary = document.querySelector(
      'summary[aria-label="Show points breakdown for Sweden"]',
    ) as HTMLElement;
    const details = summary.parentElement as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
  });

  it("falls back to contestantId + neutral flag when contestant metadata is missing", () => {
    render(
      <LeaderboardWithDrillDown
        leaderboard={[
          { contestantId: "2026-zz", totalPoints: 0, rank: 1 },
        ]}
        contestants={[]}
        contestantBreakdowns={[]}
        labels={LABELS}
      />,
    );
    expect(screen.getByText("2026-zz")).toBeInTheDocument();
    expect(
      document.querySelector(
        'summary[aria-label="Show points breakdown for 2026-zz"]',
      ),
    ).not.toBeNull();
  });

  describe("Full breakdown link (SPEC §12.6.1 trigger)", () => {
    it("renders the link inside an open <details> only when onOpenFullBreakdown is supplied", async () => {
      const { default: userEvent } = await import("@testing-library/user-event");
      const user = userEvent.setup();
      const onOpen = vi.fn();
      render(
        <LeaderboardWithDrillDown
          leaderboard={LEADERBOARD}
          contestants={[SWEDEN]}
          contestantBreakdowns={CONTESTANT_BREAKDOWNS}
          labels={LABELS}
          onOpenFullBreakdown={onOpen}
          openFullBreakdownLabel="Full breakdown →"
        />,
      );
      const summary = document.querySelector(
        'summary[aria-label="Show points breakdown for Sweden"]',
      ) as HTMLElement;
      await user.click(summary);
      const details = summary.parentElement as HTMLDetailsElement;
      expect(
        within(details).getByRole("button", { name: "Full breakdown →" }),
      ).toBeInTheDocument();
    });

    it("clicking the link calls onOpenFullBreakdown with the contestantId", async () => {
      const { default: userEvent } = await import("@testing-library/user-event");
      const user = userEvent.setup();
      const onOpen = vi.fn();
      render(
        <LeaderboardWithDrillDown
          leaderboard={LEADERBOARD}
          contestants={[SWEDEN]}
          contestantBreakdowns={CONTESTANT_BREAKDOWNS}
          labels={LABELS}
          onOpenFullBreakdown={onOpen}
          openFullBreakdownLabel="Full breakdown →"
        />,
      );
      const summary = document.querySelector(
        'summary[aria-label="Show points breakdown for Sweden"]',
      ) as HTMLElement;
      await user.click(summary);
      const details = summary.parentElement as HTMLDetailsElement;
      await user.click(
        within(details).getByRole("button", { name: "Full breakdown →" }),
      );
      expect(onOpen).toHaveBeenCalledWith("2026-se");
    });

    it("suppresses the link when onOpenFullBreakdown is not supplied", async () => {
      const { default: userEvent } = await import("@testing-library/user-event");
      const user = userEvent.setup();
      render(
        <LeaderboardWithDrillDown
          leaderboard={LEADERBOARD}
          contestants={[SWEDEN]}
          contestantBreakdowns={CONTESTANT_BREAKDOWNS}
          labels={LABELS}
        />,
      );
      const summary = document.querySelector(
        'summary[aria-label="Show points breakdown for Sweden"]',
      ) as HTMLElement;
      await user.click(summary);
      const details = summary.parentElement as HTMLDetailsElement;
      expect(
        within(details).queryByRole("button", { name: /Full breakdown/i }),
      ).toBeNull();
    });
  });
});
