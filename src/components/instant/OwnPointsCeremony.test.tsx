// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import OwnPointsCeremony, {
  type OwnBreakdownEntry,
} from "./OwnPointsCeremony";
import type { Contestant } from "@/types";

function mkContestant(id: string, country = id): Contestant {
  return {
    id,
    year: 2026,
    event: "final",
    countryCode: id.split("-")[1] ?? "XX",
    country,
    // Song titles deliberately don't include the country name so
    // getByText(/Country/) regex matches only the country span.
    artist: "Test Artist",
    song: "Test Song",
    flagEmoji: "🏳️",
    runningOrder: 1,
  };
}

const CONTESTANTS: Contestant[] = [
  mkContestant("2026-AT", "Austria"),
  mkContestant("2026-FR", "France"),
  mkContestant("2026-IT", "Italy"),
  mkContestant("2026-NO", "Norway"),
  mkContestant("2026-PL", "Poland"),
  mkContestant("2026-PT", "Portugal"),
  mkContestant("2026-SE", "Sweden"),
  mkContestant("2026-UA", "Ukraine"),
  mkContestant("2026-UK", "United Kingdom"),
  mkContestant("2026-DE", "Germany"),
];

function fullBreakdown(): OwnBreakdownEntry[] {
  // 10 picks across the Eurovision points: 1,2,3,4,5,6,7,8,10,12
  return [
    { contestantId: "2026-AT", pointsAwarded: 1, hotTake: null },
    { contestantId: "2026-FR", pointsAwarded: 2, hotTake: null },
    { contestantId: "2026-IT", pointsAwarded: 3, hotTake: null },
    { contestantId: "2026-NO", pointsAwarded: 4, hotTake: null },
    { contestantId: "2026-PL", pointsAwarded: 5, hotTake: null },
    { contestantId: "2026-PT", pointsAwarded: 6, hotTake: null },
    { contestantId: "2026-SE", pointsAwarded: 7, hotTake: null },
    { contestantId: "2026-UA", pointsAwarded: 8, hotTake: null },
    { contestantId: "2026-UK", pointsAwarded: 10, hotTake: null },
    { contestantId: "2026-DE", pointsAwarded: 12, hotTake: "Banger." },
  ];
}

describe("OwnPointsCeremony — initial render with 12-pt pick", () => {
  let onAllRevealed: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onAllRevealed = vi.fn();
  });

  it("renders the lower nine picks (points 1..10, excluding 12) immediately", () => {
    render(
      <OwnPointsCeremony
        entries={fullBreakdown()}
        contestants={CONTESTANTS}
        onAllRevealed={onAllRevealed}
      />,
    );

    // Each lower-nine country name should be present.
    expect(screen.getByText(/Austria/)).toBeInTheDocument();
    expect(screen.getByText(/France/)).toBeInTheDocument();
    expect(screen.getByText(/Italy/)).toBeInTheDocument();
    expect(screen.getByText(/Norway/)).toBeInTheDocument();
    expect(screen.getByText(/Poland/)).toBeInTheDocument();
    expect(screen.getByText(/Portugal/)).toBeInTheDocument();
    expect(screen.getByText(/Sweden/)).toBeInTheDocument();
    expect(screen.getByText(/Ukraine/)).toBeInTheDocument();
    expect(screen.getByText(/United Kingdom/)).toBeInTheDocument();
  });

  it("hides the 12-point pick (Germany) until reveal", () => {
    render(
      <OwnPointsCeremony
        entries={fullBreakdown()}
        contestants={CONTESTANTS}
        onAllRevealed={onAllRevealed}
      />,
    );

    expect(screen.queryByText(/Germany/)).not.toBeInTheDocument();
  });

  it("shows the reveal button and skip link before the 12 is revealed", () => {
    render(
      <OwnPointsCeremony
        entries={fullBreakdown()}
        contestants={CONTESTANTS}
        onAllRevealed={onAllRevealed}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "instantAnnounce.ownResults.revealTwelveButton",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "instantAnnounce.ownResults.revealTwelveSkip",
      }),
    ).toBeInTheDocument();
  });

  it("does not fire onAllRevealed before the user reveals", () => {
    render(
      <OwnPointsCeremony
        entries={fullBreakdown()}
        contestants={CONTESTANTS}
        onAllRevealed={onAllRevealed}
      />,
    );
    expect(onAllRevealed).not.toHaveBeenCalled();
  });
});

