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

import { GET } from "@/app/api/rooms/[id]/results/route";
import { NextRequest } from "next/server";

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost/api/rooms/${VALID_ROOM_ID}/results`,
  );
}

beforeEach(() => {
  loadResultsMock.mockReset();
});

describe("GET /api/rooms/[id]/results (room route)", () => {
  it("forwards params.id and returns the loader's payload on 200", async () => {
    loadResultsMock.mockResolvedValue({
      ok: true,
      data: {
        status: "announcing",
        year: 2026,
        event: "final",
        pin: "X",
        leaderboard: [],
        contestants: [],
      },
    });
    const res = await GET(makeRequest(), { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(200);
    expect(loadResultsMock).toHaveBeenCalledWith(
      { roomId: VALID_ROOM_ID },
      expect.objectContaining({
        supabase: expect.any(Object),
        fetchContestants: expect.any(Function),
        fetchContestantsMeta: expect.any(Function),
      }),
    );
  });

  it("maps loader failure to apiError", async () => {
    loadResultsMock.mockResolvedValue({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR", message: "db" },
    });
    const res = await GET(makeRequest(), { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
