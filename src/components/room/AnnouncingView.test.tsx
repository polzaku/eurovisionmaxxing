// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ─── Mocks ───────────────────────────────────────────────────────────────────
// useRoomRealtime: capture the callback so tests can fire broadcast events.
import type { RoomEvent } from "@/types";

let capturedRoomEventHandler: ((event: RoomEvent) => void) | null = null;

function fireRoomEvent(event: RoomEvent) {
  capturedRoomEventHandler?.(event);
}

vi.mock("@/hooks/useRoomRealtime", () => ({
  useRoomRealtime: (_roomId: string, handler: (event: RoomEvent) => void) => {
    capturedRoomEventHandler = handler;
  },
}));

// useRoomPresence is the §10.2 step 7 presence hook. The default mock
// returns an empty set; specific tests override with mockImplementation.
const useRoomPresenceMock: ReturnType<typeof vi.fn> = vi.fn(
  (_roomId: string | null, _userId: string | null) => new Set<string>(),
);
vi.mock("@/hooks/useRoomPresence", () => ({
  useRoomPresence: (roomId: string | null, userId: string | null) =>
    useRoomPresenceMock(roomId, userId) as Set<string>,
}));

// Avatar pulls DiceBear; render a stable stub to keep snapshots
// readable + tests fast.
vi.mock("@/components/ui/Avatar", () => ({
  default: ({ seed }: { seed: string }) => (
    <span data-testid="avatar" data-seed={seed} />
  ),
}));

// DoneCard pulls additional state / fetches; we only need to confirm
// the "show finished" branch swaps in this component.
vi.mock("@/components/room/DoneCard", () => ({
  default: ({ roomId }: { roomId: string }) => (
    <div data-testid="done-card" data-room-id={roomId}>
      Done
    </div>
  ),
}));

// next-intl — mock useTranslations so AnnouncingView and its internal
// ShortStyleRevealCard don't need a NextIntlClientProvider in tests.
// The mock returns English text for commonly-asserted keys so test
// assertions remain readable (e.g. "Reveal 12 points", "Bob is announcing").
vi.mock("next-intl", () => ({
  useTranslations: (_ns?: string) => (key: string, params?: Record<string, string>) => {
    const fullKey = _ns ? `${_ns}.${key}` : key;
    // Interpolated keys: substitute params if provided.
    if (fullKey === "announcing.ownerWatching.title" && params?.announcerName) {
      return `${params.announcerName} is announcing`;
    }
    if (fullKey === "announcing.takeControl.button" && params?.announcerName) {
      return `Announce for ${params.announcerName}`;
    }
    if (fullKey === "announcing.skip.aria" && params?.announcerName) {
      return `Skip ${params.announcerName}'s turn — they're not here`;
    }
    if (fullKey === "announcing.skip.button" && params?.announcerName) {
      return `Skip ${params.announcerName} — they're not here`;
    }
    if (fullKey === "announcing.giveBack.label" && params?.announcerName) {
      return `Give back control to ${params.announcerName}`;
    }
    if (fullKey === "announcing.activeDelegate.title" && params?.announcerName) {
      return `You're announcing for ${params.announcerName}`;
    }
    const translations: Record<string, string> = {
      "announcing.noAnnouncer": "Waiting for an announcer…",
      "announcing.takeControl.busy": "Taking over…",
      "announcing.skip.busy": "Skipping…",
      "announcing.giveBackBusy": "Releasing…",
      "announcing.reveal.button": "Reveal next point",
      "announcing.reveal.busy": "Revealing…",
      "announcing.finishShow.button": "Finish the show",
      "announcing.finishShow.busy": "Starting…",
      "announcing.cascadeExhaust.waitingMessage": "Waiting for the host to continue…",
      "announcing.batchReveal.chip": "Host is finishing the show",
      "announcing.upNext.label": "Up next",
      "announcing.upNext.pointsHint": params?.points
        ? `${params.points === "1" ? "1 point" : `${params.points} points`} — tap anywhere to reveal`
        : "tap anywhere to reveal",
      "announcing.justRevealed.label": "Just revealed",
      "announcing.justRevealed.pointsLabel": params?.points
        ? `${params.points} points`
        : "points",
      // Short-reveal keys (used without namespace by ShortStyleRevealCard which uses useTranslations())
      "announce.shortReveal.cta": "Reveal 12 points",
      "announce.shortReveal.ctaMicrocopy": "Tap when you say it",
      "announce.shortReveal.revealed": "Revealed ✓",
      "announce.revealToast": params
        ? `${params.name} gave ${params.points} to ${params.flag} ${params.country}`
        : key,
      "announcing.giveBack.label": "Give back control",
    };
    return translations[fullKey] ?? key;
  },
}));

// SkipBannerQueue uses next-intl — stub it out so AnnouncingView tests
// don't need an intl provider. The null-render when events=[] is what
// existing tests rely on; a banner stub is fine for the rare test that
// triggers announce_skip.
vi.mock("@/components/room/SkipBannerQueue", () => ({
  default: () => null,
}));

// TwelvePointSplash — render a minimal stub that preserves the
// data-testid and data-size attributes the new tests assert on.
vi.mock("@/components/room/TwelvePointSplash", () => ({
  default: ({
    contestant,
    size,
  }: {
    contestant: { country: string; flagEmoji: string };
    size: string;
  }) => (
    <div
      data-testid="twelve-point-splash"
      data-size={size}
    >
      {contestant.country} {contestant.flagEmoji}
    </div>
  ),
}));

