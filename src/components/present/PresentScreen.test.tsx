// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

// QrCode hits the `qrcode` package asynchronously; stub for determinism.
vi.mock("@/components/ui/QrCode", () => ({
  default: ({ url, alt }: { url: string; alt?: string }) => (
    <div data-testid="qr-stub" data-url={url} aria-label={alt}>
      QR
    </div>
  ),
}));

import PresentScreen from "./PresentScreen";
import type { Contestant } from "@/types";
import type { SkipEvent } from "@/components/room/SkipBannerQueue";

function mkContestant(code: string, country: string, runningOrder: number): Contestant {
  return {
    id: `2026-${code}`,
    year: 2026,
    event: "final",
    countryCode: code,
    country,
    artist: "A",
    song: "S",
    flagEmoji: "🏳️",
    runningOrder,
  };
}

const CONTESTANTS = [
  mkContestant("se", "Sweden", 1),
  mkContestant("ua", "Ukraine", 2),
  mkContestant("fr", "France", 3),
];

describe("PresentScreen — lobby", () => {
  it("renders the room PIN large + 'waiting' copy", () => {
    render(<PresentScreen status="lobby" pin="ABCDEF" contestants={CONTESTANTS} />);
    expect(screen.getByTestId("present-screen")).toHaveAttribute(
      "data-status",
      "lobby",
    );
    expect(screen.getByText("ABCDEF")).toBeInTheDocument();
    expect(screen.getByText("present.lobby.callToJoin")).toBeInTheDocument();
  });

  it("renders the member count when roomMemberTotal is provided", () => {
    render(
      <PresentScreen
        status="lobby"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        roomMemberTotal={4}
      />,
    );
    expect(
      screen.getByText(/present\.lobby\.memberCount/),
    ).toBeInTheDocument();
  });

  it("renders the QR code in the lobby when shareUrl is provided", () => {
    render(
      <PresentScreen
        status="lobby"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        shareUrl="https://app.example/room/abc-123"
      />,
    );
    const qr = screen.getByTestId("qr-stub");
    expect(qr).toBeInTheDocument();
    expect(qr).toHaveAttribute("data-url", "https://app.example/room/abc-123");
  });

  it("omits the QR code in the lobby when shareUrl is missing", () => {
    render(
      <PresentScreen status="lobby" pin="ABCDEF" contestants={CONTESTANTS} />,
    );
    expect(screen.queryByTestId("qr-stub")).not.toBeInTheDocument();
  });
});

describe("PresentScreen — voting", () => {
  it("renders the voting eyebrow + shimmer title", () => {
    render(<PresentScreen status="voting" pin="ABCDEF" contestants={CONTESTANTS} />);
    expect(screen.getByTestId("present-screen")).toHaveAttribute(
      "data-status",
      "voting",
    );
    expect(screen.getByText("present.voting.title")).toBeInTheDocument();
  });

  it("renders voting_ending with the dedicated title", () => {
    render(
      <PresentScreen
        status="voting_ending"
        pin="ABCDEF"
        contestants={CONTESTANTS}
      />,
    );
    expect(screen.getByTestId("present-screen")).toHaveAttribute(
      "data-status",
      "voting_ending",
    );
    expect(screen.getByText("present.votingEnding.title")).toBeInTheDocument();
  });
});

