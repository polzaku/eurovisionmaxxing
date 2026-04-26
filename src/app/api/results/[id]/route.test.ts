import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";

const loadResultsMock = vi.fn();

vi.mock("@/lib/results/loadResults", () => ({
  loadResults: (...args: unknown[]) => loadResultsMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ __marker: "service" }),
}));

vi.mock("@/lib/contestants", () => ({
  fetchContestants: vi.fn(),
  fetchContestantsMeta: vi.fn(),
  ContestDataError: class extends Error {},
}));

import { GET } from "@/app/api/results/[id]/route";
import { NextRequest } from "next/server";

function makeRequest(): NextRequest {
  return new NextRequest(`http://localhost/api/results/${VALID_ROOM_ID}`);
}

beforeEach(() => {
  loadResultsMock.mockReset();
});

describe("GET /api/results/[id] (public route)", () => {
  it("returns 200 with the loader's data on success (done)", async () => {
    loadResultsMock.mockResolvedValue({
      ok: true,
      data: {
        status: "done",
        year: 2026,
        event: "final",
        pin: "ABC123",
        leaderboard: [],
        contestants: [],
        breakdowns: [],
        hotTakes: [],
        awards: [],
      },
    });
    const res = await GET(makeRequest(), { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; pin: string };
    expect(body).toMatchObject({ status: "done", pin: "ABC123" });
    expect(loadResultsMock).toHaveBeenCalledWith(
      { roomId: VALID_ROOM_ID },
      expect.objectContaining({
        supabase: expect.any(Object),
        fetchContestants: expect.any(Function),
        fetchContestantsMeta: expect.any(Function),
      }),
    );
  });

  it("returns 200 with placeholder shape for lobby", async () => {
    loadResultsMock.mockResolvedValue({
      ok: true,
      data: {
        status: "lobby",
        pin: "PINPIN",
        broadcastStartUtc: null,
      },
    });
    const res = await GET(makeRequest(), { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("lobby");
  });

  it("maps failure { status, error } to apiError()", async () => {
    loadResultsMock.mockResolvedValue({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND", message: "Room not found." },
    });
    const res = await GET(makeRequest(), { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("propagates field on validation failure", async () => {
    loadResultsMock.mockResolvedValue({
      ok: false,
      status: 400,
      error: {
        code: "INVALID_ROOM_ID",
        message: "bad",
        field: "roomId",
      },
    });
    const res = await GET(makeRequest(), { params: { id: "not-a-uuid" } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { field?: string } };
    expect(body.error.field).toBe("roomId");
  });
});
