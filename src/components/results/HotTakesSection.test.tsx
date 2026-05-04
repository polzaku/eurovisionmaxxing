// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

const getSessionMock = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => getSessionMock(),
}));

const deleteHotTakeApiMock = vi.fn();
vi.mock("@/lib/voting/deleteHotTakeApi", () => ({
  deleteHotTakeApi: (
    ...args: Parameters<typeof deleteHotTakeApiMock>
  ) => deleteHotTakeApiMock(...args),
}));

import HotTakesSection, {
  type HotTakeRow,
} from "./HotTakesSection";
import type { Contestant } from "@/types";

const ROOM_ID = "11111111-2222-4333-8444-555555555555";
const OWNER_ID = "owner-aaaa";
const GUEST_ID = "guest-bbbb";
const ALICE_ID = "alice-cccc";
const BOB_ID = "bob-dddd";

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
];

const ALICE_HOT_TAKE: HotTakeRow = {
  userId: ALICE_ID,
  displayName: "Alice",
  avatarSeed: "seed-alice",
  contestantId: "2026-se",
  hotTake: "Stunning vocals.",
  hotTakeEditedAt: null,
};
const BOB_HOT_TAKE: HotTakeRow = {
  userId: BOB_ID,
  displayName: "Bob",
  avatarSeed: "seed-bob",
  contestantId: "2026-ua",
  hotTake: "Best stage of the night.",
  hotTakeEditedAt: "2026-04-25T08:00:00.000Z",
};

const baseProps = {
  title: "Hot takes",
  editedLabel: "edited",
  hotTakes: [ALICE_HOT_TAKE, BOB_HOT_TAKE],
  contestants: CONTESTANTS,
  roomId: ROOM_ID,
  ownerUserId: OWNER_ID,
};