describe("PresentScreen — scoring", () => {
  it("renders the 🎼 emoji + Tallying results shimmer", () => {
    render(<PresentScreen status="scoring" pin="ABCDEF" contestants={CONTESTANTS} />);
    expect(screen.getByTestId("present-screen")).toHaveAttribute(
      "data-status",
      "scoring",
    );
    expect(screen.getByText("🎼")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("scoring.title");
  });
});

describe("PresentScreen — announcing", () => {
  const LEADERBOARD = [
    { contestantId: "2026-se", totalPoints: 24, rank: 1 },
    { contestantId: "2026-ua", totalPoints: 18, rank: 2 },
    { contestantId: "2026-fr", totalPoints: 12, rank: 3 },
  ];

  it("renders the leaderboard rows with rank, flag, country, total", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
      />,
    );
    expect(screen.getByTestId("present-row-2026-se")).toBeInTheDocument();
    expect(screen.getByText("Sweden")).toBeInTheDocument();
    expect(screen.getByText("Ukraine")).toBeInTheDocument();
    expect(screen.getByText("France")).toBeInTheDocument();
    // Totals
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
  });

  it("renders 🥇 🥈 🥉 medals for ranks 1-3", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
      />,
    );
    expect(screen.getByText("🥇")).toBeInTheDocument();
    expect(screen.getByText("🥈")).toBeInTheDocument();
    expect(screen.getByText("🥉")).toBeInTheDocument();
  });

  it("renders the announcer name when provided", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
        announcerDisplayName="Alice"
      />,
    );
    expect(
      screen.getByText(/present\.announcing\.announcer/),
    ).toBeInTheDocument();
  });

  it("does NOT render announcer in 'done' status", () => {
    render(
      <PresentScreen
        status="done"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
        announcerDisplayName="Alice"
      />,
    );
    expect(
      screen.queryByText(/present\.announcing\.announcer/),
    ).not.toBeInTheDocument();
  });

  it("renders the 'final' header in 'done' status", () => {
    render(
      <PresentScreen
        status="done"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
      />,
    );
    expect(screen.getByText("present.done.title")).toBeInTheDocument();
  });

  it("falls back to the running-order placeholder for unknown contestants", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={[]}
        leaderboard={LEADERBOARD}
      />,
    );
    // The country col shows the contestantId fallback when contestant lookup fails.
    expect(screen.getByText("2026-se")).toBeInTheDocument();
  });

  it("renders the announcer-position label when announcerPosition + announcerCount are provided", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
        announcerPosition={3}
        announcerCount={7}
      />,
    );
    const label = screen.getByTestId("present-announcer-position");
    expect(label).toHaveTextContent("present.announcing.position");
    // Mock joins the params payload onto the key — make sure both numbers landed.
    expect(label.textContent).toContain('"position":3');
    expect(label.textContent).toContain('"total":7');
  });

  it("does NOT render the position label when announcerCount is 0 (degenerate empty-room)", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
        announcerPosition={1}
        announcerCount={0}
      />,
    );
    expect(
      screen.queryByTestId("present-announcer-position"),
    ).not.toBeInTheDocument();
  });

  it("does NOT render the position label in 'done' status", () => {
    render(
      <PresentScreen
        status="done"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
        announcerPosition={3}
        announcerCount={7}
      />,
    );
    expect(
      screen.queryByTestId("present-announcer-position"),
    ).not.toBeInTheDocument();
  });

  it("renders the 'Up next' card with flag + country + points when pendingReveal is provided", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
        pendingReveal={{ contestantId: "2026-se", points: 8 }}
      />,
    );
    const card = screen.getByTestId("present-pending-reveal");
    expect(card).toHaveAttribute("data-has-reveal", "true");
    expect(card).toHaveTextContent("present.announcing.upNext");
    // Mock concatenates params — verify both points and country surfaced.
    expect(card.textContent).toContain('"points":8');
    expect(card.textContent).toContain('"country":"Sweden"');
  });

  it("renders the queue-exhausted variant when pendingReveal is null (transitional)", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
        pendingReveal={null}
      />,
    );
    const card = screen.getByTestId("present-pending-reveal");
    expect(card).toHaveAttribute("data-has-reveal", "false");
    expect(card).toHaveTextContent("present.announcing.queueExhausted");
  });

  it("does NOT render the 'Up next' card when pendingReveal prop is undefined", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
      />,
    );
    expect(
      screen.queryByTestId("present-pending-reveal"),
    ).not.toBeInTheDocument();
  });

  it("does NOT render the 'Up next' card in 'done' status even when pendingReveal is provided", () => {
    render(
      <PresentScreen
        status="done"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
        pendingReveal={{ contestantId: "2026-se", points: 12 }}
      />,
    );
    expect(
      screen.queryByTestId("present-pending-reveal"),
    ).not.toBeInTheDocument();
  });

  it("falls back to the contestantId in 'Up next' when the contestant is unknown", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={[]}
        leaderboard={LEADERBOARD}
        // Use a non-12 value — the 12-point branch is the mystery branch
        // and intentionally suppresses the country (TODO #7).
        pendingReveal={{ contestantId: "2026-xx", points: 8 }}
      />,
    );
    const card = screen.getByTestId("present-pending-reveal");
    expect(card.textContent).toContain('"country":"2026-xx"');
  });

  // TODO #7 — the climactic 12-point reveal must stay a surprise. The
  // "Up next" card used to leak the destination country + flag for the
  // 12-pointer, killing the drama. Now: when points === 12, render a
  // mystery card that names the points only.
  it("12-point pendingReveal hides the country + flag (mystery card)", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
        pendingReveal={{ contestantId: "2026-se", points: 12 }}
      />,
    );
    const card = screen.getByTestId("present-pending-reveal");
    expect(card).toHaveAttribute("data-has-reveal", "true");
    // Mystery copy is used; the country/flag escape never appears.
    expect(card.textContent).toMatch(/present\.announcing\.upNextDetailMystery/);
    expect(card.textContent).not.toContain("Sweden");
    expect(card.textContent).not.toContain("🇸🇪");
    // The country flag's placeholder ("🏳️") also must not appear — we
    // skip rendering the flag node entirely.
    expect(card.textContent).not.toContain("🏳️");
  });

  it("non-12 pendingReveal still shows the country + flag (drama intact only for 12)", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
        pendingReveal={{ contestantId: "2026-se", points: 10 }}
      />,
    );
    const card = screen.getByTestId("present-pending-reveal");
    expect(card.textContent).toContain("Sweden");
    expect(card.textContent).toContain('"points":10');
    expect(card.textContent).not.toMatch(
      /present\.announcing\.upNextDetailMystery/,
    );
  });
});

