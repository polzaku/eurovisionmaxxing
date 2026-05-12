// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/session", () => ({
  getSession: () => null,
}));

import AwardsSection from "./AwardsSection";
import type { Contestant, RoomAward } from "@/types";
import type { PersonalNeighbour } from "@/lib/awards/buildPersonalNeighbours";

const labels = {
  sectionHeading: "Awards",
  categoryHeading: "Best in category",
  personalityHeading: "And the room said…",
  jointCaption: "joint winners",
  neighbourhoodCaption: "voted most alike",
};

const contestant = (id: string, country: string, flag: string): Contestant => ({
  id,
  country,
  countryCode: id.slice(-2),
  flagEmoji: flag,
  artist: "A",
  song: "S",
  runningOrder: 1,
  event: "final",
  year: 2026,
});

const member = (userId: string, displayName: string) => ({
  userId,
  displayName,
  avatarSeed: `seed-${userId}`,
});

const userAward = (
  awardKey: string,
  awardName: string,
  winnerUserId: string,
  partner?: string,
): RoomAward => ({
  roomId: "r-1",
  awardKey,
  awardName,
  winnerUserId,
  winnerUserIdB: partner ?? null,
  winnerContestantId: null,
  statValue: null,
  statLabel: null,
});

const contestantAward = (
  awardKey: string,
  awardName: string,
  cid: string,
): RoomAward => ({
  roomId: "r-1",
  awardKey,
  awardName,
  winnerUserId: null,
  winnerUserIdB: null,
  winnerContestantId: cid,
  statValue: null,
  statLabel: null,
});

describe("<AwardsSection> — explainer disclosure", () => {
  it("renders an explainer toggle on each personality award card", () => {
    render(
      <AwardsSection
        awards={[
          userAward("biggest_stan", "Biggest stan", "u-1"),
          userAward("harshest_critic", "Harshest critic", "u-2"),
        ]}
        contestants={[]}
        members={[member("u-1", "Alice"), member("u-2", "Bob")]}
        labels={labels}
      />,
    );
    const toggles = screen.getAllByText(/what does this mean\?/i);
    expect(toggles).toHaveLength(2);
  });

  it("does NOT render an explainer toggle on category award cards", () => {
    render(
      <AwardsSection
        awards={[
          contestantAward("best_vocals", "Best Vocals", "2026-it"),
          contestantAward("best_outfit", "Best Outfit", "2026-fr"),
        ]}
        contestants={[
          contestant("2026-it", "Italy", "🇮🇹"),
          contestant("2026-fr", "France", "🇫🇷"),
        ]}
        members={[]}
        labels={labels}
      />,
    );
    expect(screen.queryByText(/what does this mean\?/i)).toBeNull();
  });

  it("renders an explainer toggle on the dark-horse contestant card (personality, not category)", () => {
    render(
      <AwardsSection
        awards={[
          contestantAward("the_dark_horse", "The dark horse", "2026-it"),
        ]}
        contestants={[contestant("2026-it", "Italy", "🇮🇹")]}
        members={[]}
        labels={labels}
      />,
    );
    expect(screen.getByText(/what does this mean\?/i)).toBeInTheDocument();
  });

  it("expands the explainer body when the toggle is clicked", async () => {
    render(
      <AwardsSection
        awards={[userAward("hive_mind_master", "Hive mind master", "u-1")]}
        contestants={[]}
        members={[member("u-1", "Alice")]}
        labels={labels}
      />,
    );
    // Body text is in the DOM but the <details> is closed by default.
    const explainer = screen.getByText(/lined up most closely/i);
    expect(explainer.closest("details")).not.toHaveAttribute("open");
    await userEvent.click(screen.getByText(/what does this mean\?/i));
    expect(explainer.closest("details")).toHaveAttribute("open");
  });

  it("each personality card's explainer is independent (clicking one does not open another)", async () => {
    render(
      <AwardsSection
        awards={[
          userAward("biggest_stan", "Biggest stan", "u-1"),
          userAward("harshest_critic", "Harshest critic", "u-2"),
        ]}
        contestants={[]}
        members={[member("u-1", "Alice"), member("u-2", "Bob")]}
        labels={labels}
      />,
    );
    const allToggles = screen.getAllByText(/what does this mean\?/i);
    await userEvent.click(allToggles[0]);
    const allDetails = document.querySelectorAll("details");
    expect(allDetails[0]).toHaveAttribute("open");
    expect(allDetails[1]).not.toHaveAttribute("open");
  });

  it("renders the dual-avatar caption for Neighbourhood voters with explainer below", () => {
    const { container } = render(
      <AwardsSection
        awards={[
          userAward("neighbourhood_voters", "Neighbourhood voters", "u-1", "u-2"),
        ]}
        contestants={[]}
        members={[member("u-1", "Alice"), member("u-2", "Bob")]}
        labels={labels}
      />,
    );
    // The "voted most alike" caption appears in the truncated subtitle, and a
    // longer phrase containing it appears inside the explainer body.
    expect(
      screen.getByText(/Alice & Bob · voted most alike/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/what does this mean\?/i)).toBeInTheDocument();
    // Dual-avatar layout sanity check — expect two avatars in the card.
    const card = container.querySelector("li") as HTMLElement;
    expect(within(card).getAllByRole("img").length).toBeGreaterThanOrEqual(2);
  });
});

