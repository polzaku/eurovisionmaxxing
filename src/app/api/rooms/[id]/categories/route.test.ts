import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const NEW_CATEGORIES = [
  { name: "Vocals", weight: 1 },
  { name: "Outfit", weight: 1 },
];

let roomSelectResult: { data: unknown; error: { message: string } | null } = {
  data: {
    id: VALID_ROOM_ID,
    status: "lobby",
    owner_user_id: VALID_USER_ID,
  },
  error: null,
};

const updatedRow = {
  id: VALID_ROOM_ID,
  pin: "AAAAAA",
  year: 2026,
  event: "final",
  categories: NEW_CATEGORIES,
  owner_user_id: VALID_USER_ID,
  status: "lobby",
  announcement_mode: "live",
  announcement_order: null,
  announcing_user_id: null,
  current_announce_idx: 0,
  now_performing_id: null,
  allow_now_performing: false,
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
            single: vi.fn().mockResolvedValue({
              data: updatedRow,
              error: null,
            }),
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

import { PATCH } from "@/app/api/rooms/[id]/categories/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/rooms/${VALID_ROOM_ID}/categories`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("PATCH /api/rooms/[id]/categories (route adapter)", () => {
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
      },
      error: null,
    };
  });

  it("returns 200 with { room } on happy path", async () => {
    const res = await PATCH(
      makeRequest({ categories: NEW_CATEGORIES, userId: VALID_USER_ID }),
      { params: { id: VALID_ROOM_ID } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      room: { id: string; categories: unknown };
    };
    expect(body.room.categories).toEqual(NEW_CATEGORIES);
  });

  it("returns 400 INVALID_BODY on non-JSON body", async () => {
    const req = new NextRequest(
      `http://localhost/api/rooms/${VALID_ROOM_ID}/categories`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "not json{{{",
      },
    );
    const res = await PATCH(req, { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 400 INVALID_CATEGORIES on empty array", async () => {
    const res = await PATCH(
      makeRequest({ categories: [], userId: VALID_USER_ID }),
      { params: { id: VALID_ROOM_ID } },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_CATEGORIES");
  });

  it("returns 403 FORBIDDEN on non-owner caller", async () => {
    const res = await PATCH(
      makeRequest({
        categories: NEW_CATEGORIES,
        userId: "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb",
      }),
      { params: { id: VALID_ROOM_ID } },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 409 ROOM_NOT_IN_LOBBY when status is voting", async () => {
    roomSelectResult = {
      data: {
        id: VALID_ROOM_ID,
        status: "voting",
        owner_user_id: VALID_USER_ID,
      },
      error: null,
    };
    const res = await PATCH(
      makeRequest({ categories: NEW_CATEGORIES, userId: VALID_USER_ID }),
      { params: { id: VALID_ROOM_ID } },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_IN_LOBBY");
  });
});