describe("<HotTakesSection> — basic rendering", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    getSessionMock.mockReturnValue(null);
    deleteHotTakeApiMock.mockReset();
  });

  it("renders title + every hot-take grouped under its country", () => {
    render(<HotTakesSection {...baseProps} />);
    expect(screen.getByTestId("hot-takes-section")).toBeInTheDocument();
    expect(screen.getByText("Hot takes")).toBeInTheDocument();
    expect(screen.getByText("Sweden")).toBeInTheDocument();
    expect(screen.getByText("Ukraine")).toBeInTheDocument();
    expect(screen.getByText("Stunning vocals.")).toBeInTheDocument();
    expect(screen.getByText("Best stage of the night.")).toBeInTheDocument();
  });

  it("renders the 'edited' tag only on rows with non-null hotTakeEditedAt", () => {
    render(<HotTakesSection {...baseProps} />);
    const tags = screen.getAllByTestId("hot-take-edited-tag");
    expect(tags).toHaveLength(1);
    expect(tags[0].textContent).toBe("edited");
  });

  it("renders nothing (empty section) when hotTakes is empty", () => {
    const { container } = render(
      <HotTakesSection {...baseProps} hotTakes={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("<HotTakesSection> — admin gating (SPEC §8.7.2)", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    deleteHotTakeApiMock.mockReset();
  });

  it("does NOT render trash icons for unauthenticated viewers", () => {
    getSessionMock.mockReturnValue(null);
    render(<HotTakesSection {...baseProps} />);
    expect(
      screen.queryByTestId(`hot-take-delete-${ALICE_ID}-2026-se`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(`hot-take-delete-${BOB_ID}-2026-ua`),
    ).not.toBeInTheDocument();
  });

  it("does NOT render trash icons when the viewer is a non-owner guest", async () => {
    getSessionMock.mockReturnValue({
      userId: GUEST_ID,
      rejoinToken: "x",
      expiresAt: "2099-01-01T00:00:00Z",
    });
    render(<HotTakesSection {...baseProps} />);
    // useEffect runs after first render — wait a tick to confirm the
    // session was read and the icon stayed off.
    await waitFor(() => {
      expect(getSessionMock).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId(`hot-take-delete-${ALICE_ID}-2026-se`),
    ).not.toBeInTheDocument();
  });

  it("renders trash icons on every hot-take when the viewer matches ownerUserId", async () => {
    getSessionMock.mockReturnValue({
      userId: OWNER_ID,
      rejoinToken: "x",
      expiresAt: "2099-01-01T00:00:00Z",
    });
    render(<HotTakesSection {...baseProps} />);
    await waitFor(() => {
      expect(
        screen.getByTestId(`hot-take-delete-${ALICE_ID}-2026-se`),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId(`hot-take-delete-${BOB_ID}-2026-ua`),
    ).toBeInTheDocument();
  });
});

describe("<HotTakesSection> — delete confirm modal flow", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    getSessionMock.mockReturnValue({
      userId: OWNER_ID,
      rejoinToken: "x",
      expiresAt: "2099-01-01T00:00:00Z",
    });
    deleteHotTakeApiMock.mockReset();
  });

  it("opens the confirm modal on trash icon click + interpolates the author's name", async () => {
    render(<HotTakesSection {...baseProps} />);
    const btn = await screen.findByTestId(
      `hot-take-delete-${ALICE_ID}-2026-se`,
    );
    fireEvent.click(btn);
    expect(screen.getByTestId("hot-take-delete-confirm")).toBeInTheDocument();
    // Mock joins params onto the key — assert Alice's name landed.
    expect(
      screen.getByText(/results\.hotTake\.deleteConfirmBody.*Alice/),
    ).toBeInTheDocument();
  });

  it("Cancel closes the modal without calling the API", async () => {
    render(<HotTakesSection {...baseProps} />);
    fireEvent.click(
      await screen.findByTestId(`hot-take-delete-${ALICE_ID}-2026-se`),
    );
    fireEvent.click(
      screen.getByText("results.hotTake.deleteCancel"),
    );
    expect(
      screen.queryByTestId("hot-take-delete-confirm"),
    ).not.toBeInTheDocument();
    expect(deleteHotTakeApiMock).not.toHaveBeenCalled();
  });

  it("Delete calls deleteHotTakeApi with (roomId, viewer, target, contestantId) + removes the row optimistically", async () => {
    deleteHotTakeApiMock.mockResolvedValue({
      ok: true,
      data: { deleted: true },
    });
    render(<HotTakesSection {...baseProps} />);
    fireEvent.click(
      await screen.findByTestId(`hot-take-delete-${ALICE_ID}-2026-se`),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("hot-take-delete-confirm-action"));
    });
    expect(deleteHotTakeApiMock).toHaveBeenCalledTimes(1);
    expect(deleteHotTakeApiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: ROOM_ID,
        userId: OWNER_ID,
        targetUserId: ALICE_ID,
        contestantId: "2026-se",
      }),
      expect.objectContaining({ fetch: expect.any(Function) }),
    );
    // Modal closed + Alice's row gone; Bob's row still present.
    expect(
      screen.queryByTestId("hot-take-delete-confirm"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Stunning vocals.")).not.toBeInTheDocument();
    expect(screen.getByText("Best stage of the night.")).toBeInTheDocument();
  });

  it("surfaces an error in the modal when the API call fails (row stays)", async () => {
    deleteHotTakeApiMock.mockResolvedValue({
      ok: false,
      code: "INTERNAL_ERROR",
      message: "boom",
    });
    render(<HotTakesSection {...baseProps} />);
    fireEvent.click(
      await screen.findByTestId(`hot-take-delete-${ALICE_ID}-2026-se`),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("hot-take-delete-confirm-action"));
    });
    expect(screen.getByTestId("hot-take-delete-error")).toBeInTheDocument();
    // Row is still on the page — no optimistic removal on failure.
    expect(screen.getByText("Stunning vocals.")).toBeInTheDocument();
    // Modal stays open for retry.
    expect(screen.getByTestId("hot-take-delete-confirm")).toBeInTheDocument();
  });
});
