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

// API helpers — controllable per-test via mockImplementation in beforeEach.
const postAnnounceNextMock = vi.fn();
const postAnnounceHandoffMock = vi.fn();
const postAnnounceSkipMock = vi.fn();

vi.mock("@/lib/room/api", () => ({
  postAnnounceNext: (...args: unknown[]) => postAnnounceNextMock(...args),
  postAnnounceHandoff: (...args: unknown[]) => postAnnounceHandoffMock(...args),
  postAnnounceSkip: (...args: unknown[]) => postAnnounceSkipMock(...args),
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
