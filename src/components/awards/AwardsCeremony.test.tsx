// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import AwardsCeremony from "./AwardsCeremony";
import type { CeremonyCard } from "@/lib/awards/awardCeremonySequence";

const SEQ: CeremonyCard[] = [
  {
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
  },
  {
    kind: "user",
    award: {
      roomId: "r",
      awardKey: "the_enabler",
      awardName: "The enabler",
      winnerUserId: "u1",
      winnerUserIdB: null,
      winnerContestantId: null,
      statValue: null,
      statLabel: null,
    },
    winner: { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
    partner: null,
  },
];

describe("AwardsCeremony", () => {
  it("starts on the first card", () => {
    render(<AwardsCeremony sequence={SEQ} onAllRevealed={() => {}} />);
    // Category awards now route through awards.bestCategory; the locale
    // mock appends params, so we match the key path.
    expect(screen.getByText(/awards\.bestCategory/)).toBeInTheDocument();
    expect(
      screen.queryByText(/awards\.personality\.the_enabler\.name/),
    ).toBeNull();
  });

  it("advances to the next card via the corner Next button", async () => {
    const user = userEvent.setup();
    render(<AwardsCeremony sequence={SEQ} onAllRevealed={() => {}} />);
    await user.click(screen.getByTestId("awards-next-button"));
    expect(
      screen.getByText(/awards\.personality\.the_enabler\.name/),
    ).toBeInTheDocument();
  });

  it("advances via the tap-anywhere zone", async () => {
    const user = userEvent.setup();
    render(<AwardsCeremony sequence={SEQ} onAllRevealed={() => {}} />);
    await user.click(screen.getByTestId("awards-tap-zone"));
    expect(
      screen.getByText(/awards\.personality\.the_enabler\.name/),
    ).toBeInTheDocument();
  });

  it("fires onAllRevealed exactly once after advancing past the last card", async () => {
    const user = userEvent.setup();
    const onAllRevealed = vi.fn();
    render(<AwardsCeremony sequence={SEQ} onAllRevealed={onAllRevealed} />);
    await user.click(screen.getByTestId("awards-tap-zone"));
    expect(onAllRevealed).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("awards-tap-zone"));
    expect(onAllRevealed).toHaveBeenCalledTimes(1);
    // Further clicks are no-ops.
    await user.click(screen.getByTestId("awards-tap-zone"));
    expect(onAllRevealed).toHaveBeenCalledTimes(1);
  });

  it("renders nothing visible and immediately fires onAllRevealed when sequence is empty", () => {
    const onAllRevealed = vi.fn();
    render(<AwardsCeremony sequence={[]} onAllRevealed={onAllRevealed} />);
    expect(onAllRevealed).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("awards-tap-zone")).toBeNull();
  });

  it("Next button label includes the i / N progress counter", () => {
    render(<AwardsCeremony sequence={SEQ} onAllRevealed={() => {}} />);
    expect(screen.getByTestId("awards-next-button")).toHaveTextContent(
      "1 / 2",
    );
  });

  it("advances on Space keypress", async () => {
    const user = userEvent.setup();
    render(<AwardsCeremony sequence={SEQ} onAllRevealed={() => {}} />);
    await user.keyboard(" ");
    expect(
      screen.getByText(/awards\.personality\.the_enabler\.name/),
    ).toBeInTheDocument();
  });
});
