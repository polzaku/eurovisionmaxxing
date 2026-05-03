import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NON_OWNER_ID = "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb";

let roomSelectResult: { data: unknown; error: { message: string } | null } = {
  data: {
    id: VALID_ROOM_ID,
    status: "lobby",
    owner_user_id: VALID_USER_ID,
    year: 2026,
    event: "final",
  },
  error: null,
};

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue(roomSelectResult),
        })),
      })),
    })),
    channel: vi.fn(() => ({
      send: vi.fn().mockResolvedValue(undefined),
    })),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/lib/contestants", () => ({
  fetchContestants: vi.fn().mockResolvedValue([
    {
      id: "2026-ua",
      year: 2026,
      event: "final",
      countryCode: "ua",
      country: "Ukraine",
      artist: "A",
      song: "S",
      flagEmoji: "🇺🇦",
      runningOrder: 1,
    },
  ]),
}));

import { POST } from "@/app/api/rooms/[id]/refresh-contestants/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/rooms/${VALID_ROOM_ID}/refresh-contestants`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/rooms/[id]/refresh-contestants (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
    roomSelectResult = {
      data: {
        id: VALID_ROOM_ID,
        status: "lobby",
        owner_user_id: VALID_USER_ID,
        year: 2026,
        event: "final",
      },
      error: null,
    };
  });

  it("returns 200 with { contestants } on happy path", async () => {
    const res = await POST(makeRequest({ userId: VALID_USER_ID }), {
      params: { id: VALID_ROOM_ID },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      contestants: Array<{ countryCode: string }>;
    };
    expect(body.contestants).toHaveLength(1);
    expect(body.contestants[0].countryCode).toBe("ua");
  });

  it("returns 400 INVALID_BODY on non-JSON body", async () => {
    const req = new NextRequest(
      `http://localhost/api/rooms/${VALID_ROOM_ID}/refresh-contestants`,
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
  });

  it("returns 403 FORBIDDEN when caller is not the owner", async () => {
    const res = await POST(makeRequest({ userId: NON_OWNER_ID }), {
      params: { id: VALID_ROOM_ID },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 409 ROOM_NOT_IN_LOBBY when room is voting", async () => {
    roomSelectResult = {
      data: {
        id: VALID_ROOM_ID,
        status: "voting",
        owner_user_id: VALID_USER_ID,
        year: 2026,
        event: "final",
      },
      error: null,
    };
    const res = await POST(makeRequest({ userId: VALID_USER_ID }), {
      params: { id: VALID_ROOM_ID },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_IN_LOBBY");
  });

  it("returns 404 ROOM_NOT_FOUND on unknown room", async () => {
    roomSelectResult = { data: null, error: null };
    const res = await POST(makeRequest({ userId: VALID_USER_ID }), {
      params: { id: VALID_ROOM_ID },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_FOUND");
  });
});
