// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

// OwnPointsCeremony has its own dedicated test file. Mock it to (a) avoid
// pulling its translation/UI logic into this test and (b) auto-fire
// onAllRevealed on mount so we can assert on the Ready CTA without needing
// to drive Piece A's tap-to-reveal flow. Named PascalCase so the
// react-hooks/rules-of-hooks lint accepts the useEffect call.
function MockOwnPointsCeremony({
  onAllRevealed,
}: {
  onAllRevealed: () => void;
}) {
  useEffect(() => {
    onAllRevealed();
  }, [onAllRevealed]);
  return <div data-testid="own-points-ceremony" />;
}
vi.mock("@/components/instant/OwnPointsCeremony", () => ({
  default: MockOwnPointsCeremony,
}));

// RevealCtaPanel is admin-only and out of scope for this test. Stub it.
function MockRevealCtaPanel() {
  return <div data-testid="reveal-cta-panel" />;
}
vi.mock("@/components/room/RevealCtaPanel", () => ({
  default: MockRevealCtaPanel,
}));

import InstantAnnouncingView, {
  type InstantAnnouncingMember,
} from "./InstantAnnouncingView";
import type { Contestant } from "@/types";

const ROOM_ID = "11111111-2222-4333-8444-555555555555";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const GUEST_ID = "33333333-3333-4333-8333-333333333333";

function mkContestant(id: string): Contestant {
  return {
    id,
    year: 2026,
    event: "final",
    countryCode: id.split("-")[1] ?? "XX",
    country: "Test",
    artist: "Test Artist",
    song: "Test Song",
    flagEmoji: "🏳️",
    runningOrder: 1,
  };
}

const CONTESTANTS = [mkContestant("2026-AT"), mkContestant("2026-FR")];

function mkMember(
  userId: string,
  displayName: string,
  isReady = false,
): InstantAnnouncingMember {
  return {
    userId,
    displayName,
    isReady,
    readyAt: isReady ? "2026-05-02T22:00:00Z" : null,
  };
}

const NOOP = () => Promise.resolve();

describe("InstantAnnouncingView — Ready CTA copy (T3)", () => {
  let onMarkReady: ReturnType<typeof vi.fn>;
  let onReveal: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onMarkReady = vi.fn(NOOP);
    onReveal = vi.fn(NOOP);
  });

  it("renders the new 'I'm done' button face — no 'reveal' word", () => {
    render(
      <InstantAnnouncingView
        room={{ id: ROOM_ID, ownerUserId: OWNER_ID }}
        contestants={CONTESTANTS}
        memberships={[mkMember(GUEST_ID, "Alice")]}
        currentUserId={GUEST_ID}
        ownBreakdown={[]}
        onMarkReady={onMarkReady}
        onReveal={onReveal}
      />,
    );

    // The button is referenced by the new locale key. The mocked
    // useTranslations returns the key verbatim, so we assert on the key.
    const button = screen.getByRole("button", {
      name: "instantAnnounce.ready.button",
    });
    expect(button).toBeInTheDocument();
  });

  it("renders the secondary subtitle line below the button", () => {
    render(
      <InstantAnnouncingView
        room={{ id: ROOM_ID, ownerUserId: OWNER_ID }}
        contestants={CONTESTANTS}
        memberships={[mkMember(GUEST_ID, "Alice")]}
        currentUserId={GUEST_ID}
        ownBreakdown={[]}
        onMarkReady={onMarkReady}
        onReveal={onReveal}
      />,
    );

    // The subtitle is the new locale key the component must render.
    expect(
      screen.getByText("instantAnnounce.ready.subtitle"),
    ).toBeInTheDocument();
  });

  it("the Ready button is enabled once OwnPointsCeremony fires onAllRevealed", () => {
    render(
      <InstantAnnouncingView
        room={{ id: ROOM_ID, ownerUserId: OWNER_ID }}
        contestants={CONTESTANTS}
        memberships={[mkMember(GUEST_ID, "Alice")]}
        currentUserId={GUEST_ID}
        ownBreakdown={[]}
        onMarkReady={onMarkReady}
        onReveal={onReveal}
      />,
    );

    // Mock OwnPointsCeremony fires onAllRevealed on mount, so the
    // gate flips synchronously and the button is enabled.
    const button = screen.getByRole("button", {
      name: "instantAnnounce.ready.button",
    });
    expect(button).not.toBeDisabled();
  });

  it("clicking the button fires onMarkReady", async () => {
    const user = userEvent.setup();
    render(
      <InstantAnnouncingView
        room={{ id: ROOM_ID, ownerUserId: OWNER_ID }}
        contestants={CONTESTANTS}
        memberships={[mkMember(GUEST_ID, "Alice")]}
        currentUserId={GUEST_ID}
        ownBreakdown={[]}
        onMarkReady={onMarkReady}
        onReveal={onReveal}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "instantAnnounce.ready.button" }),
    );

    expect(onMarkReady).toHaveBeenCalledTimes(1);
  });

  it("after the user is ready, replaces the button + subtitle with the waiting copy", () => {
    render(
      <InstantAnnouncingView
        room={{ id: ROOM_ID, ownerUserId: OWNER_ID }}
        contestants={CONTESTANTS}
        memberships={[mkMember(GUEST_ID, "Alice", /* isReady */ true)]}
        currentUserId={GUEST_ID}
        ownBreakdown={[]}
        onMarkReady={onMarkReady}
        onReveal={onReveal}
      />,
    );

    // Button gone.
    expect(
      screen.queryByRole("button", {
        name: "instantAnnounce.ready.button",
      }),
    ).not.toBeInTheDocument();
    // Subtitle gone — it travels with the button.
    expect(
      screen.queryByText("instantAnnounce.ready.subtitle"),
    ).not.toBeInTheDocument();
    // Waiting copy renders instead. Mocked useTranslations stringifies params.
    expect(
      screen.getByText(/instantAnnounce\.ready\.waiting/),
    ).toBeInTheDocument();
  });

  it("renders the admin reveal panel only when current user is the owner", () => {
    const { unmount } = render(
      <InstantAnnouncingView
        room={{ id: ROOM_ID, ownerUserId: OWNER_ID }}
        contestants={CONTESTANTS}
        memberships={[mkMember(GUEST_ID, "Alice")]}
        currentUserId={GUEST_ID}
        ownBreakdown={[]}
        onMarkReady={onMarkReady}
        onReveal={onReveal}
      />,
    );
    expect(screen.queryByTestId("reveal-cta-panel")).not.toBeInTheDocument();
    unmount();

    render(
      <InstantAnnouncingView
        room={{ id: ROOM_ID, ownerUserId: OWNER_ID }}
        contestants={CONTESTANTS}
        memberships={[mkMember(OWNER_ID, "Owner")]}
        currentUserId={OWNER_ID}
        ownBreakdown={[]}
        onMarkReady={onMarkReady}
        onReveal={onReveal}
      />,
    );
    expect(screen.getByTestId("reveal-cta-panel")).toBeInTheDocument();
  });
});