// RevealToast — render a minimal stub that preserves the data-testid
// attribute and shows the formatted text including the points value.
vi.mock("@/components/room/RevealToast", () => ({
  default: ({
    events,
  }: {
    events: Array<{
      id: string;
      announcingUserDisplayName: string;
      country: string;
      flagEmoji: string;
      points: number;
      at: number;
    }>;
  }) => {
    if (!events || events.length === 0) return null;
    const latest = events[events.length - 1];
    return (
      <div data-testid="reveal-toast">
        {latest.announcingUserDisplayName} gave {latest.points} to{" "}
        {latest.country} {latest.flagEmoji}
      </div>
    );
  },
}));

// AnnouncerRoster uses next-intl — stub with a minimal implementation that
// preserves all the data-testid attributes the tests assert on.
vi.mock("@/components/room/AnnouncerRoster", () => ({
  default: ({
    members,
    presenceUserIds,
    currentAnnouncerId,
    skippedUserIds,
    onRestore,
    restoringUserId,
    onReshuffle,
    reshuffling,
    canReshuffle,
  }: {
    members: Array<{ userId: string; displayName: string; avatarSeed: string }>;
    presenceUserIds: Set<string>;
    currentAnnouncerId?: string | null;
    skippedUserIds?: Set<string>;
    onRestore?: (userId: string) => void;
    restoringUserId?: string | null;
    onReshuffle?: () => void;
    reshuffling?: boolean;
    canReshuffle?: boolean;
  }) => {
    if (!members || members.length === 0) return null;
    return (
      <section data-testid="announcer-roster">
        {onReshuffle && canReshuffle ? (
          <button
            type="button"
            onClick={onReshuffle}
            disabled={reshuffling}
            data-testid="roster-reshuffle"
            aria-label="Re-shuffle the announcement order"
          >
            {reshuffling ? "Re-shuffling\u2026" : "Re-shuffle order"}
          </button>
        ) : null}
        <ul>
          {members.map((m) => {
            const isOnline = presenceUserIds.has(m.userId);
            const isAnnouncer = m.userId === currentAnnouncerId;
            const isSkipped = !!skippedUserIds?.has(m.userId);
            return (
              <li
                key={m.userId}
                data-testid={`roster-row-${m.userId}`}
                data-online={isOnline ? "true" : "false"}
                data-current-announcer={isAnnouncer ? "true" : "false"}
                data-skipped={isSkipped ? "true" : "false"}
              >
                {m.displayName}
                {isSkipped && onRestore ? (
                  <button
                    type="button"
                    onClick={() => onRestore(m.userId)}
                    disabled={restoringUserId === m.userId}
                    data-testid={`roster-restore-${m.userId}`}
                    aria-label={`Restore ${m.displayName}`}
                  >
                    {restoringUserId === m.userId ? "Restoring\u2026" : "Restore"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    );
  },
}));

// API helpers — controllable per-test via mockImplementation in beforeEach.
const postAnnounceNextMock = vi.fn();
const postAnnounceHandoffMock = vi.fn();
const postAnnounceSkipMock = vi.fn();
const postAnnounceRestoreMock = vi.fn();
const postFinishShowMock = vi.fn();
const patchAnnouncementOrderMock = vi.fn();

vi.mock("@/lib/room/api", () => ({
  postAnnounceNext: (...args: unknown[]) => postAnnounceNextMock(...args),
  postAnnounceHandoff: (...args: unknown[]) => postAnnounceHandoffMock(...args),
  postAnnounceSkip: (...args: unknown[]) => postAnnounceSkipMock(...args),
  postAnnounceRestore: (...args: unknown[]) => postAnnounceRestoreMock(...args),
  postFinishShow: (...args: unknown[]) => postFinishShowMock(...args),
  patchAnnouncementOrder: (...args: unknown[]) =>
    patchAnnouncementOrderMock(...args),
}));

import AnnouncingView from "./AnnouncingView";
import type { Contestant } from "@/types";

const ROOM_ID = "11111111-2222-4333-8444-555555555555";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const ANNOUNCER_ID = "33333333-3333-4333-8333-333333333333";

const ROOM = {
  id: ROOM_ID,
  status: "announcing",
  ownerUserId: OWNER_ID,
};

const CONTESTANTS: Contestant[] = [
  {
    id: "2026-AT",
    year: 2026,
    event: "final",
    countryCode: "AT",
    country: "Austria",
    artist: "A",
    song: "S",
    flagEmoji: "🇦🇹",
    runningOrder: 1,
  },
];

const ANNOUNCEMENT_STATE = {
  announcingUserId: ANNOUNCER_ID,
  announcingDisplayName: "Bob",
  announcingAvatarSeed: "seed-bob",
  currentAnnounceIdx: 0,
  pendingReveal: { contestantId: "2026-AT", points: 12 },
  queueLength: 5,
  delegateUserId: null,
  announcerPosition: 1,
  announcerCount: 2,
  skippedUserIds: [] as string[],
};

const RESULTS_RESPONSE_BODY = {
  status: "announcing",
  leaderboard: [
    { contestantId: "2026-AT", totalPoints: 12, rank: 1 },
  ],
  announcement: ANNOUNCEMENT_STATE,
};

function mockResultsFetch(body: unknown = RESULTS_RESPONSE_BODY) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  } as unknown as Response);
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return fetchMock;
}

describe("<AnnouncingView> — owner-watching skip CTA", () => {
  beforeEach(() => {
    postAnnounceNextMock.mockReset();
    postAnnounceHandoffMock.mockReset();
    postAnnounceSkipMock.mockReset();
    mockResultsFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function renderAsOwner() {
    const utils = render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={OWNER_ID}
      />,
    );
    // Wait for the on-mount refetch to populate the announcement state.
    // Two elements may render the same "Bob is announcing" text (HeaderCard +
    // ownerWatching panel), so use getAllByText.
    await waitFor(() =>
      expect(screen.getAllByText(/bob is announcing/i).length).toBeGreaterThan(0),
    );
    return utils;
  }

  it("renders the Skip CTA alongside the Take-control button for the owner", async () => {
    await renderAsOwner();
    expect(
      screen.getByRole("button", { name: /announce for bob/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /skip bob.s turn — they.re not here/i,
      }),
    ).toBeInTheDocument();
  });

  it("hides the owner-watching panel for non-owner viewers (no Skip CTA)", async () => {
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={ANNOUNCER_ID} // viewer is the announcer, not the owner
      />,
    );
    // Confirm the page rendered something — the announcer-side queue copy.
    await waitFor(() => {
      expect(screen.getByText(/announcer/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /skip bob.s turn/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /announce for bob/i }),
    ).not.toBeInTheDocument();
  });

  it("calls postAnnounceSkip with (roomId, currentUserId, deps) when tapped", async () => {
    postAnnounceSkipMock.mockResolvedValue({
      ok: true,
      data: { finished: false },
    });
    await renderAsOwner();
    await userEvent.click(
      screen.getByRole("button", { name: /skip bob/i }),
    );
    await waitFor(() => {
      expect(postAnnounceSkipMock).toHaveBeenCalledTimes(1);
    });
    expect(postAnnounceSkipMock).toHaveBeenCalledWith(
      ROOM_ID,
      OWNER_ID,
      expect.objectContaining({ fetch: expect.any(Function) }),
    );
  });

  it("disables the Take-control button while Skip is submitting", async () => {
    let resolveSkip: ((v: unknown) => void) | undefined;
    postAnnounceSkipMock.mockImplementation(
      () => new Promise((r) => (resolveSkip = r)),
    );
    await renderAsOwner();
    await userEvent.click(
      screen.getByRole("button", { name: /skip bob/i }),
    );
    // The button keeps its aria-label across the state flip; assert via
    // the label and let the visible text + disabled flag confirm the
    // submitting state.
    const skipBtn = screen.getByRole("button", { name: /skip bob/i });
    await waitFor(() => {
      expect(skipBtn).toHaveTextContent(/skipping/i);
      expect(skipBtn).toBeDisabled();
    });
    expect(
      screen.getByRole("button", { name: /announce for bob/i }),
    ).toBeDisabled();
    // Tidy up so React stops the pending state warning.
    resolveSkip?.({ ok: true, data: { finished: false } });
  });

  it("disables the Skip button while Take-control is submitting (mutual lock)", async () => {
    let resolveHandoff: ((v: unknown) => void) | undefined;
    postAnnounceHandoffMock.mockImplementation(
      () => new Promise((r) => (resolveHandoff = r)),
    );
    await renderAsOwner();
    await userEvent.click(
      screen.getByRole("button", { name: /announce for bob/i }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /taking over…/i }),
      ).toBeDisabled();
    });
    expect(
      screen.getByRole("button", { name: /skip bob/i }),
    ).toBeDisabled();
    resolveHandoff?.({ ok: true, data: { delegateUserId: OWNER_ID } });
  });

  it("renders the DoneCard when skip returns finished=true", async () => {
    postAnnounceSkipMock.mockResolvedValue({
      ok: true,
      data: { finished: true },
    });
    await renderAsOwner();
    await userEvent.click(
      screen.getByRole("button", { name: /skip bob/i }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("done-card")).toBeInTheDocument();
    });
    expect(screen.getByTestId("done-card")).toHaveAttribute(
      "data-room-id",
      ROOM_ID,
    );
  });

  it("renders an alert with the mapped error when skip fails", async () => {
    postAnnounceSkipMock.mockResolvedValue({
      ok: false,
      code: "FORBIDDEN",
      message: "denied",
    });
    await renderAsOwner();
    await userEvent.click(
      screen.getByRole("button", { name: /skip bob/i }),
    );
    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      // Multiple alerts may exist (one per error slot); at least one should
      // carry a non-empty error message.
      expect(alerts.length).toBeGreaterThan(0);
    });
  });

  it("triggers a refetch on skip success (next announcer flips into the panel)", async () => {
    // Initial render mocks fetch to return Bob; once skip succeeds, swap in
    // a payload where the next announcer is Carol. The CTA should re-render
    // with her name.
    const fetchMock = mockResultsFetch();
    postAnnounceSkipMock.mockResolvedValue({
      ok: true,
      data: { finished: false },
    });

    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={OWNER_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getAllByText(/bob is announcing/i).length).toBeGreaterThan(0),
    );

    // Swap the fetch mock so the next refetch returns Carol.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...RESULTS_RESPONSE_BODY,
        announcement: {
          ...ANNOUNCEMENT_STATE,
          announcingDisplayName: "Carol",
        },
      }),
    } as unknown as Response);

    await userEvent.click(
      screen.getByRole("button", { name: /skip bob/i }),
    );
    await waitFor(() =>
      expect(screen.getAllByText(/carol is announcing/i).length).toBeGreaterThan(0),
    );
    expect(
      screen.getByRole("button", { name: /skip carol/i }),
    ).toBeInTheDocument();
  });

  it("hides the skip CTA while the announcement state is still loading", () => {
    // Don't await — we want to observe the pre-fetch state.
    globalThis.fetch = vi.fn(
      () => new Promise(() => {}),
    ) as unknown as typeof globalThis.fetch;
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={OWNER_ID}
      />,
    );
    // While announcement is null, the panel should not render.
    expect(
      screen.queryByRole("button", { name: /skip bob/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/waiting for an announcer/i)).toBeInTheDocument();
  });
});

