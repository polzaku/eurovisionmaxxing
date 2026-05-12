// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import JumpToDrawer from "./JumpToDrawer";

// jsdom doesn't implement Element.prototype.scrollIntoView; the drawer
// auto-scrolls the current row into view on open. Stub it.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
import type { Contestant } from "@/types";

function mkContestant(
  id: string,
  country: string,
  song: string,
  runningOrder: number,
): Contestant {
  return {
    id,
    year: 2026,
    event: "final",
    countryCode: id.split("-")[1] ?? "xx",
    country,
    artist: "A",
    song,
    flagEmoji: "🏳️",
    runningOrder,
  };
}

const CONTESTANTS = [
  mkContestant("2026-se", "Sweden", "Track A", 1),
  mkContestant("2026-ua", "Ukraine", "Track B", 2),
  mkContestant("2026-fr", "France", "Track C", 3),
];

const CATEGORIES = ["Vocals", "Outfit"] as const;

describe("JumpToDrawer", () => {
  it("returns null when isOpen is false (no overlay rendered)", () => {
    const { container } = render(
      <JumpToDrawer
        isOpen={false}
        contestants={CONTESTANTS}
        currentContestantId="2026-se"
        scoresByContestant={{}}
        missedByContestant={{}}
        categoryNames={CATEGORIES}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.textContent ?? "").toBe("");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the dialog + a row per contestant when open", () => {
    render(
      <JumpToDrawer
        isOpen
        contestants={CONTESTANTS}
        currentContestantId="2026-se"
        scoresByContestant={{}}
        missedByContestant={{}}
        categoryNames={CATEGORIES}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Sweden")).toBeInTheDocument();
    expect(screen.getByText("Ukraine")).toBeInTheDocument();
    expect(screen.getByText("France")).toBeInTheDocument();
  });

  it("renders the 'status.unscored' status pill for unscored rows", () => {
    render(
      <JumpToDrawer
        isOpen
        contestants={CONTESTANTS}
        currentContestantId="2026-se"
        scoresByContestant={{}}
        missedByContestant={{}}
        categoryNames={CATEGORIES}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByText("status.unscored").length).toBe(3);
  });

  it("renders the 'status.scored' status pill for fully-scored rows", () => {
    render(
      <JumpToDrawer
        isOpen
        contestants={CONTESTANTS}
        currentContestantId="2026-se"
        scoresByContestant={{
          "2026-se": { Vocals: 8, Outfit: 7 },
        }}
        missedByContestant={{}}
        categoryNames={CATEGORIES}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("status.scored")).toBeInTheDocument();
    // The other two rows remain unscored.
    expect(screen.getAllByText("status.unscored").length).toBe(2);
  });

  it("renders the 'status.missed' status pill for missed rows", () => {
    render(
      <JumpToDrawer
        isOpen
        contestants={CONTESTANTS}
        currentContestantId="2026-se"
        scoresByContestant={{}}
        missedByContestant={{ "2026-ua": true }}
        categoryNames={CATEGORIES}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("status.missed")).toBeInTheDocument();
  });

  it("highlights the current row with the muted background", () => {
    const { container } = render(
      <JumpToDrawer
        isOpen
        contestants={CONTESTANTS}
        currentContestantId="2026-ua"
        scoresByContestant={{}}
        missedByContestant={{}}
        categoryNames={CATEGORIES}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const rows = container.querySelectorAll("ol > li, ul > li");
    // Find the row whose text contains "Ukraine" (the current).
    const currentRow = Array.from(rows).find((li) =>
      (li.textContent ?? "").includes("Ukraine"),
    );
    expect(currentRow?.className).toContain("bg-muted");
  });

  it("fires onSelect with the tapped contestantId", () => {
    const onSelect = vi.fn();
    render(
      <JumpToDrawer
        isOpen
        contestants={CONTESTANTS}
        currentContestantId="2026-se"
        scoresByContestant={{}}
        missedByContestant={{}}
        categoryNames={CATEGORIES}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Ukraine"));
    expect(onSelect).toHaveBeenCalledWith("2026-ua");
  });

  it("fires onClose when the × close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <JumpToDrawer
        isOpen
        contestants={CONTESTANTS}
        currentContestantId="2026-se"
        scoresByContestant={{}}
        missedByContestant={{}}
        categoryNames={CATEGORIES}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /closeAria/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fires onClose on Escape keypress", () => {
    const onClose = vi.fn();
    render(
      <JumpToDrawer
        isOpen
        contestants={CONTESTANTS}
        currentContestantId="2026-se"
        scoresByContestant={{}}
        missedByContestant={{}}
        categoryNames={CATEGORIES}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT close on other keys", () => {
    const onClose = vi.fn();
    render(
      <JumpToDrawer
        isOpen
        contestants={CONTESTANTS}
        currentContestantId="2026-se"
        scoresByContestant={{}}
        missedByContestant={{}}
        categoryNames={CATEGORIES}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: " " });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders the §8.8 ScoredByChip on each row when roomMemberTotal is set", () => {
    render(
      <JumpToDrawer
        isOpen
        contestants={CONTESTANTS}
        currentContestantId="2026-se"
        scoresByContestant={{}}
        missedByContestant={{}}
        categoryNames={CATEGORIES}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        scoredByCounts={{ "2026-se": 2, "2026-ua": 0, "2026-fr": 3 }}
        roomMemberTotal={3}
      />,
    );
    // §8.8 chips: 2/3, 0/3, ✓ all scored.
    expect(screen.getByText(/2 \/ 3/)).toBeInTheDocument();
    expect(screen.getByText(/0 \/ 3/)).toBeInTheDocument();
    expect(screen.getByText(/voting.scoredChip.all/)).toBeInTheDocument();
  });

  it("does NOT render the §8.8 chip when roomMemberTotal is 0 or undefined", () => {
    render(
      <JumpToDrawer
        isOpen
        contestants={CONTESTANTS}
        currentContestantId="2026-se"
        scoresByContestant={{}}
        missedByContestant={{}}
        categoryNames={CATEGORIES}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText(/voting.scoredChip/)).toBeNull();
    expect(screen.queryByTestId("scored-by-chip")).toBeNull();
  });
});
