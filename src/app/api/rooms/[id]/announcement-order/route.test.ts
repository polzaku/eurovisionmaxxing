import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const OWNER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const reshuffleMock = vi.fn();

vi.mock("@/lib/rooms/reshuffleOrder", () => ({
  reshuffleOrder: (...args: unknown[]) => reshuffleMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ __marker: "service" }),
}));

vi.mock("@/lib/rooms/shared", () => ({
  defaultBroadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
}));

import { PATCH } from "@/app/api/rooms/[id]/announcement-order/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown, bodyOverride?: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/rooms/${VALID_ROOM_ID}/announcement-order`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: bodyOverride ?? JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  reshuffleMock.mockReset();
});

describe("PATCH /api/rooms/[id]/announcement-order", () => {
  it("returns 200 with the orchestrator payload on success", async () => {
    reshuffleMock.mockResolvedValue({
      ok: true,
      announcementOrder: ["u3", "u2", "u1"],
      announcingUserId: "u3",
    });
    const res = await PATCH(makeRequest({ userId: OWNER_ID }), {
      params: { id: VALID_ROOM_ID },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      announcementOrder: string[];
      announcingUserId: string;
    };
    expect(body.announcementOrder).toEqual(["u3", "u2", "u1"]);
    expect(body.announcingUserId).toBe("u3");
    expect(reshuffleMock).toHaveBeenCalledWith(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID },
      expect.objectContaining({
        supabase: expect.any(Object),
        broadcastRoomEvent: expect.any(Function),
      }),
    );
  });

  it("returns 400 INVALID_BODY on non-JSON body", async () => {
    const res = await PATCH(makeRequest(null, "not json{{{"), {
      params: { id: VALID_ROOM_ID },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
    expect(reshuffleMock).not.toHaveBeenCalled();
  });

  it.each([null, ["arr"], "string", 42])(
    "returns 400 INVALID_BODY on non-object body (%s)",
    async (body) => {
      const res = await PATCH(makeRequest(body), {
        params: { id: VALID_ROOM_ID },
      });
      expect(res.status).toBe(400);
      const resBody = (await res.json()) as { error: { code: string } };
      expect(resBody.error.code).toBe("INVALID_BODY");
      expect(reshuffleMock).not.toHaveBeenCalled();
    },
  );

  it("returns 403 FORBIDDEN when the orchestrator rejects auth", async () => {
    reshuffleMock.mockResolvedValue({
      ok: false,
      status: 403,
      error: { code: "FORBIDDEN", message: "denied" },
    });
    const res = await PATCH(
      makeRequest({ userId: "non-owner" }),
      { params: { id: VALID_ROOM_ID } },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 409 ANNOUNCE_IN_PROGRESS when the gate has closed", async () => {
    reshuffleMock.mockResolvedValue({
      ok: false,
      status: 409,
      error: {
        code: "ANNOUNCE_IN_PROGRESS",
        message: "already revealing",
      },
    });
    const res = await PATCH(
      makeRequest({ userId: OWNER_ID }),
      { params: { id: VALID_ROOM_ID } },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ANNOUNCE_IN_PROGRESS");
  });
});
