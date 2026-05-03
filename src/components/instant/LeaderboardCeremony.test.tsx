// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mocks must be hoisted via vi.mock so they run before the imports below.
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import LeaderboardCeremony from "./LeaderboardCeremony";
import {
  hasRevealed,
  markRevealed,
  clearRevealed,
} from "@/lib/instant/sessionRevealedFlag";

const ROOM_ID = "00000000-0000-0000-0000-000000000001";
const STAGGER_MS = 250;
const POST_SETTLE_PAUSE_MS = 3000;

interface Contestant {
  id: string;
  year: number;
  event: string;
  countryCode: string;
  country: string;
  artist: string;
  song: string;
  flagEmoji: string;
  runningOrder: number;
}

function mkContestant(id: string, country: string): Contestant {
  return {
    id,
    year: 2026,
    event: "final",
    countryCode: id.split("-")[1] ?? "XX",
    country,
    artist: "Test Artist",
    song: "Test Song",
    flagEmoji: "🏳️",
    runningOrder: 1,
  };
}

const FIXTURE_PAYLOAD = {
  status: "done" as const,
  year: 2026,
  event: "final",
  pin: "ABCDEF",
  contestants: [
    mkContestant("2026-AT", "Austria"),
    mkContestant("2026-FR", "France"),
    mkContestant("2026-IT", "Italy"),
    mkContestant("2026-UK", "United Kingdom"),
  ],
  // Best→worst, matching loadResults output.
  leaderboard: [
    { contestantId: "2026-UK", totalPoints: 12, rank: 1 },
    { contestantId: "2026-FR", totalPoints: 8, rank: 2 },
    { contestantId: "2026-IT", totalPoints: 4, rank: 3 },
    { contestantId: "2026-AT", totalPoints: 1, rank: 4 },
  ],
  breakdowns: [],
  hotTakes: [],
  awards: [],
  members: [],
};

function mockFetch(payload: unknown = FIXTURE_PAYLOAD, ok = true) {
  globalThis.fetch = vi.fn(async () => ({
    ok,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

function setReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("reduce") ? matches : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/** Drive fetch resolution + initial rAF tick. */
async function resolvePending() {
  // Flush pending microtasks (fetch.then, useEffect setData).
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  pushMock.mockReset();
  clearRevealed(ROOM_ID);
  setReducedMotion(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LeaderboardCeremony — initial fetch + render", () => {
  it("renders all contestants at 0 pts in their initial alphabetical order", async () => {
    mockFetch();
    render(<LeaderboardCeremony roomId={ROOM_ID} />);
    await resolvePending();

    // All four flags rendered.
    expect(screen.getByText(/Austria/)).toBeInTheDocument();
    expect(screen.getByText(/France/)).toBeInTheDocument();
    expect(screen.getByText(/Italy/)).toBeInTheDocument();
    expect(screen.getByText(/United Kingdom/)).toBeInTheDocument();

    // No points column rendered yet (all zero → blank cell text).
    // Pick the first row's points cell.
    const rows = document.querySelectorAll("ol > li");
    const initialPoints = Array.from(rows).map(
      (li) => li.querySelector("span.font-semibold")?.textContent ?? "",
    );
    // Every row's points cell renders empty for the initial all-0 snapshot.
    expect(initialPoints).toEqual(["", "", "", ""]);
  });

  it("renders the ceremony subtitle from the locale", async () => {
    mockFetch();
    render(<LeaderboardCeremony roomId={ROOM_ID} />);
    await resolvePending();

    expect(
      screen.getByText("instantAnnounce.ceremony.subtitle"),
    ).toBeInTheDocument();
  });

  it("renders no rank numbers during the climb (rank cells are blank)", async () => {
    mockFetch();
    render(<LeaderboardCeremony roomId={ROOM_ID} />);
    await resolvePending();

    // Initially nothing has revealed: every row's rank cell renders blank.
    const rankCells = document.querySelectorAll("ol > li span.tabular-nums:first-of-type");
    // The first <span class="tabular-nums..."> in each row would be the rank;
    // when blank we assert by looking at all w-6 rank slots empty.
    const w6Slots = document.querySelectorAll("ol > li span.w-6");
    expect(w6Slots.length).toBe(4);
    for (const s of w6Slots) {
      expect(s.textContent ?? "").toBe("");
    }
    // Suppress unused-var lint.
    void rankCells;
  });
});

describe("LeaderboardCeremony — staggered reveal", () => {
  it("settles to the final leaderboard after totalSteps × staggerMs", async () => {
    mockFetch();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "Date", "performance"] });
    render(<LeaderboardCeremony roomId={ROOM_ID} />);

    // Fetch resolution still uses microtasks, which fake timers don't drive.
    // Flush them manually.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Advance through all 4 stagger ticks.
    await act(async () => {
      vi.advanceTimersByTime(STAGGER_MS * 5);
    });

    // Final state: ranks rendered.
    const rankSlots = Array.from(
      document.querySelectorAll("ol > li span.w-6"),
    ).map((s) => s.textContent?.trim());
    expect(rankSlots).toEqual(["1", "2", "3", "4"]);

    // Points populated in best→worst order.
    const points = Array.from(document.querySelectorAll("ol > li")).map(
      (li) => li.querySelector("span.font-semibold")?.textContent ?? "",
    );
    expect(points).toEqual(["12", "8", "4", "1"]);
  });

  it("auto-redirects to /results/{roomId} 3s after the settle", async () => {
    mockFetch();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "Date", "performance"] });
    render(<LeaderboardCeremony roomId={ROOM_ID} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Drive the stagger to completion.
    await act(async () => {
      vi.advanceTimersByTime(STAGGER_MS * 5);
    });

    // Pre-pause: no router.push yet.
    expect(pushMock).not.toHaveBeenCalled();

    // Advance the post-settle pause.
    await act(async () => {
      vi.advanceTimersByTime(POST_SETTLE_PAUSE_MS + 100);
    });

    expect(pushMock).toHaveBeenCalledWith(`/results/${encodeURIComponent(ROOM_ID)}`);
  });

  it("sets the sessionStorage replay flag when the ceremony completes", async () => {
    mockFetch();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "Date", "performance"] });
    render(<LeaderboardCeremony roomId={ROOM_ID} />);

    expect(hasRevealed(ROOM_ID)).toBe(false);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(STAGGER_MS * 5);
    });

    expect(hasRevealed(ROOM_ID)).toBe(true);
  });
});

