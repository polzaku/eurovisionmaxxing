import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const OWNER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SKIPPED = "44444444-0000-4000-8000-000000000044";

const restoreMock = vi.fn();

vi.mock("@/lib/rooms/restoreSkipped", () => ({
  restoreSkipped: (...args: unknown[]) => restoreMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ __marker: "service" }),
}));

vi.mock("@/lib/rooms/shared", () => ({
  defaultBroadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "@/app/api/rooms/[id]/announce/restore/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown, bodyOverride?: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/rooms/${VALID_ROOM_ID}/announce/restore`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: bodyOverride ?? JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  restoreMock.mockReset();
});

describe("POST /api/rooms/[id]/announce/restore", () => {
  it("returns 200 with the orchestrator's payload on success", async () => {
    restoreMock.mockResolvedValue({
      ok: true,
      restoredUserId: SKIPPED,
      restoredDisplayName: "Carol",
      announcementOrder: ["u1", "u2", SKIPPED, "u3"],
      announceSkippedUserIds: [],
    });
    const res = await POST(
      makeRequest({ userId: OWNER_ID, restoreUserId: SKIPPED }),
      { params: { id: VALID_ROOM_ID } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      restoredUserId: string;
      announceSkippedUserIds: string[];
    };
    expect(body.restoredUserId).toBe(SKIPPED);
    expect(body.announceSkippedUserIds).toEqual([]);
    expect(restoreMock).toHaveBeenCalledWith(
      { roomId: VALID_ROOM_ID, userId: OWNER_ID, restoreUserId: SKIPPED },
      expect.objectContaining({
        supabase: expect.any(Object),
        broadcastRoomEvent: expect.any(Function),
      }),
    );
  });

  it("returns 400 INVALID_BODY on non-JSON body", async () => {
    const res = await POST(makeRequest(null, "not json{{{"), {
      params: { id: VALID_ROOM_ID },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
    expect(restoreMock).not.toHaveBeenCalled();
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
      expect(restoreMock).not.toHaveBeenCalled();
    },
  );

  it("returns 403 FORBIDDEN when the orchestrator rejects auth", async () => {
    restoreMock.mockResolvedValue({
      ok: false,
      status: 403,
      error: { code: "FORBIDDEN", message: "denied" },
    });
    const res = await POST(
      makeRequest({ userId: "non-owner", restoreUserId: SKIPPED }),
      { params: { id: VALID_ROOM_ID } },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 409 USER_NOT_SKIPPED when the orchestrator rejects the input state", async () => {
    restoreMock.mockResolvedValue({
      ok: false,
      status: 409,
      error: {
        code: "USER_NOT_SKIPPED",
        message: "nothing to restore",
        field: "restoreUserId",
      },
    });
    const res = await POST(
      makeRequest({ userId: OWNER_ID, restoreUserId: SKIPPED }),
      { params: { id: VALID_ROOM_ID } },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; field?: string };
    };
    expect(body.error.code).toBe("USER_NOT_SKIPPED");
    expect(body.error.field).toBe("restoreUserId");
  });
});
