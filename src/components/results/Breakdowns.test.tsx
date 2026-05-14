// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import Breakdowns from "@/components/results/Breakdowns";
import type { Contestant } from "@/types";

const BREAKDOWNS = [
  {
    userId: "u1",
    displayName: "Alice",
    avatarSeed: "alice",
    picks: [
      { contestantId: "2026-se", pointsAwarded: 12 },
      { contestantId: "2026-no", pointsAwarded: 8 },
    ],
  },
  {
    userId: "u2",
    displayName: "Bob",
    avatarSeed: "bob",
    picks: [{ contestantId: "2026-no", pointsAwarded: 12 }],
  },
];

const CONTESTANTS: Contestant[] = [
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
];

const LABELS = {
  title: "Per-voter breakdowns",
  picksLabel: (n: number) => `${n} picks`,
  openParticipantAria: (name: string) => `Open ${name}'s full vote`,
};

describe("<Breakdowns>", () => {
  it("renders one <details> per user (via stable testid)", () => {
    render(
      <Breakdowns
        breakdowns={BREAKDOWNS}
        contestants={CONTESTANTS}
        labels={LABELS}
      />,
    );
    expect(screen.getByTestId("breakdown-u1")).toBeInTheDocument();
    expect(screen.getByTestId("breakdown-u2")).toBeInTheDocument();
  });

  it("renders an avatar button inside each summary with the correct aria-label", () => {
    render(
      <Breakdowns
        breakdowns={BREAKDOWNS}
        contestants={CONTESTANTS}
        labels={LABELS}
        onOpenParticipant={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Open Alice's full vote" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Bob's full vote" }),
    ).toBeInTheDocument();
  });

  it("avatar click calls onOpenParticipant(userId) and does not toggle <details>", () => {
    const onOpen = vi.fn();
    render(
      <Breakdowns
        breakdowns={BREAKDOWNS}
        contestants={CONTESTANTS}
        labels={LABELS}
        onOpenParticipant={onOpen}
      />,
    );
    const details = screen.getByTestId("breakdown-u1") as HTMLDetailsElement;
    const wasOpen = details.open;
    const button = within(details).getByRole("button", {
      name: "Open Alice's full vote",
    });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith("u1");
    expect(details.open).toBe(wasOpen);
  });

  it("clicking the summary text toggles <details>", () => {
    render(
      <Breakdowns
        breakdowns={BREAKDOWNS}
        contestants={CONTESTANTS}
        labels={LABELS}
      />,
    );
    const details = screen.getByTestId("breakdown-u1") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(details.querySelector("summary")!);
    expect(details.open).toBe(true);
  });

  it("renders picks inside the opened details", () => {
    render(
      <Breakdowns
        breakdowns={BREAKDOWNS}
        contestants={CONTESTANTS}
        labels={LABELS}
      />,
    );
    const details = screen.getByTestId("breakdown-u1") as HTMLDetailsElement;
    fireEvent.click(details.querySelector("summary")!);
    expect(within(details).getByText("Sweden")).toBeInTheDocument();
    expect(within(details).getByText("Norway")).toBeInTheDocument();
  });
});
