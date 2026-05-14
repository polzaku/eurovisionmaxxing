// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ParticipantDrillDownBody from "@/components/results/drill-down/ParticipantDrillDownBody";
import type { ResultsData } from "@/lib/results/loadResults";

type DonePayload = Extract<ResultsData, { status: "done" }>;

const LABELS = {
  titleId: "drill-participant-title",
  title: (name: string) => `${name}'s vote`,
  totalAwardedLabel: (points: number) => `${points} pts given`,
  hotTakeCountLabel: (count: number) =>
    `${count} hot ${count === 1 ? "take" : "takes"}`,
  meanLabel: "Mean",
  harshnessLabel: (value: string) => `Harshness ${value}`,
  alignmentLabel: (value: string) => `Alignment ${value}`,
  weightedScoreLabel: (v: string) => `Weighted ${v}`,
  missedLabel: "Missed",
  editedLabel: "(edited)",
  emptyCopy: "This user did not vote on any contestant.",
};

const FIXTURE_DATA: Pick<
  DonePayload,
  "categories" | "members" | "contestants" | "leaderboard" | "voteDetails"
> = {
  categories: [{ name: "vocals", weight: 1, key: "vocals" }],
  members: [
    { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
    { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
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
    {
      id: "2026-no",
      country: "Norway",
      countryCode: "no",
      flagEmoji: "🇳🇴",
      artist: "A",
      song: "S",
      runningOrder: 2,
      event: "final",
      year: 2026,
    },
  ],
  leaderboard: [
    { contestantId: "2026-se", totalPoints: 20, rank: 1 },
    { contestantId: "2026-no", totalPoints: 10, rank: 2 },
  ],
  voteDetails: [
    {
      userId: "u1",
      contestantId: "2026-se",
      scores: { vocals: 9 },
      missed: false,
      pointsAwarded: 12,
      hotTake: "Best of the night.",
      hotTakeEditedAt: null,
    },
    {
      userId: "u1",
      contestantId: "2026-no",
      scores: { vocals: 5 },
      missed: false,
      pointsAwarded: 8,
      hotTake: null,
      hotTakeEditedAt: null,
    },
    {
      userId: "u2",
      contestantId: "2026-se",
      scores: { vocals: 4 },
      missed: false,
      pointsAwarded: 8,
      hotTake: null,
      hotTakeEditedAt: null,
    },
    {
      userId: "u2",
      contestantId: "2026-no",
      scores: { vocals: 8 },
      missed: false,
      pointsAwarded: 2,
      hotTake: null,
      hotTakeEditedAt: null,
    },
  ],
};

describe("<ParticipantDrillDownBody>", () => {
  it("renders the participant header with name and total points awarded", () => {
    render(
      <ParticipantDrillDownBody
        userId="u1"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /Alice's vote/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/20 pts given/)).toBeInTheDocument();
  });

  it("renders body rows sorted by the user's weighted score desc", () => {
    render(
      <ParticipantDrillDownBody
        userId="u1"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    const rows = screen.getAllByTestId("participant-drill-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Sweden")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Norway")).toBeInTheDocument();
  });

  it("aggregates: harshness prefixed with sign (negative = harsher than room)", () => {
    render(
      <ParticipantDrillDownBody
        userId="u2"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(screen.getByText(/Harshness -0\.5/)).toBeInTheDocument();
  });

  it("aggregates: alignment 1.0 for a user perfectly aligned with the room", () => {
    render(
      <ParticipantDrillDownBody
        userId="u1"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(screen.getByText(/Alignment 1\.0/)).toBeInTheDocument();
  });

  it("renders empty copy when user has no votes", () => {
    render(
      <ParticipantDrillDownBody
        userId="u-nope"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(
      screen.getByText("This user did not vote on any contestant."),
    ).toBeInTheDocument();
  });

  it("exposes the title element with the configured id", () => {
    render(
      <ParticipantDrillDownBody
        userId="u1"
        data={FIXTURE_DATA as DonePayload}
        labels={LABELS}
      />,
    );
    expect(document.getElementById("drill-participant-title")).not.toBeNull();
  });

  it("renders the hot take with the edited tag when applicable", () => {
    render(
      <ParticipantDrillDownBody
        userId="u1"
        data={{
          ...FIXTURE_DATA,
          voteDetails: [
            {
              ...FIXTURE_DATA.voteDetails[0],
              hotTake: "Edited!",
              hotTakeEditedAt: "2026-05-16T22:00:00Z",
            },
            FIXTURE_DATA.voteDetails[1],
          ],
        } as DonePayload}
        labels={LABELS}
      />,
    );
    const sweden = screen.getAllByTestId("participant-drill-row")[0];
    expect(within(sweden).getByText(/Edited!/)).toBeInTheDocument();
    expect(within(sweden).getByText("(edited)")).toBeInTheDocument();
  });
});
