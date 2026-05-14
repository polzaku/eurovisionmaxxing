// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

vi.mock("@/hooks/useWakeLock", () => ({
  useWakeLock: () => undefined,
}));

import VotingView from "./VotingView";
import type { Contestant, VotingCategory } from "@/types";

const categories: VotingCategory[] = [
  { name: "Vocals", weight: 1, hint: "" },
];

const contestants: Contestant[] = [
  {
    id: "2026-se",
    country: "Sweden",
    countryCode: "SE",
    flagEmoji: "🇸🇪",
    artist: "Artist",
    song: "Song",
    runningOrder: 1,
  } as Contestant,
];

describe("VotingView — host End Voting CTA placement", () => {
  it("does not render the End Voting button at all when onEndVoting is undefined", () => {
    render(
      <VotingView
        contestants={contestants}
        categories={categories}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /voting.endVoting/i }),
    ).toBeNull();
  });

  it("renders the End Voting button OUTSIDE the page header when onEndVoting is provided", () => {
    render(
      <VotingView
        contestants={contestants}
        categories={categories}
        onEndVoting={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", {
      name: /voting\.endVoting\.buttonAria/,
    });
    // The button must not be a descendant of any <header> element — that
    // header is where the locale switcher + theme toggle sit on the page
    // chrome, and the End Voting CTA overlapped them. See SPEC §8.1.
    expect(button.closest("header")).toBeNull();
  });

  it("renders the End Voting button AFTER the nav footer in DOM order", () => {
    render(
      <VotingView
        contestants={contestants}
        categories={categories}
        onEndVoting={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", {
      name: /voting\.endVoting\.buttonAria/,
    });
    const nav = button
      .closest("main")
      ?.querySelector("nav.grid.grid-cols-4");
    expect(nav).not.toBeNull();
    // Bitmask comparison: DOCUMENT_POSITION_FOLLOWING === 0x04 → button
    // follows the nav element in document order.
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    // eslint-disable-next-line no-bitwise
    expect(nav!.compareDocumentPosition(button) & FOLLOWING).toBeTruthy();
  });
});