describe("PresentScreen — cascade-exhausted (R4 #3)", () => {
  it("renders 'Awaiting an admin' title when status=announcing, no announcerDisplayName, batchRevealMode=false", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={[]}
        batchRevealMode={false}
      />,
    );
    expect(screen.getByTestId("present-screen")).toHaveAttribute("data-cascade-exhausted", "true");
    expect(screen.getByText("present.cascadeExhausted.title")).toBeInTheDocument();
    expect(screen.getByText("present.cascadeExhausted.subtitle")).toBeInTheDocument();
  });

  it("suppresses leaderboard rows in cascade-exhaust state", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={[{ contestantId: "2026-se", totalPoints: 12, rank: 1 }]}
        batchRevealMode={false}
      />,
    );
    expect(screen.queryByTestId("present-row-2026-se")).toBeNull();
  });

  it("renders SkipBannerQueue when skipEvents is non-empty", () => {
    const skipEvents: SkipEvent[] = [{ id: "u1-100", userId: "u1", displayName: "Alice", at: 100 }];
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        batchRevealMode={false}
        skipEvents={skipEvents}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("does not render SkipBannerQueue when skipEvents is empty", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        batchRevealMode={false}
        skipEvents={[]}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("PresentScreen — batch-reveal active (R4 #3)", () => {
  it("renders 'Host is finishing the show' chip when batchRevealMode=true and announcer is set", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={[
          { contestantId: "2026-se", totalPoints: 12, rank: 1 },
        ]}
        announcerDisplayName="Alice"
        batchRevealMode={true}
      />,
    );
    expect(screen.getByTestId("present-batch-reveal-chip")).toHaveTextContent(
      "present.batchReveal.chip",
    );
    expect(screen.getByTestId("present-row-2026-se")).toBeInTheDocument();
    expect(screen.getByText(/present\.announcing\.announcer/)).toBeInTheDocument();
  });

  it("does NOT render the chip when batchRevealMode=false (regression)", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={[
          { contestantId: "2026-se", totalPoints: 12, rank: 1 },
        ]}
        announcerDisplayName="Alice"
        batchRevealMode={false}
      />,
    );
    expect(screen.queryByTestId("present-batch-reveal-chip")).toBeNull();
  });
});

