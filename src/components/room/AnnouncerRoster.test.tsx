// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/ui/Avatar", () => ({
  default: ({ seed }: { seed: string }) => (
    <span data-testid="avatar" data-seed={seed} />
  ),
}));

import AnnouncerRoster, { type RosterMember } from "./AnnouncerRoster";

const ALICE: RosterMember = {
  userId: "u-alice",
  displayName: "Alice",
  avatarSeed: "seed-alice",
};
const BOB: RosterMember = {
  userId: "u-bob",
  displayName: "Bob",
  avatarSeed: "seed-bob",
};
const CAROL: RosterMember = {
  userId: "u-carol",
  displayName: "Carol",
  avatarSeed: "seed-carol",
};

describe("<AnnouncerRoster>", () => {
  it("renders nothing when there are no members", () => {
    const { container } = render(
      <AnnouncerRoster members={[]} presenceUserIds={new Set()} />,
    );
    // Empty roster collapses entirely — no panel chrome to clutter the
    // owner's screen on rooms with degenerate empty memberships.
    expect(container.firstChild).toBeNull();
  });

  it("renders one row per member with name + avatar", () => {
    render(
      <AnnouncerRoster
        members={[ALICE, BOB, CAROL]}
        presenceUserIds={new Set()}
      />,
    );
    expect(screen.getByTestId("roster-row-u-alice")).toBeInTheDocument();
    expect(screen.getByTestId("roster-row-u-bob")).toBeInTheDocument();
    expect(screen.getByTestId("roster-row-u-carol")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
  });

  it("marks online vs offline rows via data-online", () => {
    render(
      <AnnouncerRoster
        members={[ALICE, BOB]}
        presenceUserIds={new Set(["u-alice"])}
      />,
    );
    expect(screen.getByTestId("roster-row-u-alice")).toHaveAttribute(
      "data-online",
      "true",
    );
    expect(screen.getByTestId("roster-row-u-bob")).toHaveAttribute(
      "data-online",
      "false",
    );
  });

  it("highlights the current announcer with the 🎤 marker + data-current-announcer", () => {
    render(
      <AnnouncerRoster
        members={[ALICE, BOB]}
        presenceUserIds={new Set()}
        currentAnnouncerId="u-bob"
      />,
    );
    expect(screen.getByTestId("roster-row-u-bob")).toHaveAttribute(
      "data-current-announcer",
      "true",
    );
    expect(screen.getByLabelText("Current announcer")).toBeInTheDocument();
    expect(
      screen.getByTestId("roster-row-u-alice"),
    ).toHaveAttribute("data-current-announcer", "false");
  });

  it("shows the delegate marker on the active delegate's row", () => {
    render(
      <AnnouncerRoster
        members={[ALICE, BOB, CAROL]}
        presenceUserIds={new Set()}
        currentAnnouncerId="u-bob"
        delegateUserId="u-alice"
      />,
    );
    expect(screen.getByLabelText("Active delegate")).toBeInTheDocument();
    // Alice (delegate) is not the current announcer — both markers exist
    // and don't collide.
    expect(screen.getByLabelText("Current announcer")).toBeInTheDocument();
  });

  it("renders skipped members with strikethrough + data-skipped + 'skipped' label", () => {
    render(
      <AnnouncerRoster
        members={[ALICE, BOB]}
        presenceUserIds={new Set()}
        skippedUserIds={new Set(["u-alice"])}
      />,
    );
    const aliceRow = screen.getByTestId("roster-row-u-alice");
    expect(aliceRow).toHaveAttribute("data-skipped", "true");
    expect(screen.getByLabelText("Skipped")).toBeInTheDocument();
    // Strikethrough class on the name span (we render the class on the name
    // wrapper, not the row itself).
    expect(aliceRow.querySelector(".line-through")).not.toBeNull();
    // Bob isn't skipped.
    expect(screen.getByTestId("roster-row-u-bob")).toHaveAttribute(
      "data-skipped",
      "false",
    );
  });

  it("survives missing optional props (no current announcer, no delegate, no skipped)", () => {
    render(
      <AnnouncerRoster members={[ALICE]} presenceUserIds={new Set()} />,
    );
    expect(screen.getByTestId("roster-row-u-alice")).toBeInTheDocument();
    expect(screen.queryByLabelText("Current announcer")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Active delegate")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Skipped")).not.toBeInTheDocument();
  });
});
