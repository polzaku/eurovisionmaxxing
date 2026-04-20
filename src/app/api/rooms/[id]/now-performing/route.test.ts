import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const VALID_CONTESTANT_ID = "2026-ua";

let roomSelectResult: { data: unknown; error: { message: string } | null } = {
  data: {
    id: VALID_ROOM_ID,
    status: "voting",
    owner_user_id: VALID_USER_ID,
    allow_now_performing: true,
  },
  error: null,
};

const updatedRow = {
  id: VALID_ROOM_ID,
  pin: "AAAAAA",
  year: 2026,
  event: "final",
  categories: [{ name: "Vocals", weight: 1 }],
  owner_user_id: VALID_USER_ID,
  status: "voting",
  announcement_mode: "instant",
  announcement_order: null,
  announcing_user_id: null,
  current_announce_idx: 0,
  now_performing_id: VALID_CONTESTANT_ID,
  allow_now_performing: true,
  created_at: "2026-04-19T12:00:00Z",
};

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue(roomSelectResult),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: updatedRow, error: null }),
          })),
        })),
      })),
    })),
    channel: vi.fn(() => ({
      send: vi.fn().mockResolvedValue(undefined),
    })),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { PATCH } from "@/app/api/rooms/[id]/now-performing/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/rooms/${VALID_ROOM_ID}/now-performing`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("PATCH /api/rooms/[id]/now-performing (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roomSelectResult = {
      data: {
        id: VALID_ROOM_ID,
        status: "voting",
        owner_user_id: VALID_USER_ID,
        allow_now_performing: true,
      },
      error: null,
    };
  });

  it("returns 200 with { room } on happy path", async () => {
    const res = await PATCH(
      makeRequest({
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      room: { id: string; nowPerformingId: string };
    };
    expect(body.room).toMatchObject({
      id: VALID_ROOM_ID,
      nowPerformingId: VALID_CONTESTANT_ID,
    });
  });

  it("returns 400 INVALID_BODY on non-JSON body", async () => {
    const req = new NextRequest(
      `http://localhost/api/rooms/${VALID_ROOM_ID}/now-performing`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "not json{{{",
      }
    );
    const res = await PATCH(req, { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 403 FORBIDDEN when userId is not the owner", async () => {
    const res = await PATCH(
      makeRequest({
        contestantId: VALID_CONTESTANT_ID,
        userId: "cccccccc-dddd-4eee-8fff-000000000000",
      }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 404 ROOM_NOT_FOUND on unknown room", async () => {
    roomSelectResult = { data: null, error: null };
    const res = await PATCH(
      makeRequest({
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("returns 409 ROOM_NOT_VOTING when room status is lobby", async () => {
    roomSelectResult = {
      data: {
        id: VALID_ROOM_ID,
        status: "lobby",
        owner_user_id: VALID_USER_ID,
        allow_now_performing: true,
      },
      error: null,
    };
    const res = await PATCH(
      makeRequest({
        contestantId: VALID_CONTESTANT_ID,
        userId: VALID_USER_ID,
      }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_VOTING");
  });
});
