import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted — factory must not reference outer variables.
vi.mock("@/lib/rooms/loadOwnPoints", () => ({
  loadOwnPoints: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));

import { POST } from "@/app/api/rooms/[id]/own-points/route";
import { NextRequest } from "next/server";
import { loadOwnPoints } from "@/lib/rooms/loadOwnPoints";

const loadOwnPointsMock = vi.mocked(loadOwnPoints);

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/rooms/r1/own-points", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { id: "r1" };

describe("POST /api/rooms/[id]/own-points (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with entries on success", async () => {
    const entries = [
      { contestantId: "2025-SE", pointsAwarded: 12, hotTake: "Amazing!" },
      { contestantId: "2025-NO", pointsAwarded: 10, hotTake: null },
    ];
    loadOwnPointsMock.mockResolvedValue({ ok: true, entries });

    const res = await POST(makeRequest({ userId: "u1" }), { params });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { entries: typeof entries };
    expect(json.entries).toEqual(entries);
  });

  it("propagates orchestrator error status and code on failure", async () => {
    loadOwnPointsMock.mockResolvedValue({
      ok: false,
      status: 409,
      error: { code: "ROOM_NOT_ANNOUNCING", message: "Not in announcing." },
    });

    const res = await POST(makeRequest({ userId: "u1" }), { params });
    expect(res.status).toBe(409);
    const json = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(json.error.code).toBe("ROOM_NOT_ANNOUNCING");
  });

  it("returns 400 INVALID_BODY on non-JSON body", async () => {
    const req = new NextRequest("http://localhost/api/rooms/r1/own-points", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-valid-json",
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("INVALID_BODY");
  });

  it("passes roomId from URL params and userId from body to orchestrator", async () => {
    loadOwnPointsMock.mockResolvedValue({ ok: true, entries: [] });

    await POST(makeRequest({ userId: "user-xyz" }), {
      params: { id: "room-abc" },
    });
    expect(loadOwnPointsMock).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: "room-abc", userId: "user-xyz" }),
      expect.any(Object),
    );
  });

  it("returns 404 when orchestrator returns ROOM_NOT_FOUND", async () => {
    loadOwnPointsMock.mockResolvedValue({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND", message: "Room not found." },
    });

    const res = await POST(makeRequest({ userId: "u1" }), { params });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("ROOM_NOT_FOUND");
  });
});
