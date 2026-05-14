// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DrillDownClient from "@/app/results/[id]/DrillDownClient";
import type { ResultsData } from "@/lib/results/loadResults";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => {
    return (key: string, params?: Record<string, unknown>) => {
      const full = ns ? `${ns}.${key}` : key;
      if (params) {
        return Object.entries(params).reduce(
          (s, [k, v]) => s.replace(`{${k}}`, String(v)),
          full,
        );
      }
      return full;
    };
  },
}));

// HotTakesSection imports session lookup; stub to avoid auth wiring in the test.
vi.mock("@/lib/session", () => ({
  getSession: () => null,
  readSession: () => null,
}));

type DonePayload = Extract<ResultsData, { status: "done" }>;

const DATA: DonePayload = {
  status: "done",
  year: 2026,
  event: "final",
  pin: "TESTPN",
  ownerUserId: "u1",
  categories: [{ name: "vocals", weight: 1, key: "vocals" }],
  leaderboard: [{ contestantId: "2026-se", totalPoints: 12, rank: 1 }],
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
  breakdowns: [
    {
      userId: "u1",
      displayName: "Alice",
      avatarSeed: "alice",
      picks: [{ contestantId: "2026-se", pointsAwarded: 12 }],
    },
  ],
  contestantBreakdowns: [
    {
      contestantId: "2026-se",
      gives: [
        {
          userId: "u1",
          displayName: "Alice",
          avatarSeed: "alice",
          pointsAwarded: 12,
        },
      ],
    },
  ],
  hotTakes: [],
  awards: [
    {
      roomId: "r",
      awardKey: "best_vocals",
      awardName: "Best Vocals",
      winnerUserId: null,
      winnerUserIdB: null,
      winnerContestantId: "2026-se",
      statValue: 8.5,
      statLabel: "mean",
    },
  ],
  personalNeighbours: [],
  members: [{ userId: "u1", displayName: "Alice", avatarSeed: "alice" }],
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
  ],
};

// The mock translator above returns the namespaced key path (with param
// substitutions). Assertions match those key paths rather than English copy.

describe("<DrillDownClient>", () => {
  it("opens the contestant sheet when the leaderboard 'Full breakdown' link is clicked", async () => {
    const user = userEvent.setup();
    render(<DrillDownClient data={DATA} roomId="r1" />);
    const summary = document.querySelector("summary") as HTMLElement;
    await user.click(summary);
    const details = summary.parentElement as HTMLDetailsElement;
    await user.click(
      within(details).getByRole("button", {
        name: "results.drillDown.contestant.openLink",
      }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens the participant sheet when an avatar button is clicked", async () => {
    const user = userEvent.setup();
    render(<DrillDownClient data={DATA} roomId="r1" />);
    // openAria label resolves to "results.drillDown.participant.openAria"
    // with {name} substituted to "Alice".
    await user.click(
      screen.getByRole("button", {
        name: /results\.drillDown\.participant\.openAria/,
      }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens the category sheet when the 'Full ranking' link is clicked", async () => {
    const user = userEvent.setup();
    render(<DrillDownClient data={DATA} roomId="r1" />);
    await user.click(
      screen.getByRole("button", {
        name: "results.drillDown.category.openLink",
      }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("only one sheet open at a time — opening B closes A", async () => {
    const user = userEvent.setup();
    render(<DrillDownClient data={DATA} roomId="r1" />);
    await user.click(
      screen.getByRole("button", {
        name: /results\.drillDown\.participant\.openAria/,
      }),
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.keyDown(document, { key: "Escape" });
    await user.click(
      screen.getByRole("button", {
        name: "results.drillDown.category.openLink",
      }),
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("closing a sheet via the X button removes it from the DOM", async () => {
    const user = userEvent.setup();
    render(<DrillDownClient data={DATA} roomId="r1" />);
    await user.click(
      screen.getByRole("button", {
        name: /results\.drillDown\.participant\.openAria/,
      }),
    );
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", {
        name: "results.drillDown.common.closeAria",
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
