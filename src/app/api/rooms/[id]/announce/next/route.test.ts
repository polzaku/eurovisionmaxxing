import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const advanceMock = vi.fn();

vi.mock("@/lib/rooms/advanceAnnouncement", () => ({
  advanceAnnouncement: (...args: unknown[]) => advanceMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ __marker: "service" }),
}));

vi.mock("@/lib/rooms/shared", () => ({
  defaultBroadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "@/app/api/rooms/[id]/announce/next/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/rooms/${VALID_ROOM_ID}/announce/next`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  advanceMock.mockReset();
});

describe("POST /api/rooms/[id]/announce/next", () => {
  it("returns 200 with the loader's payload on success", async () => {
    advanceMock.mockResolvedValue({
      ok: true,
      contestantId: "2026-se",
      points: 12,
      announcingUserId: VALID_USER_ID,
      newTotal: 12,
      newRank: 1,
      nextAnnouncingUserId: null,
      finished: true,
    });
    const res = await POST(makeRequest({ userId: VALID_USER_ID }), {
      params: { id: VALID_ROOM_ID },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contestantId: string; finished: boolean };
    expect(body.contestantId).toBe("2026-se");
    expect(body.finished).toBe(true);
    expect(advanceMock).toHaveBeenCalledWith(
      { roomId: VALID_ROOM_ID, userId: VALID_USER_ID },
      expect.objectContaining({
        supabase: expect.any(Object),
        broadcastRoomEvent: expect.any(Function),
      }),
    );
  });

  it("returns 400 INVALID_BODY on non-JSON body", async () => {
    const req = new NextRequest(
      `http://localhost/api/rooms/${VALID_ROOM_ID}/announce/next`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json{{{",
      },
    );
    const res = await POST(req, { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
    expect(advanceMock).not.toHaveBeenCalled();
  });

  it.each([null, ["arr"], "string", 42])(
    "returns 400 INVALID_BODY on non-object body (%s)",
    async (body) => {
      const res = await POST(makeRequest(body), {
        params: { id: VALID_ROOM_ID },
      });
      expect(res.status).toBe(400);
      const resBody = (await res.json()) as { error: { code: string } };
      expect(resBody.error.code).toBe("INVALID_BODY");
      expect(advanceMock).not.toHaveBeenCalled();
    },
  );

  it("propagates orchestrator failure into apiError", async () => {
    advanceMock.mockResolvedValue({
      ok: false,
      status: 409,
      error: {
        code: "ANNOUNCE_RACED",
        message: "raced",
      },
    });
    const res = await POST(makeRequest({ userId: VALID_USER_ID }), {
      params: { id: VALID_ROOM_ID },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ANNOUNCE_RACED");
  });

  it("propagates a validation failure with `field` populated", async () => {
    advanceMock.mockResolvedValue({
      ok: false,
      status: 400,
      error: {
        code: "INVALID_USER_ID",
        message: "userId must be a non-empty string.",
        field: "userId",
      },
    });
    const res = await POST(makeRequest({}), {
      params: { id: VALID_ROOM_ID },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { field?: string } };
    expect(body.error.field).toBe("userId");
  });
});