describe("LeaderboardCeremony — Stay here", () => {
  it("cancels the auto-redirect and renders See-full-results when tapped before redirect", async () => {
    mockFetch();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "Date", "performance"] });
    render(<LeaderboardCeremony roomId={ROOM_ID} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(STAGGER_MS * 5);
    });

    // The Stay-here button is now visible.
    const stayHere = screen.getByRole("button", {
      name: "instantAnnounce.ceremony.stayHere",
    });
    expect(stayHere).toBeInTheDocument();

    // Tap before redirect timer elapses (real-time userEvent doesn't play
    // well with fake timers; fall back to dispatching a synthetic click).
    await act(async () => {
      stayHere.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Advance past the redirect timer: nothing happens.
    await act(async () => {
      vi.advanceTimersByTime(POST_SETTLE_PAUSE_MS + 1000);
    });
    expect(pushMock).not.toHaveBeenCalled();

    // See-full-results CTA replaces the redirect copy.
    expect(
      screen.getByText("instantAnnounce.ceremony.seeFullResults"),
    ).toBeInTheDocument();
  });
});

describe("LeaderboardCeremony — sessionStorage replay-guard", () => {
  it("snaps to the settled state on mount when the flag is already set", async () => {
    markRevealed(ROOM_ID);
    mockFetch();
    render(<LeaderboardCeremony roomId={ROOM_ID} />);
    await resolvePending();

    // Immediately final: ranks shown, points populated, no auto-redirect.
    const rankSlots = Array.from(
      document.querySelectorAll("ol > li span.w-6"),
    ).map((s) => s.textContent?.trim());
    expect(rankSlots).toEqual(["1", "2", "3", "4"]);

    // No setTimeout-based redirect should have fired.
    expect(pushMock).not.toHaveBeenCalled();

    // See-full-results CTA present immediately.
    expect(
      screen.getByText("instantAnnounce.ceremony.seeFullResults"),
    ).toBeInTheDocument();
  });
});

describe("LeaderboardCeremony — prefers-reduced-motion", () => {
  it("snaps to settled state and uses 1s post-settle pause", async () => {
    setReducedMotion(true);
    mockFetch();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "Date", "performance"] });
    render(<LeaderboardCeremony roomId={ROOM_ID} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Already settled — no need to advance through stagger.
    const rankSlots = Array.from(
      document.querySelectorAll("ol > li span.w-6"),
    ).map((s) => s.textContent?.trim());
    expect(rankSlots).toEqual(["1", "2", "3", "4"]);

    // Pause is 1s, not 3s.
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(pushMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(pushMock).toHaveBeenCalledWith(`/results/${encodeURIComponent(ROOM_ID)}`);
  });
});

describe("LeaderboardCeremony — onAfterSettle prop (chained ceremony hook)", () => {
  it("fires onAfterSettle once after settle and never auto-redirects", async () => {
    mockFetch();
    vi.useFakeTimers({
      toFake: [
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "setTimeout",
        "clearTimeout",
        "Date",
        "performance",
      ],
    });
    const onAfterSettle = vi.fn();
    render(
      <LeaderboardCeremony roomId={ROOM_ID} onAfterSettle={onAfterSettle} />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // Drain the stagger.
    await act(async () => {
      vi.advanceTimersByTime(STAGGER_MS * 5);
    });
    // Drain the post-settle pause.
    await act(async () => {
      vi.advanceTimersByTime(POST_SETTLE_PAUSE_MS + 100);
    });

    expect(onAfterSettle).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("fires onAfterSettle immediately when the replay flag is already set", async () => {
    markRevealed(ROOM_ID);
    mockFetch();
    const onAfterSettle = vi.fn();
    render(
      <LeaderboardCeremony roomId={ROOM_ID} onAfterSettle={onAfterSettle} />,
    );

    await resolvePending();

    expect(onAfterSettle).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
    // Stay-here / See-full-results UI is suppressed when the parent owns
    // post-settle UX.
    expect(
      screen.queryByText("instantAnnounce.ceremony.stayHere"),
    ).toBeNull();
    expect(
      screen.queryByText("instantAnnounce.ceremony.seeFullResults"),
    ).toBeNull();
  });
});
