import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const VALID_CONTESTANT_ID = "2026-ua";

let roomSelectResult: { data: unknown; error: { message: string } | null } = {
  data: {
    id: VALID_ROOM_ID,
    status: "voting",
    categories: [{ name: "Vocals", weight: 1 }],
  },
  error: null,
};

let membershipSelectResult: { data: unknown; error: { message: string } | null } = {
  data: { room_id: VALID_ROOM_ID, user_id: VALID_USER_ID },
  error: null,
};

const persistedVote = {
  id: "cccccccc-dddd-4eee-8fff-000000000000",
  room_id: VALID_ROOM_ID,
  user_id: VALID_USER_ID,
  contestant_id: VALID_CONTESTANT_ID,
  scores: { Vocals: 7 },
  missed: false,
  hot_take: null,
  hot_take_edited_at: null,
  updated_at: "2026-04-21T12:00:00Z",
};

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: vi.fn((table: string) => {
      if (table === "rooms") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue(roomSelectResult),
            })),
          })),
        };
      }
      if (table === "room_memberships") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue(membershipSelectResult),
              })),
            })),
          })),
        };
      }
      if (table === "votes") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: null, error: null }),
                })),
              })),
            })),
          })),
          upsert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi
                .fn()
                .mockResolvedValue({ data: persistedVote, error: null }),
            })),
          })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  }),
}));

import { POST } from "@/app/api/rooms/[id]/votes/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown, bodyOverride?: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/rooms/${VALID_ROOM_ID}/votes`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: bodyOverride ?? JSON.stringify(body),
    }
  );
}

describe("POST /api/rooms/[id]/votes (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 })
    );
    roomSelectResult = {
      data: {
        id: VALID_ROOM_ID,
        status: "voting",
        categories: [{ name: "Vocals", weight: 1 }],
      },
      error: null,
    };
    membershipSelectResult = {
      data: { room_id: VALID_ROOM_ID, user_id: VALID_USER_ID },
      error: null,
    };
  });

  it("returns 200 with { vote, scoredCount } on happy path", async () => {
    const res = await POST(
      makeRequest({
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
        scores: { Vocals: 7 },
      }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      vote: { contestantId: string; scores: Record<string, number> };
      scoredCount: number;
    };
    expect(body.vote).toMatchObject({
      contestantId: VALID_CONTESTANT_ID,
      scores: { Vocals: 7 },
    });
    expect(body.scoredCount).toBe(1);
  });

  it("returns 400 INVALID_BODY on non-JSON body", async () => {
    const res = await POST(
      makeRequest(null, "not json{{{"),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 404 ROOM_NOT_FOUND on unknown room", async () => {
    roomSelectResult = { data: null, error: null };
    const res = await POST(
      makeRequest({
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("returns 403 FORBIDDEN when caller is not a member", async () => {
    membershipSelectResult = { data: null, error: null };
    const res = await POST(
      makeRequest({
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 409 ROOM_NOT_VOTING when room status is lobby", async () => {
    roomSelectResult = {
      data: {
        id: VALID_ROOM_ID,
        status: "lobby",
        categories: [{ name: "Vocals", weight: 1 }],
      },
      error: null,
    };
    const res = await POST(
      makeRequest({
        userId: VALID_USER_ID,
        contestantId: VALID_CONTESTANT_ID,
      }),
      { params: { id: VALID_ROOM_ID } }
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_VOTING");
  });
});
