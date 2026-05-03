// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import AwardCeremonyCard from "./AwardCeremonyCard";

describe("AwardCeremonyCard", () => {
  it("renders contestant award with country name + stat", () => {
    render(
      <AwardCeremonyCard
        card={{
          kind: "contestant",
          award: {
            roomId: "r",
            awardKey: "best_vocals",
            awardName: "Best Vocals",
            winnerUserId: null,
            winnerUserIdB: null,
            winnerContestantId: "2026-SE",
            statValue: null,
            statLabel: "9.4 avg",
          },
          contestant: {
            id: "2026-SE",
            year: 2026,
            event: "final",
            countryCode: "SE",
            country: "Sweden",
            artist: "A",
            song: "S",
            flagEmoji: "🇸🇪",
            runningOrder: 1,
          },
        }}
      />,
    );
    expect(screen.getByText("Best Vocals")).toBeInTheDocument();
    expect(screen.getByText("Sweden")).toBeInTheDocument();
    expect(screen.getByText("9.4 avg")).toBeInTheDocument();
  });

  it("renders solo personality winner with name + plain-English explainer", () => {
    render(
      <AwardCeremonyCard
        card={{
          kind: "user",
          award: {
            roomId: "r",
            awardKey: "biggest_stan",
            awardName: "Biggest stan",
            winnerUserId: "u1",
            winnerUserIdB: null,
            winnerContestantId: null,
            statValue: null,
            statLabel: "8.9 avg",
          },
          winner: { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
          partner: null,
        }}
      />,
    );
    expect(screen.getByText("Biggest stan")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(
      screen.getByText(/Highest average score given/),
    ).toBeInTheDocument();
  });

  it("renders pair award with both names + neighbourhood caption", () => {
    render(
      <AwardCeremonyCard
        card={{
          kind: "user",
          award: {
            roomId: "r",
            awardKey: "neighbourhood_voters",
            awardName: "Neighbourhood voters",
            winnerUserId: "u1",
            winnerUserIdB: "u2",
            winnerContestantId: null,
            statValue: null,
            statLabel: "Spearman 0.91",
          },
          winner: { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
          partner: { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
        }}
      />,
    );
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
    // Locale mock returns the key verbatim, so the neighbourhood caption
    // shows up as the literal locale path.
    expect(screen.getByText(/awards\.neighbourhoodCaption/)).toBeInTheDocument();
  });

  it("renders flag emoji for contestant awards (decorative, not in alt)", () => {
    render(
      <AwardCeremonyCard
        card={{
          kind: "contestant",
          award: {
            roomId: "r",
            awardKey: "best_vocals",
            awardName: "Best Vocals",
            winnerUserId: null,
            winnerUserIdB: null,
            winnerContestantId: "2026-SE",
            statValue: null,
            statLabel: null,
          },
          contestant: {
            id: "2026-SE",
            year: 2026,
            event: "final",
            countryCode: "SE",
            country: "Sweden",
            artist: "A",
            song: "S",
            flagEmoji: "🇸🇪",
            runningOrder: 1,
          },
        }}
      />,
    );
    expect(screen.getByText("🇸🇪")).toBeInTheDocument();
  });
});