// ─── L2 tap-anywhere advance zone (SPEC §10.2 step 4) ───────────────────────

describe("<AnnouncingView> — active-driver tap-anywhere zone", () => {
  beforeEach(() => {
    postAnnounceNextMock.mockReset();
    postAnnounceHandoffMock.mockReset();
    postAnnounceSkipMock.mockReset();
    mockResultsFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function renderAsAnnouncer() {
    const utils = render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={ANNOUNCER_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("active-driver-tap-zone")).toBeInTheDocument(),
    );
    return utils;
  }

  it("renders the tap-anywhere zone for the active announcer", async () => {
    await renderAsAnnouncer();
    const zone = screen.getByTestId("active-driver-tap-zone");
    expect(zone).toBeInTheDocument();
    // Helper copy reflects the new behaviour, not the old "tap below" wording.
    expect(zone.textContent).toContain("tap anywhere to reveal");
  });

  it("does NOT render the tap-anywhere zone for a non-driver guest", async () => {
    // Render as a guest (not announcer, not owner) — Up-next + tap zone are
    // suppressed (no spoilers) per the active-driver gate.
    const guestId = "44444444-4444-4444-8444-444444444444";
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={guestId}
      />,
    );
    // Wait for the leaderboard cell to confirm announcement state has loaded.
    // (Header label "{name} is announcing" lives across two spans for
    // non-owner viewers, so getByText(/bob is announcing/i) wouldn't match —
    // Austria is a single-element signal that the fetch resolved.)
    await waitFor(() =>
      expect(screen.getByText("Austria")).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("active-driver-tap-zone"),
    ).not.toBeInTheDocument();
  });

  it("calls postAnnounceNext when the tap zone is clicked outside the button", async () => {
    postAnnounceNextMock.mockResolvedValue({
      ok: true,
      data: { finished: false },
    });
    await renderAsAnnouncer();
    // Click the "Up next" label inside the zone — not the Reveal button.
    await userEvent.click(screen.getByText(/up next/i));
    await waitFor(() => {
      expect(postAnnounceNextMock).toHaveBeenCalledTimes(1);
    });
    expect(postAnnounceNextMock).toHaveBeenCalledWith(
      ROOM_ID,
      ANNOUNCER_ID,
      expect.objectContaining({ fetch: expect.any(Function) }),
    );
  });

  it("does NOT double-fire postAnnounceNext when the inner Reveal button is clicked (stopPropagation)", async () => {
    postAnnounceNextMock.mockResolvedValue({
      ok: true,
      data: { finished: false },
    });
    await renderAsAnnouncer();
    await userEvent.click(
      screen.getByRole("button", { name: /reveal next point/i }),
    );
    await waitFor(() => {
      expect(postAnnounceNextMock).toHaveBeenCalledTimes(1);
    });
  });

  it("suppresses tap-zone clicks while a reveal is already submitting", async () => {
    let resolveReveal: ((v: unknown) => void) | undefined;
    postAnnounceNextMock.mockImplementation(
      () => new Promise((r) => (resolveReveal = r)),
    );
    await renderAsAnnouncer();
    // First click — kicks off the in-flight reveal.
    await userEvent.click(
      screen.getByRole("button", { name: /reveal next point/i }),
    );
    await waitFor(() => {
      expect(postAnnounceNextMock).toHaveBeenCalledTimes(1);
    });
    // Second click on the tap zone (not the disabled button) while still
    // submitting — should be swallowed by the kind-check guard.
    await userEvent.click(screen.getByText(/up next/i));
    expect(postAnnounceNextMock).toHaveBeenCalledTimes(1);
    // Tidy the pending promise so React doesn't warn.
    resolveReveal?.({ ok: true, data: { finished: false } });
  });
});

