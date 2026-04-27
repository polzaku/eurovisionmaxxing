import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted — factory must not reference outer variables.
vi.mock("@/lib/rooms/markReady", () => ({
  markReady: vi.fn(),
}));

vi.mock("@/lib/rooms/shared", () => ({
  defaultBroadcastRoomEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));

import { POST } from "@/app/api/rooms/[id]/ready/route";
import { NextRequest } from "next/server";
import { markReady } from "@/lib/rooms/markReady";

const markReadyMock = vi.mocked(markReady);

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/rooms/r1/ready", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { id: "r1" };

describe("POST /api/rooms/[id]/ready (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with readyAt/readyCount/totalCount on success", async () => {
    markReadyMock.mockResolvedValue({
      ok: true,
      readyAt: "2026-04-27T10:00:00.000Z",
      readyCount: 2,
      totalCount: 5,
    });

    const res = await POST(makeRequest({ userId: "u1" }), { params });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      readyAt: string;
      readyCount: number;
      totalCount: number;
    };
    expect(json.readyAt).toBe("2026-04-27T10:00:00.000Z");
    expect(json.readyCount).toBe(2);
    expect(json.totalCount).toBe(5);
  });

  it("propagates orchestrator error status and code on failure", async () => {
    markReadyMock.mockResolvedValue({
      ok: false,
      status: 409,
      error: { code: "ROOM_NOT_INSTANT", message: "Not an instant room." },
    });

    const res = await POST(makeRequest({ userId: "u1" }), { params });
    expect(res.status).toBe(409);
    const json = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(json.error.code).toBe("ROOM_NOT_INSTANT");
  });

  it("returns 400 INVALID_BODY on non-JSON body", async () => {
    const req = new NextRequest("http://localhost/api/rooms/r1/ready", {
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
    markReadyMock.mockResolvedValue({
      ok: true,
      readyAt: "2026-04-27T10:00:00.000Z",
      readyCount: 1,
      totalCount: 2,
    });

    await POST(makeRequest({ userId: "user-xyz" }), {
      params: { id: "room-abc" },
    });
    expect(markReadyMock).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: "room-abc", userId: "user-xyz" }),
      expect.any(Object),
    );
  });
});
