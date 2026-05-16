// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) =>
    (key: string, params?: Record<string, unknown>) => {
      const full = namespace ? `${namespace}.${key}` : key;
      return params ? `${full}:${JSON.stringify(params)}` : full;
    },
}));

import PeekPicksButton from "./PeekPicksButton";
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
];

const PICKS = [
  { contestantId: "2026-se", pointsAwarded: 12 },
  { contestantId: "2026-fr", pointsAwarded: 1 },
];

describe("<PeekPicksButton>", () => {
  it("renders the button labelled with the peek copy; sheet starts closed", () => {
    render(<PeekPicksButton picks={PICKS} contestants={CONTESTANTS} />);
    const btn = screen.getByTestId("peek-picks-button");
    expect(btn).toHaveTextContent("announcing.peek.button");
    expect(screen.queryByTestId("peek-picks-sheet")).not.toBeInTheDocument();
  });

  it("opens the sheet on click, listing the picks", async () => {
    render(<PeekPicksButton picks={PICKS} contestants={CONTESTANTS} />);
    await userEvent.click(screen.getByTestId("peek-picks-button"));
    expect(screen.getByTestId("peek-picks-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("user-picks-list")).toBeInTheDocument();
    expect(screen.getByTestId("user-pick-2026-se")).toHaveTextContent("12");
    expect(screen.getByTestId("user-pick-2026-fr")).toHaveTextContent("1");
  });

  it("dismisses the sheet on close-button click", async () => {
    render(<PeekPicksButton picks={PICKS} contestants={CONTESTANTS} />);
    await userEvent.click(screen.getByTestId("peek-picks-button"));
    await userEvent.click(screen.getByTestId("peek-picks-close"));
    expect(screen.queryByTestId("peek-picks-sheet")).not.toBeInTheDocument();
  });

  it("dismisses the sheet on ESC keypress", async () => {
    render(<PeekPicksButton picks={PICKS} contestants={CONTESTANTS} />);
    await userEvent.click(screen.getByTestId("peek-picks-button"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("peek-picks-sheet")).not.toBeInTheDocument();
  });

  it("renders the empty state inside the sheet when picks=[]", async () => {
    render(<PeekPicksButton picks={[]} contestants={CONTESTANTS} />);
    await userEvent.click(screen.getByTestId("peek-picks-button"));
    expect(screen.getByTestId("user-picks-list-empty")).toBeInTheDocument();
  });
});