describe("PresentScreen — short style (SPEC §10.2.2)", () => {
  const LEADERBOARD = [
    { contestantId: "2026-se", totalPoints: 24, rank: 1 },
    { contestantId: "2026-ua", totalPoints: 18, rank: 2 },
  ];

  it("Case A — ticker visible when announcing + short + announcer present + no splash", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
        announcerDisplayName="Alice"
        announcementStyle="short"
        splashEvent={null}
      />,
    );
    const ticker = screen.getByTestId("present-short-ticker");
    expect(ticker).toBeInTheDocument();
    // Mock returns the raw key; verify it contains the correct locale key.
    expect(ticker).toHaveTextContent("announce.shortReveal.awaitingTwelve");
  });

  it("Case B — splash visible when splashEvent is set; ticker suppressed", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
        announcerDisplayName="Alice"
        announcementStyle="short"
        splashEvent={{ contestantId: "2026-se", triggerKey: 1 }}
      />,
    );
    const splash = screen.getByTestId("twelve-point-splash");
    expect(splash).toBeInTheDocument();
    expect(splash).toHaveAttribute("data-size", "fullscreen");
    // Ticker must not be rendered while a splash is active.
    expect(screen.queryByTestId("present-short-ticker")).not.toBeInTheDocument();
  });

  it("Case C — full-style control: no ticker, no splash even when announcing + announcer present", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
        announcerDisplayName="Alice"
        announcementStyle="full"
        splashEvent={{ contestantId: "2026-se", triggerKey: 2 }}
      />,
    );
    expect(screen.queryByTestId("present-short-ticker")).not.toBeInTheDocument();
    expect(screen.queryByTestId("twelve-point-splash")).not.toBeInTheDocument();
  });

  it("Case D — unknown contestantId in splashEvent: defensive no-render, no crash", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
        announcerDisplayName="Alice"
        announcementStyle="short"
        splashEvent={{ contestantId: "non-existent-id", triggerKey: 99 }}
      />,
    );
    // The ShortStyleSplash guard returns null for unknown IDs — no crash + no render.
    expect(screen.queryByTestId("twelve-point-splash")).not.toBeInTheDocument();
  });
});

