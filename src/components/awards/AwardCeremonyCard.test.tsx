// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import AwardCeremonyCard from "./AwardCeremonyCard";

describe("AwardCeremonyCard", () => {
  it("renders category award with localized 'Best {categoryName}' prefix + stat", () => {
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
    // The mock returns the key verbatim; the component composes
    // `t("awards.bestCategory", { categoryName: "Vocals" })`.
    expect(screen.getByText("awards.bestCategory")).toBeInTheDocument();
    expect(screen.getByText("Sweden")).toBeInTheDocument();
    // Category stat falls back to the server-supplied label.
    expect(screen.getByText("9.4 avg")).toBeInTheDocument();
  });

  it("renders solo personality winner via localized name + explainer keys", () => {
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
            statValue: 8.9,
            statLabel: "8.9 avg",
          },
          winner: { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
          partner: null,
        }}
      />,
    );
    // Name + stat + explainer all route through t(); the mock returns
    // the keys verbatim, proving the server's English `awardName` is no
    // longer being rendered.
    expect(
      screen.getByText("awards.personality.biggest_stan.name"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("awards.personality.biggest_stan.stat"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("awards.explainers.biggest_stan"),
    ).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("renders pair award with localized joint separator", () => {
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
            statValue: 0.91,
            statLabel: "Spearman 0.91",
          },
          winner: { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
          partner: { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
        }}
      />,
    );
    // The joint separator is itself a t() key now, so the rendered text
    // is "Alice{key}Bob" with the mock returning the key.
    expect(
      screen.getByText(/Alice.*awards\.jointSeparator.*Bob/),
    ).toBeInTheDocument();
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

import type { CeremonyCard } from "@/lib/awards/awardCeremonySequence";

const VIEWER = { userId: "u3", displayName: "Carol", avatarSeed: "carol-seed" };
const NEIGHBOUR = { userId: "u1", displayName: "Alice", avatarSeed: "alice-seed" };

function mkPersonalNeighbourCard(
  overrides: Partial<{ pearson: number; isReciprocal: boolean }> = {},
): CeremonyCard {
  return {
    kind: "personal-neighbour",
    award: {
      roomId: "",
      awardKey: "your_neighbour",
      awardName: "Your closest neighbour",
      winnerUserId: VIEWER.userId,
      winnerUserIdB: NEIGHBOUR.userId,
      winnerContestantId: null,
      statValue: overrides.pearson ?? 0.84,
      statLabel: `Pearson ${(overrides.pearson ?? 0.84).toFixed(2)}`,
    },
    viewerUser: VIEWER,
    neighbourUser: NEIGHBOUR,
    pearson: overrides.pearson ?? 0.84,
    isReciprocal: overrides.isReciprocal ?? false,
  };
}

describe("AwardCeremonyCard — personal-neighbour", () => {
  it("renders the award name + neighbour name + 'You & {name}' line via locale keys", () => {
    render(<AwardCeremonyCard card={mkPersonalNeighbourCard()} />);
    // Personal-neighbour pulls its name from awards.your_neighbour.name.
    expect(
      screen.getByText("awards.your_neighbour.name"),
    ).toBeInTheDocument();
    expect(screen.getByText(/awards\.your_neighbour\.caption/)).toBeInTheDocument();
    // "You & {name}" is now a locale-keyed template; the mock returns the
    // key verbatim regardless of params.
    expect(screen.getByText("awards.youAnd")).toBeInTheDocument();
  });

  it("shows the reciprocity badge when isReciprocal=true", () => {
    render(
      <AwardCeremonyCard
        card={mkPersonalNeighbourCard({ isReciprocal: true })}
      />,
    );
    expect(
      screen.getByText(/awards\.your_neighbour\.reciprocalBadge/),
    ).toBeInTheDocument();
  });

  it("hides the reciprocity badge when isReciprocal=false", () => {
    render(
      <AwardCeremonyCard
        card={mkPersonalNeighbourCard({ isReciprocal: false })}
      />,
    );
    expect(
      screen.queryByText(/awards\.your_neighbour\.reciprocalBadge/),
    ).not.toBeInTheDocument();
  });

  it("renders the Pearson stat line via the localized template", () => {
    render(
      <AwardCeremonyCard card={mkPersonalNeighbourCard({ pearson: 0.84 })} />,
    );
    // Localized stat key for your_neighbour reuses the personality.your_neighbour.stat path.
    expect(
      screen.getByText("awards.personality.your_neighbour.stat"),
    ).toBeInTheDocument();
  });

  it("renders the explainer paragraph via the locale key", () => {
    render(<AwardCeremonyCard card={mkPersonalNeighbourCard()} />);
    expect(
      screen.getByText("awards.explainers.your_neighbour"),
    ).toBeInTheDocument();
  });
});

describe("AwardCeremonyCard — overall-winner", () => {
  it("renders the localized title, contestant flag, country and points stat", () => {
    const card: CeremonyCard = {
      kind: "overall-winner",
      award: {
        roomId: "",
        awardKey: "overall_winner",
        awardName: "And the winner is…",
        winnerUserId: null,
        winnerUserIdB: null,
        winnerContestantId: "2026-UK",
        statValue: 142,
        statLabel: null,
      },
      contestant: {
        id: "2026-UK",
        year: 2026,
        event: "final",
        countryCode: "UA",
        country: "Ukraine",
        artist: "A",
        song: "S",
        flagEmoji: "🇺🇦",
        runningOrder: 1,
      },
      totalPoints: 142,
    };
    render(<AwardCeremonyCard card={card} />);
    // Localized title via t() → mock returns the key verbatim.
    expect(screen.getByText(/awards\.overall_winner\.name/)).toBeInTheDocument();
    expect(screen.getByText("Ukraine")).toBeInTheDocument();
    expect(screen.getByText("🇺🇦")).toBeInTheDocument();
    // Stat: locale key resolves via t(); mock ignores params and returns
    // the bare key — so the rendered text is the key itself.
    expect(
      screen.getByText("awards.overall_winner.stat"),
    ).toBeInTheDocument();
  });
});
