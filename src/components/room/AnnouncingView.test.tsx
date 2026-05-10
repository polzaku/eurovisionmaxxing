// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ─── Mocks ───────────────────────────────────────────────────────────────────
// useRoomRealtime is a side-effect-only subscription; for these tests we
// only care about the initial fetch + manual user actions.
vi.mock("@/hooks/useRoomRealtime", () => ({
  useRoomRealtime: () => {},
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

// SkipBannerQueue uses next-intl — stub it out so AnnouncingView tests
// don't need an intl provider. The null-render when events=[] is what
// existing tests rely on; a banner stub is fine for the rare test that
// triggers announce_skip.
vi.mock("@/components/room/SkipBannerQueue", () => ({
  default: () => null,
}));

// API helpers — controllable per-test via mockImplementation in beforeEach.
const postAnnounceNextMock = vi.fn();
const postAnnounceHandoffMock = vi.fn();
const postAnnounceSkipMock = vi.fn();
const postAnnounceRestoreMock = vi.fn();

vi.mock("@/lib/room/api", () => ({
  postAnnounceNext: (...args: unknown[]) => postAnnounceNextMock(...args),
  postAnnounceHandoff: (...args: unknown[]) => postAnnounceHandoffMock(...args),
  postAnnounceSkip: (...args: unknown[]) => postAnnounceSkipMock(...args),
  postAnnounceRestore: (...args: unknown[]) => postAnnounceRestoreMock(...args),
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
    await waitFor(() =>
      expect(screen.getByText(/bob is announcing/i)).toBeInTheDocument(),
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
      expect(screen.getByText(/bob is announcing/i)).toBeInTheDocument(),
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
      expect(screen.getByText(/carol is announcing/i)).toBeInTheDocument(),
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