// ─── A11 announcer roster (SPEC §10.2 step 7) ───────────────────────────────

describe("<AnnouncingView> — owner-only announcer roster", () => {
  beforeEach(() => {
    postAnnounceNextMock.mockReset();
    postAnnounceHandoffMock.mockReset();
    postAnnounceSkipMock.mockReset();
    postAnnounceRestoreMock.mockReset();
    useRoomPresenceMock.mockReset();
    useRoomPresenceMock.mockImplementation(() => new Set<string>());
    mockResultsFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const ROSTER = [
    {
      userId: ANNOUNCER_ID,
      displayName: "Bob",
      avatarSeed: "seed-bob",
    },
    {
      userId: "44444444-4444-4444-8444-444444444444",
      displayName: "Carol",
      avatarSeed: "seed-carol",
    },
  ];

  it("renders the roster panel for the owner with members listed", async () => {
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={OWNER_ID}
        members={ROSTER}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("announcer-roster")).toBeInTheDocument(),
    );
    expect(screen.getByTestId(`roster-row-${ANNOUNCER_ID}`)).toBeInTheDocument();
    expect(
      screen.getByTestId("roster-row-44444444-4444-4444-8444-444444444444"),
    ).toBeInTheDocument();
  });

  it("does NOT render the roster panel for non-owner viewers (announcer)", async () => {
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={ANNOUNCER_ID}
        members={ROSTER}
      />,
    );
    // Active-announcer mode renders the tap zone — wait for that as the
    // load signal. (Austria appears twice for this user, in the Up-next
    // card + the leaderboard, which would fail getByText.)
    await waitFor(() =>
      expect(screen.getByTestId("active-driver-tap-zone")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("announcer-roster")).not.toBeInTheDocument();
  });

  it("does NOT render the roster panel when members prop is omitted", async () => {
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={OWNER_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("Austria")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("announcer-roster")).not.toBeInTheDocument();
  });

  it("flags the row matching presenceUserIds as online", async () => {
    useRoomPresenceMock.mockImplementation(() => new Set([ANNOUNCER_ID]));
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={OWNER_ID}
        members={ROSTER}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId(`roster-row-${ANNOUNCER_ID}`)).toHaveAttribute(
        "data-online",
        "true",
      ),
    );
    expect(
      screen.getByTestId("roster-row-44444444-4444-4444-8444-444444444444"),
    ).toHaveAttribute("data-online", "false");
  });

  it("highlights the current announcer's row inside the roster", async () => {
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={OWNER_ID}
        members={ROSTER}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId(`roster-row-${ANNOUNCER_ID}`)).toHaveAttribute(
        "data-current-announcer",
        "true",
      ),
    );
  });

  // ─── §10.2.1 stage 2 — restore-skipped wiring ──────────────────────────
  describe("restore-skipped CTA wiring", () => {
    const CAROL_ID = "44444444-4444-4444-8444-444444444444";

    it("renders the Restore button on skipped rows from announcement.skippedUserIds", async () => {
      mockResultsFetch({
        ...RESULTS_RESPONSE_BODY,
        announcement: {
          ...ANNOUNCEMENT_STATE,
          skippedUserIds: [CAROL_ID],
        },
      });
      render(
        <AnnouncingView
          room={ROOM}
          contestants={CONTESTANTS}
          currentUserId={OWNER_ID}
          members={ROSTER}
        />,
      );
      await waitFor(() =>
        expect(
          screen.getByTestId(`roster-restore-${CAROL_ID}`),
        ).toBeInTheDocument(),
      );
      // Bob isn't skipped → no restore button on him.
      expect(
        screen.queryByTestId(`roster-restore-${ANNOUNCER_ID}`),
      ).not.toBeInTheDocument();
    });

    it("calls postAnnounceRestore with (roomId, ownerId, restoreUserId, deps) on click", async () => {
      mockResultsFetch({
        ...RESULTS_RESPONSE_BODY,
        announcement: {
          ...ANNOUNCEMENT_STATE,
          skippedUserIds: [CAROL_ID],
        },
      });
      postAnnounceRestoreMock.mockResolvedValue({
        ok: true,
        data: {
          restoredUserId: CAROL_ID,
          restoredDisplayName: "Carol",
          announcementOrder: [],
          announceSkippedUserIds: [],
        },
      });
      render(
        <AnnouncingView
          room={ROOM}
          contestants={CONTESTANTS}
          currentUserId={OWNER_ID}
          members={ROSTER}
        />,
      );
      const btn = await screen.findByTestId(`roster-restore-${CAROL_ID}`);
      await userEvent.click(btn);
      await waitFor(() => {
        expect(postAnnounceRestoreMock).toHaveBeenCalledTimes(1);
      });
      expect(postAnnounceRestoreMock).toHaveBeenCalledWith(
        ROOM_ID,
        OWNER_ID,
        CAROL_ID,
        expect.objectContaining({ fetch: expect.any(Function) }),
      );
    });

    it("disables the in-flight Restore button + flips to 'Restoring…'", async () => {
      mockResultsFetch({
        ...RESULTS_RESPONSE_BODY,
        announcement: {
          ...ANNOUNCEMENT_STATE,
          skippedUserIds: [CAROL_ID],
        },
      });
      let resolveRestore: ((v: unknown) => void) | undefined;
      postAnnounceRestoreMock.mockImplementation(
        () => new Promise((r) => (resolveRestore = r)),
      );
      render(
        <AnnouncingView
          room={ROOM}
          contestants={CONTESTANTS}
          currentUserId={OWNER_ID}
          members={ROSTER}
        />,
      );
      await userEvent.click(
        await screen.findByTestId(`roster-restore-${CAROL_ID}`),
      );
      await waitFor(() => {
        const btn = screen.getByTestId(
          `roster-restore-${CAROL_ID}`,
        ) as HTMLButtonElement;
        expect(btn).toBeDisabled();
        expect(btn).toHaveTextContent(/restoring/i);
      });
      // Tidy the pending promise.
      resolveRestore?.({ ok: true, data: { announceSkippedUserIds: [] } });
    });

    it("renders an inline error when the restore call fails", async () => {
      mockResultsFetch({
        ...RESULTS_RESPONSE_BODY,
        announcement: {
          ...ANNOUNCEMENT_STATE,
          skippedUserIds: [CAROL_ID],
        },
      });
      postAnnounceRestoreMock.mockResolvedValue({
        ok: false,
        code: "USER_NOT_SKIPPED",
        message: "nothing to restore",
      });
      render(
        <AnnouncingView
          room={ROOM}
          contestants={CONTESTANTS}
          currentUserId={OWNER_ID}
          members={ROSTER}
        />,
      );
      await userEvent.click(
        await screen.findByTestId(`roster-restore-${CAROL_ID}`),
      );
      await waitFor(() =>
        expect(screen.getByTestId("restore-error")).toBeInTheDocument(),
      );
      // Roster row stays visible — failure doesn't optimistically remove
      // the skipped marker. The next refetch (on broadcast or subsequent
      // success) will reconcile.
      expect(
        screen.getByTestId(`roster-row-${CAROL_ID}`),
      ).toHaveAttribute("data-skipped", "true");
    });
  });
});