describe("PresentScreen — FLIP rank-shift animation (§10.3)", () => {
  // jsdom returns a zero-DOMRect for getBoundingClientRect by default,
  // so we mock it to drive deterministic dy values across rerenders.
  // The first render captures rects, the second computes diffs.

  function mockRects(rects: Map<string, { top: number }>) {
    const orig = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      const id = (this as HTMLElement).getAttribute("data-testid") ?? "";
      const match = id.match(/^present-row-(.+)$/);
      const ck = match?.[1];
      const r = ck ? rects.get(ck) : undefined;
      return {
        top: r?.top ?? 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    };
    return () => {
      Element.prototype.getBoundingClientRect = orig;
    };
  }

  const CONTESTANTS = [
    {
      id: "2026-se",
      year: 2026,
      event: "final",
      countryCode: "se",
      country: "Sweden",
      artist: "A",
      song: "S",
      flagEmoji: "🇸🇪",
      runningOrder: 1,
    },
    {
      id: "2026-ua",
      year: 2026,
      event: "final",
      countryCode: "ua",
      country: "Ukraine",
      artist: "A",
      song: "S",
      flagEmoji: "🇺🇦",
      runningOrder: 2,
    },
  ] as const;

  it("does NOT apply animate-rank-shift on the very first render", () => {
    const { container } = render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS as never}
        leaderboard={[
          { contestantId: "2026-se", totalPoints: 12, rank: 1 },
          { contestantId: "2026-ua", totalPoints: 8, rank: 2 },
        ]}
      />,
    );
    expect(container.innerHTML).not.toContain("animate-rank-shift");
  });

  it("applies animate-rank-shift to a row whose vertical position changed between renders", () => {
    // First render: SE on top (top=0), UA below (top=100).
    const restore1 = mockRects(
      new Map([
        ["2026-se", { top: 0 }],
        ["2026-ua", { top: 100 }],
      ]),
    );
    const { rerender, container } = render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS as never}
        leaderboard={[
          { contestantId: "2026-se", totalPoints: 12, rank: 1 },
          { contestantId: "2026-ua", totalPoints: 8, rank: 2 },
        ]}
      />,
    );
    restore1();

    // Now flip: UA moves to top, SE drops to second.
    const restore2 = mockRects(
      new Map([
        ["2026-se", { top: 100 }],
        ["2026-ua", { top: 0 }],
      ]),
    );
    rerender(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS as never}
        leaderboard={[
          { contestantId: "2026-ua", totalPoints: 16, rank: 1 },
          { contestantId: "2026-se", totalPoints: 12, rank: 2 },
        ]}
      />,
    );
    restore2();

    // Both rows shifted by ±100 px → both should pick up the FLIP class
    // and the --shift-from CSS variable.
    const seRow = container.querySelector(
      "[data-testid='present-row-2026-se']",
    ) as HTMLElement;
    const uaRow = container.querySelector(
      "[data-testid='present-row-2026-ua']",
    ) as HTMLElement;
    expect(seRow.className).toContain("motion-safe:animate-rank-shift");
    expect(uaRow.className).toContain("motion-safe:animate-rank-shift");
    // SE moved DOWN 100 px → dy = oldTop(0) - newTop(100) = -100.
    expect(seRow.style.getPropertyValue("--shift-from")).toBe("-100px");
    // UA moved UP 100 px → dy = oldTop(100) - newTop(0) = 100.
    expect(uaRow.style.getPropertyValue("--shift-from")).toBe("100px");
  });

  it("does NOT apply animate-rank-shift to rows that didn't move (sub-pixel diff threshold)", () => {
    // Both rows render at the same top; the second render keeps positions
    // identical → no FLIP fire.
    const restore = mockRects(
      new Map([
        ["2026-se", { top: 0 }],
        ["2026-ua", { top: 100 }],
      ]),
    );
    const { rerender, container } = render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS as never}
        leaderboard={[
          { contestantId: "2026-se", totalPoints: 12, rank: 1 },
          { contestantId: "2026-ua", totalPoints: 8, rank: 2 },
        ]}
      />,
    );
    rerender(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS as never}
        leaderboard={[
          { contestantId: "2026-se", totalPoints: 14, rank: 1 }, // total bumped, position unchanged
          { contestantId: "2026-ua", totalPoints: 8, rank: 2 },
        ]}
      />,
    );
    restore();
    expect(container.innerHTML).not.toContain("animate-rank-shift");
  });
});

describe("PresentScreen — short-style first-load overlay (R4 §10.2.2)", () => {
  const LEADERBOARD = [
    { contestantId: "2026-se", totalPoints: 24, rank: 1 },
    { contestantId: "2026-ua", totalPoints: 18, rank: 2 },
  ];

  beforeEach(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.clear();
    }
  });

  it("Case A — Renders on first load when sessionStorage flag is absent", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
        announcementStyle="short"
        roomId="test-room"
      />,
    );
    const overlay = screen.getByTestId("present-short-overlay");
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveTextContent(
      "announcementStyle.short.presentOverlay.title",
    );
  });

  it("Case B — Suppressed when sessionStorage flag is already set", () => {
    window.sessionStorage.setItem("emx_short_overlay_test-room", "1");
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
        announcementStyle="short"
        roomId="test-room"
      />,
    );
    expect(
      screen.queryByTestId("present-short-overlay"),
    ).not.toBeInTheDocument();
  });

  it("Case C — 'Got it' button dismisses the overlay", () => {
    render(
      <PresentScreen
        status="announcing"
        pin="ABCDEF"
        contestants={CONTESTANTS}
        leaderboard={LEADERBOARD}
        announcementStyle="short"
        roomId="test-room"
      />,
    );
    expect(screen.getByTestId("present-short-overlay")).toBeInTheDocument();
    fireEvent.click(
      screen.getByText("announcementStyle.short.presentOverlay.dismiss"),
    );
    expect(
      screen.queryByTestId("present-short-overlay"),
    ).not.toBeInTheDocument();
  });
});