describe("<AwardsSection> — YourNeighbourCard slot", () => {
  it("renders YourNeighbourCard slot immediately after neighbourhood_voters when personalNeighbours is provided", () => {
    // Note: <YourNeighbourCard> renders nothing without a matching session;
    // we assert ordering by testid presence on the wrapper <li> instead.
    const members = [
      { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
      { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
    ];
    const personalNeighbours: PersonalNeighbour[] = [
      { userId: "u1", neighbourUserId: "u2", pearson: 0.9, isReciprocal: true },
    ];
    render(
      <AwardsSection
        awards={[
          {
            roomId: "r",
            awardKey: "neighbourhood_voters",
            awardName: "Neighbourhood voters",
            winnerUserId: "u1",
            winnerUserIdB: "u2",
            winnerContestantId: null,
            statValue: null,
            statLabel: null,
          },
          {
            roomId: "r",
            awardKey: "the_dark_horse",
            awardName: "The dark horse",
            winnerUserId: null,
            winnerUserIdB: null,
            winnerContestantId: "2026-SE",
            statValue: null,
            statLabel: null,
          },
        ]}
        contestants={[
          {
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
        ]}
        members={members}
        personalNeighbours={personalNeighbours}
        labels={{
          sectionHeading: "Awards",
          categoryHeading: "Best in category",
          personalityHeading: "And the room said…",
          jointCaption: "joint winners",
          neighbourhoodCaption: "voted most alike",
        }}
      />,
    );
    const slot = screen.getByTestId("your-neighbour-slot");
    expect(slot).toBeInTheDocument();
    // Slot must sit immediately after the neighbourhood_voters card in the
    // personality list, before the_dark_horse.
    const items = Array.from(
      slot.parentElement?.querySelectorAll(":scope > li") ?? [],
    );
    const idxOfPair = items.findIndex(
      (li) => li.textContent?.includes("Neighbourhood voters") ?? false,
    );
    const idxOfSlot = items.indexOf(slot);
    const idxOfHorse = items.findIndex(
      (li) => li.textContent?.includes("The dark horse") ?? false,
    );
    expect(idxOfSlot).toBe(idxOfPair + 1);
    expect(idxOfHorse).toBe(idxOfSlot + 1);
  });

  it("does not render the slot when personalNeighbours is undefined", () => {
    render(
      <AwardsSection
        awards={[
          {
            roomId: "r",
            awardKey: "neighbourhood_voters",
            awardName: "Neighbourhood voters",
            winnerUserId: "u1",
            winnerUserIdB: "u2",
            winnerContestantId: null,
            statValue: null,
            statLabel: null,
          },
        ]}
        contestants={[]}
        members={[
          { userId: "u1", displayName: "Alice", avatarSeed: "alice" },
          { userId: "u2", displayName: "Bob", avatarSeed: "bob" },
        ]}
        labels={{
          sectionHeading: "Awards",
          categoryHeading: "Best in category",
          personalityHeading: "And the room said…",
          jointCaption: "joint winners",
          neighbourhoodCaption: "voted most alike",
        }}
      />,
    );
    expect(screen.queryByTestId("your-neighbour-slot")).not.toBeInTheDocument();
  });
});
