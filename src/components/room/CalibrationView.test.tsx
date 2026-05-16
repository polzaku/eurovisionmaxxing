// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) =>
    (key: string, params?: Record<string, unknown>) => {
      const full = namespace ? `${namespace}.${key}` : key;
      return params ? `${full}:${JSON.stringify(params)}` : full;
    },
}));

// Capture the realtime handler so tests can fire status_changed events.
let capturedRealtimeHandler: ((event: unknown) => void) | null = null;
vi.mock("@/hooks/useRoomRealtime", () => ({
  useRoomRealtime: (_roomId: string, handler: (event: unknown) => void) => {
    capturedRealtimeHandler = handler;
  },
}));

import CalibrationView from "./CalibrationView";

const ROOM_ID = "11111111-1111-1111-1111-111111111111";
const OWNER_ID = "22222222-2222-2222-2222-222222222222";
const GUEST_ID = "33333333-3333-3333-3333-333333333333";

const RESULTS_BODY = {
  status: "calibration",
  contestants: [
    {
      id: "2026-se",
      year: 2026,
      event: "final",
      countryCode: "se",
      country: "Sweden",
      artist: "A",
      song: "Song SE",
      flagEmoji: "flag-se",
      runningOrder: 1,
    },
  ],
  ownBreakdown: {
    userId: OWNER_ID,
    displayName: "Alice",
    avatarSeed: "seed-alice",
    picks: [{ contestantId: "2026-se", pointsAwarded: 12 }],
  },
  firstAnnouncerName: "Bob",
};

const fetchMock = vi.fn();

beforeEach(() => {
  capturedRealtimeHandler = null;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockResultsResponse(body: unknown = RESULTS_BODY) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

describe("<CalibrationView>", () => {
  it("renders the user's own picks + first-announcer copy after the results fetch", async () => {
    mockResultsResponse();
    render(
      <CalibrationView
        roomId={ROOM_ID}
        currentUserId={OWNER_ID}
        isOwner={true}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("user-picks-list")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("user-pick-2026-se")).toHaveTextContent("12");
    expect(
      screen.getByTestId("calibration-first-announcer"),
    ).toHaveTextContent('"name":"Bob"');
  });

  it("renders the empty state when ownBreakdown is null", async () => {
    mockResultsResponse({
      ...RESULTS_BODY,
      ownBreakdown: null,
    });
    render(
      <CalibrationView
        roomId={ROOM_ID}
        currentUserId={OWNER_ID}
        isOwner={true}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("calibration-empty")).toBeInTheDocument(),
    );
  });

  it("renders the Start announcing button only for the owner", async () => {
    mockResultsResponse();
    render(
      <CalibrationView
        roomId={ROOM_ID}
        currentUserId={OWNER_ID}
        isOwner={true}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("calibration-start-button"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("calibration-waiting-for-owner"),
    ).not.toBeInTheDocument();
  });

  it("renders the waiting line and no button for non-owners", async () => {
    mockResultsResponse();
    render(
      <CalibrationView
        roomId={ROOM_ID}
        currentUserId={GUEST_ID}
        isOwner={false}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("calibration-waiting-for-owner"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("calibration-start-button"),
    ).not.toBeInTheDocument();
  });

  it("POSTs /start-announcing when the owner clicks the button", async () => {
    mockResultsResponse();
    // The start-announcing POST response.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    } as unknown as Response);
    render(
      <CalibrationView
        roomId={ROOM_ID}
        currentUserId={OWNER_ID}
        isOwner={true}
      />,
    );
    const btn = await screen.findByTestId("calibration-start-button");
    await userEvent.click(btn);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url, init]) =>
          typeof url === "string" &&
          url.includes("/start-announcing") &&
          (init as RequestInit | undefined)?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("calls onCalibrationEnded when realtime status_changed fires for a non-calibration status", async () => {
    mockResultsResponse();
    const onEnded = vi.fn();
    render(
      <CalibrationView
        roomId={ROOM_ID}
        currentUserId={OWNER_ID}
        isOwner={true}
        onCalibrationEnded={onEnded}
      />,
    );
    await waitFor(() => expect(capturedRealtimeHandler).not.toBeNull());
    capturedRealtimeHandler?.({
      type: "status_changed",
      status: "announcing",
    });
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onCalibrationEnded for status_changed to 'calibration' (no-op)", async () => {
    mockResultsResponse();
    const onEnded = vi.fn();
    render(
      <CalibrationView
        roomId={ROOM_ID}
        currentUserId={OWNER_ID}
        isOwner={true}
        onCalibrationEnded={onEnded}
      />,
    );
    await waitFor(() => expect(capturedRealtimeHandler).not.toBeNull());
    capturedRealtimeHandler?.({
      type: "status_changed",
      status: "calibration",
    });
    expect(onEnded).not.toHaveBeenCalled();
  });
});
