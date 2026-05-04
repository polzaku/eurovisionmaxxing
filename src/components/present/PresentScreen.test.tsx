// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import PresentScreen from "./PresentScreen";
import type { Contestant } from "@/types";

function mkContestant(code: string, country: string, runningOrder: number): Contestant {
  return {
    id: `2026-${code}`,
    year: 2026,
    event: "final",
    countryCode: code,
    country,
    artist: "A",
    song: "S",
    flagEmoji: "🏳️",
    runningOrder,
  };
}

const CONTESTANTS = [
  mkContestant("se", "Sweden", 1),
  mkContestant("ua", "Ukraine", 2),
  mkContestant("fr", "France", 3),
];

describe("PresentScreen — lobby", () => {
  it("renders the room PIN large + 'waiting' copy", () => {
    render(<PresentScreen status="lobby" pin="ABCDEF" contestants={CONTESTANTS} />);
    expect(screen.getByTestId("present-screen")).toHaveAttribute(
      "data-status",
      "lobby",
    );
    expect(screen.getByText("ABCDEF")).toBeInTheDocument();
    expect(screen.getByText("present.lobby.callToJoin")).toBeInTheDocument();
  });

  it("renders the member count when roomMemberTotal is provided", () => {
    render(
      <PresentScreen
        status="lobby"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        roomMemberTotal={4}
      />,
    );
    expect(
      screen.getByText(/present\.lobby\.memberCount/),
    ).toBeInTheDocument();
  });
});

describe("PresentScreen — voting", () => {
  it("renders the voting eyebrow + shimmer title", () => {
    render(<PresentScreen status="voting" pin="ABCDEF" contestants={CONTESTANTS} />);
    expect(screen.getByTestId("present-screen")).toHaveAttribute(
      "data-status",
      "voting",
    );
    expect(screen.getByText("present.voting.title")).toBeInTheDocument();
  });

  it("renders voting_ending with the dedicated title", () => {
    render(
      <PresentScreen
        status="voting_ending"
        pin="ABCDEF"
        contestants={CONTESTANTS}
      />,
    );
    expect(screen.getByTestId("present-screen")).toHaveAttribute(
      "data-status",
      "voting_ending",
    );
    expect(screen.getByText("present.votingEnding.title")).toBeInTheDocument();
  });
});

describe("PresentScreen — scoring", () => {
  it("renders the 🎼 emoji + Tallying results shimmer", () => {
    render(<PresentScreen status="scoring" pin="ABCDEF" contestants={CONTESTANTS} />);
    expect(screen.getByTestId("present-screen")).toHaveAttribute(
      "data-status",
      "scoring",
    );
    expect(screen.getByText("🎼")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("scoring.title");
  });
});

describe("PresentScreen — announcing", () => {
  const LEADERBOARD = [
    { contestantId: "2026-se", totalPoints: 24, rank: 1 },
    { contestantId: "2026-ua", totalPoints: 18, rank: 2 },
    { contestantId: "2026-fr", totalPoints: 12, rank: 3 },
  ];

  it("renders the leaderboard rows with rank, flag, country, total", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
      />,
    );
    expect(screen.getByTestId("present-row-2026-se")).toBeInTheDocument();
    expect(screen.getByText("Sweden")).toBeInTheDocument();
    expect(screen.getByText("Ukraine")).toBeInTheDocument();
    expect(screen.getByText("France")).toBeInTheDocument();
    // Totals
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
  });

  it("renders 🥇 🥈 🥉 medals for ranks 1-3", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
      />,
    );
    expect(screen.getByText("🥇")).toBeInTheDocument();
    expect(screen.getByText("🥈")).toBeInTheDocument();
    expect(screen.getByText("🥉")).toBeInTheDocument();
  });

  it("renders the announcer name when provided", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
        announcerDisplayName="Alice"
      />,
    );
    expect(
      screen.getByText(/present\.announcing\.announcer/),
    ).toBeInTheDocument();
  });

  it("does NOT render announcer in 'done' status", () => {
    render(
      <PresentScreen
        status="done"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
        announcerDisplayName="Alice"
      />,
    );
    expect(
      screen.queryByText(/present\.announcing\.announcer/),
    ).not.toBeInTheDocument();
  });

  it("renders the 'final' header in 'done' status", () => {
    render(
      <PresentScreen
        status="done"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
      />,
    );
    expect(screen.getByText("present.done.title")).toBeInTheDocument();
  });

  it("falls back to the running-order placeholder for unknown contestants", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={[]}
        leaderboard={LEADERBOARD}
      />,
    );
    // The country col shows the contestantId fallback when contestant lookup fails.
    expect(screen.getByText("2026-se")).toBeInTheDocument();
  });
});