// ─── R4 #2 cascade-exhaust + batch-reveal chip ───────────────────────────────

describe("<AnnouncingView> — cascade-exhaust state (R4 #2 'Finish the show')", () => {
  function makeCascadeExhaustedFetch(overrides: Record<string, unknown> = {}) {
    // Fetch returns announcement=null to simulate cascade-exhausted state
    // (no active announcer).
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "announcing",
        leaderboard: [],
        announcement: null,
        ...overrides,
      }),
    } as unknown as Response);
  }

  function makeBatchRevealFetch() {
    // Fetch returns an active announcement (Bob) so the announcer header renders.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => RESULTS_RESPONSE_BODY,
    } as unknown as Response);
  }

  const CASCADE_ROOM = {
    id: ROOM_ID,
    status: "announcing",
    ownerUserId: OWNER_ID,
    batchRevealMode: false,
  };

  const BATCH_REVEAL_ROOM = {
    id: ROOM_ID,
    status: "announcing",
    ownerUserId: OWNER_ID,
    batchRevealMode: true,
  };

  beforeEach(() => {
    postFinishShowMock.mockReset();
    makeCascadeExhaustedFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders 'Finish the show' CTA for owner when announcingUserId is null and batchRevealMode is false", async () => {
    render(
      <AnnouncingView
        room={CASCADE_ROOM}
        contestants={[]}
        currentUserId={OWNER_ID}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /finish the show/i }),
      ).toBeVisible(),
    );
  });

  it("renders waiting copy for non-owner in cascade-exhaust", async () => {
    render(
      <AnnouncingView
        room={CASCADE_ROOM}
        contestants={[]}
        currentUserId="00000000-0000-4000-8000-000000000099"
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/waiting for the host/i)).toBeVisible(),
    );
    expect(
      screen.queryByRole("button", { name: /finish the show/i }),
    ).toBeNull();
  });

  it("does NOT render the Finish CTA when batchRevealMode is true (already in batch-reveal)", async () => {
    makeBatchRevealFetch();
    render(
      <AnnouncingView
        room={BATCH_REVEAL_ROOM}
        contestants={CONTESTANTS}
        currentUserId={OWNER_ID}
      />,
    );
    // Wait for render to settle after the fetch
    await waitFor(() =>
      expect(screen.getByText("Austria")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /finish the show/i }),
    ).toBeNull();
  });

  it("renders the 'Host is finishing the show' chip when batchRevealMode is true", async () => {
    makeBatchRevealFetch();
    render(
      <AnnouncingView
        room={BATCH_REVEAL_ROOM}
        contestants={CONTESTANTS}
        currentUserId={OWNER_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/host is finishing the show/i)).toBeVisible(),
    );
  });

  it("clicking 'Finish the show' calls postFinishShow with (roomId, userId, deps)", async () => {
    postFinishShowMock.mockResolvedValue({ ok: true, data: { announcingUserId: ANNOUNCER_ID, displayName: "Alice" } });
    const user = userEvent.setup();
    render(
      <AnnouncingView
        room={CASCADE_ROOM}
        contestants={[]}
        currentUserId={OWNER_ID}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /finish the show/i }),
      ).toBeVisible(),
    );
    await user.click(screen.getByRole("button", { name: /finish the show/i }));
    await waitFor(() =>
      expect(postFinishShowMock).toHaveBeenCalledWith(
        ROOM_ID,
        OWNER_ID,
        expect.objectContaining({ fetch: expect.any(Function) }),
      ),
    );
  });
});

