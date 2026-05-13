// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

vi.mock("@/lib/session", () => ({
  getSession: () => null,
}));

// Skip the leaderboard replay so the awards phase shows up immediately.
vi.mock("@/lib/instant/sessionRevealedFlag", () => ({
  hasRevealed: () => true,
  markRevealed: () => {},
  clearRevealed: () => {},
  revealedFlagKey: (id: string) => `emx_revealed_${id}`,
}));

import DoneCeremony from "./DoneCeremony";

const FIXTURE = {
  status: "done" as const,
  year: 2026,
  event: "final",
  pin: "ABCDEF",
  contestants: [
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
  ],
  leaderboard: [{ contestantId: "2026-SE", totalPoints: 24, rank: 1 }],
  breakdowns: [],
  hotTakes: [],
  awards: [
    {
      roomId: "r",
      awardKey: "best_vocals",
      awardName: "Best Vocals",
      winnerUserId: null,
      winnerUserIdB: null,
      winnerContestantId: "2026-SE",
      statValue: null,
      statLabel: null,
    },
    {
      roomId: "r",
      awardKey: "the_enabler",
      awardName: "The enabler",
      winnerUserId: "u1",
      winnerUserIdB: null,
      winnerContestantId: null,
      statValue: null,
      statLabel: null,
    },
  ],
  members: [{ userId: "u1", displayName: "Alice", avatarSeed: "alice" }],
};

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

function mockFetch(payload: unknown = FIXTURE, ok = true) {
  globalThis.fetch = vi.fn(async () => ({
    ok,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("DoneCeremony", () => {
  beforeEach(() => {
    pushMock.mockReset();
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("walks leaderboard → awards → ctas", async () => {
    mockFetch();
    render(
      <DoneCeremony
        roomId="r"
        isAdmin={false}
        categories={[{ name: "Vocals", weight: 1 }]}
      />,
    );
    // After fetch + skipReplay flag, we land in awards phase.
    await flushMicrotasks();
    await flushMicrotasks();

    expect(await screen.findByText("Best Vocals")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("awards-tap-zone"));
    expect(screen.getByText("The enabler")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("awards-tap-zone"));

    // CTAs phase.
    expect(
      screen.getByRole("button", { name: /awards.endOfShow.copyLink/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /awards.endOfShow.copySummary/ }),
    ).toBeInTheDocument();
  });

  it("falls through to CTAs even with no awards", async () => {
    mockFetch({ ...FIXTURE, awards: [] });
    render(<DoneCeremony roomId="r" isAdmin={false} categories={[]} />);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(
      await screen.findByRole("button", {
        name: /awards.endOfShow.copyLink/,
      }),
    ).toBeInTheDocument();
  });

  it("admin sees Create another room CTA", async () => {
    mockFetch({ ...FIXTURE, awards: [] });
    render(<DoneCeremony roomId="r" isAdmin={true} categories={[]} />);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(
      await screen.findByRole("button", {
        name: /awards.endOfShow.createAnother/,
      }),
    ).toBeInTheDocument();
  });

  it("defers phase transition when LeaderboardCeremony settles before data arrives", async () => {
    // Block the fetch until we explicitly resolve it. This recreates the
    // race the spec describes: LeaderboardCeremony fires onAfterSettle()
    // synchronously (sessionRevealedFlag mock returns true), but the
    // /api/results fetch hasn't returned yet, so `data` is still null.
    let resolveFetch!: (value: unknown) => void;
    const pendingFetch = new Promise((res) => {
      resolveFetch = res;
    });
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => {
            await pendingFetch;
            return FIXTURE;
          },
        }) as unknown as Response,
    ) as unknown as typeof fetch;

    render(
      <DoneCeremony
        roomId="r"
        isAdmin={false}
        categories={[{ name: "Vocals", weight: 1 }]}
      />,
    );

    // After mount, LeaderboardCeremony settles synchronously (replay-skip
    // path). But data is still pending, so the phase MUST remain on the
    // leaderboard view — awards-section copy must NOT appear yet.
    await flushMicrotasks();
    expect(screen.queryByText("Best Vocals")).not.toBeInTheDocument();

    // Now resolve the fetch. The data + sequence land, the deferred
    // useEffect fires, and the phase advances to awards.
    resolveFetch(undefined);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(await screen.findByText("Best Vocals")).toBeInTheDocument();
  });

  it("transitions immediately when data arrives before LeaderboardCeremony settles", async () => {
    // Happy path: fetch resolves fast (mocked synchronously). Existing
    // 'walks leaderboard → awards → ctas' test already covers this — but
    // we re-pin it explicitly here to guard against the deferred-
    // transition useEffect mis-firing when both signals are already
    // present at the same render tick.
    mockFetch();
    render(
      <DoneCeremony
        roomId="r"
        isAdmin={false}
        categories={[{ name: "Vocals", weight: 1 }]}
      />,
    );
    await flushMicrotasks();
    await flushMicrotasks();

    expect(await screen.findByText("Best Vocals")).toBeInTheDocument();
  });
});
