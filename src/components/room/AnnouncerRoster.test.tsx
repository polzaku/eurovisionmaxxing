// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/ui/Avatar", () => ({
  default: ({ seed }: { seed: string }) => (
    <span data-testid="avatar" data-seed={seed} />
  ),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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

  // ─── §10.2.1 stage 2 — Restore CTA on skipped rows ──────────────────────
  describe("Restore CTA on skipped rows", () => {
    it("renders the Restore button on each skipped row when onRestore is provided", () => {
      render(
        <AnnouncerRoster
          members={[ALICE, BOB]}
          presenceUserIds={new Set()}
          skippedUserIds={new Set(["u-alice"])}
          onRestore={() => {}}
        />,
      );
      expect(screen.getByTestId("roster-restore-u-alice")).toBeInTheDocument();
      // Bob isn't skipped → no restore button on his row.
      expect(
        screen.queryByTestId("roster-restore-u-bob"),
      ).not.toBeInTheDocument();
    });

    it("does NOT render the Restore button when onRestore is omitted", () => {
      // Display-only roster (e.g. for non-owner viewers, post-R1 co-admins).
      render(
        <AnnouncerRoster
          members={[ALICE, BOB]}
          presenceUserIds={new Set()}
          skippedUserIds={new Set(["u-alice"])}
        />,
      );
      expect(
        screen.queryByTestId("roster-restore-u-alice"),
      ).not.toBeInTheDocument();
    });

    it("calls onRestore with the skipped user's id on click", async () => {
      const onRestore = vi.fn();
      render(
        <AnnouncerRoster
          members={[ALICE, BOB, CAROL]}
          presenceUserIds={new Set()}
          skippedUserIds={new Set(["u-alice", "u-carol"])}
          onRestore={onRestore}
        />,
      );
      const userEvent = (await import("@testing-library/user-event")).default;
      await userEvent.click(screen.getByTestId("roster-restore-u-carol"));
      expect(onRestore).toHaveBeenCalledTimes(1);
      expect(onRestore).toHaveBeenCalledWith("u-carol");
    });

    it("disables the Restore button + flips to 'Restoring…' for the in-flight user", () => {
      render(
        <AnnouncerRoster
          members={[ALICE, BOB]}
          presenceUserIds={new Set()}
          skippedUserIds={new Set(["u-alice", "u-bob"])}
          onRestore={() => {}}
          restoringUserId="u-alice"
        />,
      );
      const aliceBtn = screen.getByTestId(
        "roster-restore-u-alice",
      ) as HTMLButtonElement;
      expect(aliceBtn).toBeDisabled();
      expect(aliceBtn).toHaveTextContent(/restoring/i);
      // Other skipped rows stay clickable.
      const bobBtn = screen.getByTestId(
        "roster-restore-u-bob",
      ) as HTMLButtonElement;
      expect(bobBtn).not.toBeDisabled();
      expect(bobBtn).toHaveTextContent(/^Restore$/);
    });
  });
});

describe("AnnouncerRoster — re-shuffle button (R4 #4)", () => {
  const baseMembers: RosterMember[] = [
    { userId: "u1", displayName: "Alice", avatarSeed: "a" },
    { userId: "u2", displayName: "Bob", avatarSeed: "b" },
  ];
  const presenceUserIds = new Set(["u1", "u2"]);

  it("renders the button when onReshuffle is provided AND canReshuffle is true", () => {
    render(
      <AnnouncerRoster
        members={baseMembers}
        presenceUserIds={presenceUserIds}
        currentAnnouncerId="u1"
        onReshuffle={() => {}}
        canReshuffle={true}
      />,
    );
    expect(screen.getByTestId("roster-reshuffle")).toBeInTheDocument();
  });

  it("hides the button when canReshuffle is false (regression: hide-not-grey UX)", () => {
    render(
      <AnnouncerRoster
        members={baseMembers}
        presenceUserIds={presenceUserIds}
        currentAnnouncerId="u1"
        onReshuffle={() => {}}
        canReshuffle={false}
      />,
    );
    expect(screen.queryByTestId("roster-reshuffle")).toBeNull();
  });

  it("hides the button when onReshuffle is undefined (non-owner view)", () => {
    render(
      <AnnouncerRoster
        members={baseMembers}
        presenceUserIds={presenceUserIds}
        currentAnnouncerId="u1"
        canReshuffle={true}
      />,
    );
    expect(screen.queryByTestId("roster-reshuffle")).toBeNull();
  });

  it("shows busy copy when reshuffling is true", () => {
    render(
      <AnnouncerRoster
        members={baseMembers}
        presenceUserIds={presenceUserIds}
        currentAnnouncerId="u1"
        onReshuffle={() => {}}
        canReshuffle={true}
        reshuffling={true}
      />,
    );
    expect(screen.getByTestId("roster-reshuffle")).toHaveTextContent(
      "roster.reshuffle.busyCta",
    );
  });

  it("calls onReshuffle when tapped", async () => {
    const onReshuffle = vi.fn();
    const user = userEvent.setup();
    render(
      <AnnouncerRoster
        members={baseMembers}
        presenceUserIds={presenceUserIds}
        currentAnnouncerId="u1"
        onReshuffle={onReshuffle}
        canReshuffle={true}
      />,
    );
    await user.click(screen.getByTestId("roster-reshuffle"));
    expect(onReshuffle).toHaveBeenCalledTimes(1);
  });
});
