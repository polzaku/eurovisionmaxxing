// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import CategoryDrillDownBody from "@/components/results/drill-down/CategoryDrillDownBody";
import type { ResultsData } from "@/lib/results/loadResults";

type DonePayload = Extract<ResultsData, { status: "done" }>;

const LABELS = {
  titleId: "drill-category-title",
  title: (categoryName: string) => `Best ${categoryName} — full ranking`,
  meanLabel: (value: string) => `Mean ${value}`,
  voterCountLabel: (voted: number, total: number) => `${voted}/${total} voted`,
  sparklineAria: (min: number, median: number, max: number) =>
    `Min ${min}, median ${median}, max ${max} out of 10`,
  highestSingleLabel: (value: number, name: string) =>
    `Highest: ${value} from ${name}`,
  lowestSingleLabel: (value: number, name: string) =>
    `Lowest: ${value} from ${name}`,
  meanOfMeansLabel: (value: string) => `Room mean: ${value}`,
  emptyCopy: "No room member rated this category.",
};

const FIXTURE_DATA: Pick<
  DonePayload,
  "categories" | "members" | "contestants" | "voteDetails"
> = {
  categories: [{ name: "vocals", weight: 1, key: "vocals" }],
  members: [
    { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
    { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
    { userId: "u3", displayName: "Carol", avatarSeed: "carol" },
  ],
  contestants: [
    {
      id: "2026-se",
      country: "Sweden",
      countryCode: "se",
      flagEmoji: "🇸🇪",
      artist: "A",
      song: "S",
      runningOrder: 1,
      event: "final",
      year: 2026,
    },
  ],
  voteDetails: [
    {
      userId: "u1",
      contestantId: "2026-se",
      scores: { vocals: 9 },
      missed: false,
      pointsAwarded: 12,
      hotTake: null,
      hotTakeEditedAt: null,
    },
    {
      userId: "u2",
      contestantId: "2026-se",
      scores: { vocals: 7 },
      missed: false,
      pointsAwarded: 8,
      hotTake: null,
      hotTakeEditedAt: null,
    },
    {
      userId: "u3",
      contestantId: "2026-se",
      scores: { vocals: 5 },
      missed: false,
      pointsAwarded: 5,
      hotTake: null,
      hotTakeEditedAt: null,
    },
  ],
};

describe("<CategoryDrillDownBody>", () => {
  it("renders the category header", () => {
    render(
      <CategoryDrillDownBody
        categoryKey="vocals"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /Best vocals.*full ranking/i }),
    ).toBeInTheDocument();
  });

  it("renders rows sorted by category mean desc", () => {
    const out: Pick<
      DonePayload,
      "categories" | "members" | "contestants" | "voteDetails"
    > = {
      ...FIXTURE_DATA,
      contestants: [
        ...FIXTURE_DATA.contestants,
        {
          id: "2026-no",
          country: "Norway",
          countryCode: "no",
          flagEmoji: "🇳🇴",
          artist: "A",
          song: "S",
          runningOrder: 2,
          event: "final" as const,
          year: 2026,
        },
      ],
      voteDetails: [
        ...FIXTURE_DATA.voteDetails,
        {
          userId: "u1",
          contestantId: "2026-no",
          scores: { vocals: 3 },
          missed: false,
          pointsAwarded: 2,
          hotTake: null,
          hotTakeEditedAt: null,
        },
      ],
    };
    render(
      <CategoryDrillDownBody
        categoryKey="vocals"
        data={out as DonePayload}
        labels={LABELS}
      />,
    );
    const rows = screen.getAllByTestId("category-drill-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Sweden")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Norway")).toBeInTheDocument();
  });

  it("renders spread sparkline with min/median/max aria-label", () => {
    render(
      <CategoryDrillDownBody
        categoryKey="vocals"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    const sparkline = screen.getByLabelText("Min 5, median 7, max 9 out of 10");
    expect(sparkline).toBeInTheDocument();
  });

  it("renders voter count chip N/M voted", () => {
    render(
      <CategoryDrillDownBody
        categoryKey="vocals"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(screen.getByText("3/3 voted")).toBeInTheDocument();
  });

  it("aggregates: highest + lowest single vote with voter identity", () => {
    render(
      <CategoryDrillDownBody
        categoryKey="vocals"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(screen.getByText("Highest: 9 from Alice")).toBeInTheDocument();
    expect(screen.getByText("Lowest: 5 from Carol")).toBeInTheDocument();
  });

  it("renders empty copy when no votes for the category", () => {
    render(
      <CategoryDrillDownBody
        categoryKey="unknown"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(
      screen.getByText("No room member rated this category."),
    ).toBeInTheDocument();
  });

  it("exposes the title element with the configured id", () => {
    render(
      <CategoryDrillDownBody
        categoryKey="vocals"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(document.getElementById("drill-category-title")).not.toBeNull();
  });
});
