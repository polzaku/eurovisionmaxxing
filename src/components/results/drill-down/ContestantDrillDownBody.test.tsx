// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ContestantDrillDownBody from "@/components/results/drill-down/ContestantDrillDownBody";
import type { ResultsData } from "@/lib/results/loadResults";

type DonePayload = Extract<ResultsData, { status: "done" }>;

const LABELS = {
  titleId: "drill-contestant-title",
  meanLabel: "Mean",
  medianLabel: "Median",
  highestLabel: "Highest",
  lowestLabel: "Lowest",
  weightedScoreLabel: (v: string) => `Weighted ${v}`,
  missedLabel: "Missed",
  editedLabel: "(edited)",
  emptyCopy: "No room member rated this contestant.",
  title: (country: string, points: number) => `${country} — ${points} pts`,
};

const FIXTURE_DATA: Pick<
  DonePayload,
  "categories" | "members" | "contestants" | "leaderboard" | "voteDetails"
> = {
  categories: [
    { name: "vocals", weight: 1, key: "vocals" },
    { name: "music", weight: 1, key: "music" },
  ],
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
      artist: "Artist",
      song: "Song",
      runningOrder: 1,
      event: "final",
      year: 2026,
    },
  ],
  leaderboard: [{ contestantId: "2026-se", totalPoints: 20, rank: 1 }],
  voteDetails: [
    {
      userId: "u1",
      contestantId: "2026-se",
      scores: { vocals: 9, music: 8 },
      missed: false,
      pointsAwarded: 12,
      hotTake: "Banger.",
      hotTakeEditedAt: "2026-05-16T22:00:00Z",
    },
    {
      userId: "u2",
      contestantId: "2026-se",
      scores: { vocals: 6, music: 7 },
      missed: false,
      pointsAwarded: 8,
      hotTake: null,
      hotTakeEditedAt: null,
    },
    {
      userId: "u3",
      contestantId: "2026-se",
      scores: {},
      missed: true,
      pointsAwarded: 0,
      hotTake: null,
      hotTakeEditedAt: null,
    },
  ],
};

describe("<ContestantDrillDownBody>", () => {
  it("renders the contestant header with country, flag, song, total points", () => {
    render(
      <ContestantDrillDownBody
        contestantId="2026-se"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /Sweden.*20.*pts/i }),
    ).toBeInTheDocument();
  });

  it("renders body rows sorted by pointsAwarded desc (12 first, missed last)", () => {
    render(
      <ContestantDrillDownBody
        contestantId="2026-se"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    const rows = screen.getAllByTestId("contestant-drill-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Alice")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Bob")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Carol")).toBeInTheDocument();
  });

  it("missed entries surface the missed label", () => {
    render(
      <ContestantDrillDownBody
        contestantId="2026-se"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    const rows = screen.getAllByTestId("contestant-drill-row");
    expect(within(rows[2]).getByText("Missed")).toBeInTheDocument();
  });

  it("aggregates show mean / median / highest / lowest using non-missed scoring", () => {
    render(
      <ContestantDrillDownBody
        contestantId="2026-se"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    // Alice 8.5, Bob 6.5 → mean 7.5, median 7.5, highest Alice 8.5, lowest Bob 6.5.
    expect(screen.getByText("Mean")).toBeInTheDocument();
    expect(screen.getByText("Median")).toBeInTheDocument();
    expect(screen.getByText("Highest")).toBeInTheDocument();
    expect(screen.getByText("Lowest")).toBeInTheDocument();
    // The two 7.5 cells (mean + median) plus the 8.5 / 6.5 actor values
    // are all present — non-strict assertion since multiple cells share digits.
    expect(screen.getAllByText("7.5").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("8.5").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("6.5").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the edited tag on hot takes with hotTakeEditedAt", () => {
    render(
      <ContestantDrillDownBody
        contestantId="2026-se"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    const aliceRow = screen.getAllByTestId("contestant-drill-row")[0];
    expect(within(aliceRow).getByText(/Banger\./)).toBeInTheDocument();
    expect(within(aliceRow).getByText("(edited)")).toBeInTheDocument();
  });

  it("renders the empty copy when nobody rated the contestant", () => {
    render(
      <ContestantDrillDownBody
        contestantId="2026-nope"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(
      screen.getByText("No room member rated this contestant."),
    ).toBeInTheDocument();
  });

  it("exposes the title element with the configured id (for aria-labelledby)", () => {
    render(
      <ContestantDrillDownBody
        contestantId="2026-se"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(document.getElementById("drill-contestant-title")).not.toBeNull();
  });
});
