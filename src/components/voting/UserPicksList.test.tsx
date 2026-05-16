// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import UserPicksList from "./UserPicksList";
import type { Contestant } from "@/types";

function mk(code: string, country: string, song: string): Contestant {
  return {
    id: `2026-${code}`,
    year: 2026,
    event: "final",
    countryCode: code,
    country,
    artist: "A",
    song,
    flagEmoji: `flag-${code}`,
    runningOrder: 1,
  };
}

const CONTESTANTS: Contestant[] = [
  mk("se", "Sweden", "Swedish Banger"),
  mk("fr", "France", "Le Banger"),
  mk("ua", "Ukraine", "Banger UA"),
];

describe("<UserPicksList>", () => {
  it("renders one row per pick, sorted desc by pointsAwarded", () => {
    const picks = [
      { contestantId: "2026-se", pointsAwarded: 1 },
      { contestantId: "2026-fr", pointsAwarded: 12 },
      { contestantId: "2026-ua", pointsAwarded: 8 },
    ];
    render(<UserPicksList picks={picks} contestants={CONTESTANTS} />);
    const rows = screen.getAllByTestId(/^user-pick-/);
    expect(rows).toHaveLength(3);
    // Sorted desc: France (12) first, Ukraine (8), Sweden (1) last.
    expect(rows[0]).toHaveTextContent("France");
    expect(rows[0]).toHaveTextContent("12");
    expect(rows[1]).toHaveTextContent("Ukraine");
    expect(rows[1]).toHaveTextContent("8");
    expect(rows[2]).toHaveTextContent("Sweden");
    expect(rows[2]).toHaveTextContent("1");
  });

  it("renders the empty state when picks is empty", () => {
    render(<UserPicksList picks={[]} contestants={CONTESTANTS} />);
    expect(screen.getByTestId("user-picks-list-empty")).toBeInTheDocument();
  });

  it("includes the country flag emoji + song title for each pick", () => {
    const picks = [{ contestantId: "2026-se", pointsAwarded: 12 }];
    render(<UserPicksList picks={picks} contestants={CONTESTANTS} />);
    const row = screen.getByTestId("user-pick-2026-se");
    expect(row).toHaveTextContent("flag-se");
    expect(row).toHaveTextContent("Sweden");
    expect(row).toHaveTextContent("Swedish Banger");
  });

  it("falls back to the contestantId when the contestant is unknown", () => {
    const picks = [{ contestantId: "2026-xx", pointsAwarded: 7 }];
    render(<UserPicksList picks={picks} contestants={CONTESTANTS} />);
    const row = screen.getByTestId("user-pick-2026-xx");
    expect(row).toHaveTextContent("2026-xx");
    expect(row).toHaveTextContent("🏳️");
  });
});