describe("OwnPointsCeremony — tap to reveal the 12", () => {
  it("renders Germany after clicking the reveal button", async () => {
    const user = userEvent.setup();
    const onAllRevealed = vi.fn();
    render(
      <OwnPointsCeremony
        entries={fullBreakdown()}
        contestants={CONTESTANTS}
        onAllRevealed={onAllRevealed}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "instantAnnounce.ownResults.revealTwelveButton",
      }),
    );

    expect(screen.getByText(/Germany/)).toBeInTheDocument();
    expect(onAllRevealed).toHaveBeenCalledTimes(1);
  });

  it("removes the reveal button + skip link after the 12 is shown", async () => {
    const user = userEvent.setup();
    render(
      <OwnPointsCeremony
        entries={fullBreakdown()}
        contestants={CONTESTANTS}
        onAllRevealed={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "instantAnnounce.ownResults.revealTwelveButton",
      }),
    );

    expect(
      screen.queryByRole("button", {
        name: "instantAnnounce.ownResults.revealTwelveButton",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "instantAnnounce.ownResults.revealTwelveSkip",
      }),
    ).not.toBeInTheDocument();
  });

  it("Skip-the-build-up link reveals the 12 the same way", async () => {
    const user = userEvent.setup();
    const onAllRevealed = vi.fn();
    render(
      <OwnPointsCeremony
        entries={fullBreakdown()}
        contestants={CONTESTANTS}
        onAllRevealed={onAllRevealed}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "instantAnnounce.ownResults.revealTwelveSkip",
      }),
    );

    expect(screen.getByText(/Germany/)).toBeInTheDocument();
    expect(onAllRevealed).toHaveBeenCalledTimes(1);
  });

  it("renders the gold-halo + animate-fade-in classes on the 12-pt row", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <OwnPointsCeremony
        entries={fullBreakdown()}
        contestants={CONTESTANTS}
        onAllRevealed={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "instantAnnounce.ownResults.revealTwelveButton",
      }),
    );

    // The Germany row should carry the motion-safe halo classes.
    const germanyRow = container.querySelector(
      "li.motion-safe\\:emx-glow-gold",
    );
    expect(germanyRow).toBeTruthy();
    expect(germanyRow?.className).toMatch(/motion-safe:animate-fade-in/);
  });
});

describe("OwnPointsCeremony — degenerate paths fire onAllRevealed on mount", () => {
  it("fires immediately when entries are empty (no points awarded)", () => {
    const onAllRevealed = vi.fn();
    render(
      <OwnPointsCeremony
        entries={[]}
        contestants={CONTESTANTS}
        onAllRevealed={onAllRevealed}
      />,
    );

    // Empty-state copy renders.
    expect(
      screen.getByText("instantAnnounce.ownResults.empty"),
    ).toBeInTheDocument();
    // No reveal affordance.
    expect(
      screen.queryByRole("button", {
        name: "instantAnnounce.ownResults.revealTwelveButton",
      }),
    ).not.toBeInTheDocument();
    // Ready-gate signal already fired so the parent un-disables Ready.
    expect(onAllRevealed).toHaveBeenCalledTimes(1);
  });

  it("fires immediately when no entry awards 12 (≤9 contestants scored)", () => {
    const onAllRevealed = vi.fn();
    const partial: OwnBreakdownEntry[] = [
      { contestantId: "2026-AT", pointsAwarded: 1, hotTake: null },
      { contestantId: "2026-FR", pointsAwarded: 2, hotTake: null },
      { contestantId: "2026-IT", pointsAwarded: 3, hotTake: null },
    ];

    render(
      <OwnPointsCeremony
        entries={partial}
        contestants={CONTESTANTS}
        onAllRevealed={onAllRevealed}
      />,
    );

    // All three picks are visible immediately.
    expect(screen.getByText(/Austria/)).toBeInTheDocument();
    expect(screen.getByText(/France/)).toBeInTheDocument();
    expect(screen.getByText(/Italy/)).toBeInTheDocument();
    // No reveal CTA.
    expect(
      screen.queryByRole("button", {
        name: "instantAnnounce.ownResults.revealTwelveButton",
      }),
    ).not.toBeInTheDocument();
    // Ready-gate fired.
    expect(onAllRevealed).toHaveBeenCalledTimes(1);
  });
});

describe("OwnPointsCeremony — sort order of lower nine", () => {
  it("renders lower-nine picks descending by points (10, 8, 7, …, 1)", () => {
    const onAllRevealed = vi.fn();
    const { container } = render(
      <OwnPointsCeremony
        entries={fullBreakdown()}
        contestants={CONTESTANTS}
        onAllRevealed={onAllRevealed}
      />,
    );

    // Read the rendered <li>s in DOM order; extract the rendered point chips.
    const pointChips = Array.from(
      container.querySelectorAll("li > span:first-child"),
    ).map((el) => el.textContent?.trim());

    // The first row is the highest-points pick of the lower nine, which is 10.
    expect(pointChips).toEqual(["10", "8", "7", "6", "5", "4", "3", "2", "1"]);
  });
});