// ─── R4 #4 re-shuffle order button (AnnouncingView wiring) ───────────────────

describe("AnnouncingView — re-shuffle order button (R4 #4)", () => {
  beforeEach(() => {
    patchAnnouncementOrderMock.mockReset();
    mockResultsFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const ROSTER = [
    { userId: OWNER_ID, displayName: "Admin", avatarSeed: "x" },
    { userId: ANNOUNCER_ID, displayName: "Alice", avatarSeed: "a" },
  ];

  it("owner sees the re-shuffle button when announcement state is fresh (no advance yet)", () => {
    render(
      <AnnouncingView
        room={ROOM}
        contestants={[]}
        currentUserId={OWNER_ID}
        members={ROSTER}
        announcement={{
          announcingUserId: ANNOUNCER_ID,
          announcingDisplayName: "Alice",
          announcingAvatarSeed: "a",
          currentAnnounceIdx: 0,
          pendingReveal: { contestantId: "c1", points: 1 },
          queueLength: 10,
          delegateUserId: null,
          announcerPosition: 1,
          announcerCount: 3,
          skippedUserIds: [],
        }}
      />,
    );
    expect(screen.getByTestId("roster-reshuffle")).toBeInTheDocument();
  });

  it("owner does NOT see the button after first reveal (currentAnnounceIdx > 0)", () => {
    render(
      <AnnouncingView
        room={ROOM}
        contestants={[]}
        currentUserId={OWNER_ID}
        members={ROSTER}
        announcement={{
          announcingUserId: ANNOUNCER_ID,
          announcingDisplayName: "Alice",
          announcingAvatarSeed: "a",
          currentAnnounceIdx: 1,
          pendingReveal: { contestantId: "c2", points: 2 },
          queueLength: 10,
          delegateUserId: null,
          announcerPosition: 1,
          announcerCount: 3,
          skippedUserIds: [],
        }}
      />,
    );
    expect(screen.queryByTestId("roster-reshuffle")).toBeNull();
  });

  it("owner does NOT see the button after rotation (announcerPosition > 1)", () => {
    render(
      <AnnouncingView
        room={ROOM}
        contestants={[]}
        currentUserId={OWNER_ID}
        members={ROSTER}
        announcement={{
          announcingUserId: ANNOUNCER_ID,
          announcingDisplayName: "Alice",
          announcingAvatarSeed: "a",
          currentAnnounceIdx: 0,
          pendingReveal: { contestantId: "c1", points: 1 },
          queueLength: 10,
          delegateUserId: null,
          announcerPosition: 2,
          announcerCount: 3,
          skippedUserIds: [],
        }}
      />,
    );
    expect(screen.queryByTestId("roster-reshuffle")).toBeNull();
  });
});

// ─── R4 Task 4 — announcement_order_reshuffled broadcast subscriber ───────────

describe("AnnouncingView — announcement_order_reshuffled broadcast (R4 #4 task 4)", () => {
  beforeEach(() => {
    capturedRoomEventHandler = null;
    mockResultsFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("announcement_order_reshuffled event triggers refetch via onAnnouncementEnded", async () => {
    const onAnnouncementEnded = vi.fn();
    render(
      <AnnouncingView
        room={ROOM}
        contestants={[]}
        currentUserId={OWNER_ID}
        onAnnouncementEnded={onAnnouncementEnded}
      />,
    );
    // Wait for the component to mount and register the handler.
    await waitFor(() => expect(capturedRoomEventHandler).not.toBeNull());
    onAnnouncementEnded.mockClear();
    fireRoomEvent({
      type: "announcement_order_reshuffled",
      announcementOrder: ["u1", "u2", "u3"],
      announcingUserId: "u1",
    });
    expect(onAnnouncementEnded).toHaveBeenCalled();
  });
});

// ─── R4 §10.2.2 — short-style render branches ────────────────────────────────

describe("AnnouncingView — short style (SPEC §10.2.2)", () => {
  beforeEach(() => {
    postAnnounceNextMock.mockReset();
    postAnnounceHandoffMock.mockReset();
    postAnnounceSkipMock.mockReset();
    capturedRoomEventHandler = null;
    mockResultsFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Case A: active announcer + style='short' renders short CTA, not tap-zone
  it("Case A — active announcer + style='short' renders 'Reveal 12 points' CTA and microcopy, not tap-zone", async () => {
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={ANNOUNCER_ID}
        announcement={ANNOUNCEMENT_STATE}
        announcementStyle="short"
      />,
    );
    // Wait for the short CTA to appear
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /reveal 12 points/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/tap when you say it/i)).toBeInTheDocument();
    // The existing full-style tap-zone copy should NOT be visible
    expect(screen.queryByText(/tap anywhere to reveal/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("active-driver-tap-zone")).not.toBeInTheDocument();
  });

  // Case B: active announcer + style='full' (control) renders existing tap-zone
  it("Case B — active announcer + style='full' renders existing tap-zone, not short CTA", async () => {
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={ANNOUNCER_ID}
        announcement={ANNOUNCEMENT_STATE}
        announcementStyle="full"
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("active-driver-tap-zone")).toBeInTheDocument(),
    );
    expect(screen.getByText(/tap anywhere to reveal/i)).toBeInTheDocument();
    // Short CTA should NOT be present
    expect(
      screen.queryByRole("button", { name: /reveal 12 points/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/tap when you say it/i)).not.toBeInTheDocument();
  });

  // Case C: active announcer + style='short' + justRevealed event → splash, not CTA
  it("Case C — active announcer + style='short' + announce_next event renders splash (card size), not CTA", async () => {
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={ANNOUNCER_ID}
        announcement={ANNOUNCEMENT_STATE}
        announcementStyle="short"
      />,
    );
    // Wait for the component to mount and register the event handler
    await waitFor(() => expect(capturedRoomEventHandler).not.toBeNull());
    // Fire an announce_next event as the current user (active driver)
    fireRoomEvent({
      type: "announce_next",
      contestantId: "2026-AT",
      points: 12,
      announcingUserId: ANNOUNCER_ID,
    });
    // After the event, the CTA should disappear and the splash should show
    await waitFor(() =>
      expect(screen.getByTestId("twelve-point-splash")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("twelve-point-splash")).toHaveAttribute(
      "data-size",
      "card",
    );
    // The CTA button should not be visible (splash replaced it)
    expect(
      screen.queryByRole("button", { name: /reveal 12 points/i }),
    ).not.toBeInTheDocument();
  });

  // Case D: guest watching + style='short' + announce_next from another user → toast appears
  it("Case D — guest + style='short' + announce_next from another user renders TwelvePointToast", async () => {
    const GUEST_ID = "99999999-9999-4999-8999-999999999999";
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={GUEST_ID}
        announcement={ANNOUNCEMENT_STATE}
        announcementStyle="short"
      />,
    );
    // Wait for mount and handler capture
    await waitFor(() => expect(capturedRoomEventHandler).not.toBeNull());
    // Fire announce_next from the announcer (different from guest)
    fireRoomEvent({
      type: "announce_next",
      contestantId: "2026-AT",
      points: 12,
      announcingUserId: ANNOUNCER_ID,
    });
    // Toast should appear with the announcer name + country
    await waitFor(() =>
      expect(screen.getByTestId("reveal-toast")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("reveal-toast")).toHaveTextContent("Bob");
    expect(screen.getByTestId("reveal-toast")).toHaveTextContent("Austria");
  });

  // Case E: guest watching + style='full' — toast NOW renders on every
  // announce_next (SPEC §10.2 surface table for "Other guests' phones").
  // Pre-L1-split this assertion was inverted; flipped 2026-05-12.
  it("Case E — guest + style='full' + announce_next renders RevealToast with points", async () => {
    const GUEST_ID = "99999999-9999-4999-8999-999999999999";
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={GUEST_ID}
        announcement={ANNOUNCEMENT_STATE}
        announcementStyle="full"
      />,
    );
    await waitFor(() => expect(capturedRoomEventHandler).not.toBeNull());
    fireRoomEvent({
      type: "announce_next",
      contestantId: "2026-AT",
      points: 5,
      announcingUserId: ANNOUNCER_ID,
    });
    await waitFor(() =>
      expect(screen.getByTestId("reveal-toast")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("reveal-toast")).toHaveTextContent(
      "gave 5 to",
    );
    expect(screen.getByTestId("reveal-toast")).toHaveTextContent("Austria");
  });

  // Case F: active announcer receives their own announce_next echo —
  // the big flash card renders for them but no toast fires for self.
  it("Case F — active announcer + announce_next for self renders flash card, NOT toast", async () => {
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={ANNOUNCER_ID}
        announcement={ANNOUNCEMENT_STATE}
        announcementStyle="full"
      />,
    );
    await waitFor(() => expect(capturedRoomEventHandler).not.toBeNull());
    fireRoomEvent({
      type: "announce_next",
      contestantId: "2026-AT",
      points: 5,
      announcingUserId: ANNOUNCER_ID,
    });
    // Flash card detection: the translations mock renders
    // announcing.justRevealed.pointsLabel as "{points} points" — so
    // "5 points" appearing on screen confirms the flash card branch fired.
    await waitFor(() =>
      expect(screen.getByText("5 points")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("reveal-toast")).not.toBeInTheDocument();
  });

  // Case G: guest watcher receiving announce_next sees the toast, NOT
  // the big "Just revealed" flash card. Inverse of Case F.
  it("Case G — guest watcher + announce_next renders toast, NOT flash card", async () => {
    const GUEST_ID = "99999999-9999-4999-8999-999999999999";
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={GUEST_ID}
        announcement={ANNOUNCEMENT_STATE}
        announcementStyle="full"
      />,
    );
    await waitFor(() => expect(capturedRoomEventHandler).not.toBeNull());
    fireRoomEvent({
      type: "announce_next",
      contestantId: "2026-AT",
      points: 5,
      announcingUserId: ANNOUNCER_ID,
    });
    await waitFor(() =>
      expect(screen.getByTestId("reveal-toast")).toBeInTheDocument(),
    );
    // Watcher surface suppresses the "5 points" flash-card text entirely.
    expect(screen.queryByText("5 points")).not.toBeInTheDocument();
  });

  // Case H: full-style active driver sees the StillToGiveLine.
  it("Case H — active driver + style='full' renders StillToGiveLine with split", async () => {
    const stateAtIdx3: typeof ANNOUNCEMENT_STATE = {
      ...ANNOUNCEMENT_STATE,
      currentAnnounceIdx: 3,
      queueLength: 10,
    };
    // Override fetch so the on-mount refetch doesn't clobber the
    // queueLength: 10 seed we need for StillToGiveLine to mount.
    mockResultsFetch({
      ...RESULTS_RESPONSE_BODY,
      announcement: stateAtIdx3,
    });
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={ANNOUNCER_ID}
        announcement={stateAtIdx3}
        announcementStyle="full"
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("still-to-give-line")).toBeInTheDocument(),
    );
    // Given values are line-through; remaining are bold. The data-testids
    // distinguish them; we don't assert on the live class strings here
    // (StillToGiveLine.test.tsx owns those).
    expect(screen.getByTestId("stg-given-1")).toBeInTheDocument();
    expect(screen.getByTestId("stg-given-3")).toBeInTheDocument();
    expect(screen.getByTestId("stg-remaining-4")).toBeInTheDocument();
    expect(screen.getByTestId("stg-remaining-12")).toBeInTheDocument();
  });

  // Case I: short-style active driver does NOT see StillToGiveLine
  // (degenerate — short style is always 1 reveal per announcer).
  it("Case I — active driver + style='short' suppresses StillToGiveLine", async () => {
    const shortState: typeof ANNOUNCEMENT_STATE = {
      ...ANNOUNCEMENT_STATE,
      queueLength: 1,
    };
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={ANNOUNCER_ID}
        announcement={shortState}
        announcementStyle="short"
      />,
    );
    await waitFor(() => expect(capturedRoomEventHandler).not.toBeNull());
    expect(
      screen.queryByTestId("still-to-give-line"),
    ).not.toBeInTheDocument();
  });

  // Case J: leaderboard rows render with data-density='watcher' for
  // guests and 'driver' for the active announcer. The shared
  // data-testid='leaderboard-row' + data-density discriminator avoids
  // testid collisions while keeping the density signal queryable.
  it("Case J — watcher renders density='watcher' leaderboard rows, driver renders density='driver'", async () => {
    const GUEST_ID = "99999999-9999-4999-8999-999999999999";

    // Watcher mount
    const { unmount } = render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={GUEST_ID}
        announcement={ANNOUNCEMENT_STATE}
        announcementStyle="full"
      />,
    );
    await waitFor(() =>
      expect(screen.queryAllByTestId("leaderboard-row").length).toBeGreaterThan(0),
    );
    {
      const rows = screen.getAllByTestId("leaderboard-row");
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.dataset.density).toBe("watcher");
      }
    }
    unmount();

    // Driver mount — fresh render. cleanup() is wired afterEach but we
    // unmount explicitly to avoid stale rows leaking into the second
    // render's queries.
    render(
      <AnnouncingView
        room={ROOM}
        contestants={CONTESTANTS}
        currentUserId={ANNOUNCER_ID}
        announcement={ANNOUNCEMENT_STATE}
        announcementStyle="full"
      />,
    );
    await waitFor(() =>
      expect(screen.queryAllByTestId("leaderboard-row").length).toBeGreaterThan(0),
    );
    {
      const rows = screen.getAllByTestId("leaderboard-row");
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.dataset.density).toBe("driver");
      }
    }
  });
});
