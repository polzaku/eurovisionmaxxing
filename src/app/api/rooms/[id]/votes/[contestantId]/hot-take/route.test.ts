import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const OWNER_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TARGET_USER_ID = "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa";
const VALID_CONTESTANT_ID = "2026-ua";

let roomSelectResult: { data: unknown; error: { message: string } | null } = {
  data: { id: VALID_ROOM_ID, owner_user_id: OWNER_USER_ID },
  error: null,
};

let voteUpdateResult: { data: unknown; error: { message: string } | null } = {
  data: { user_id: TARGET_USER_ID },
  error: null,
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
      if (table === "votes") {
        return {
          update: vi.fn(() => {
            // Each .eq returns the chain; terminal .not().select().maybeSingle().
            const chain: {
              eq: ReturnType<typeof vi.fn>;
              not: ReturnType<typeof vi.fn>;
            } = {
              eq: vi.fn(() => chain),
              not: vi.fn(() => ({
                select: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue(voteUpdateResult),
                })),
              })),
            };
            return chain;
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  }),
}));

import { DELETE } from "@/app/api/rooms/[id]/votes/[contestantId]/hot-take/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown, bodyOverride?: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/rooms/${VALID_ROOM_ID}/votes/${VALID_CONTESTANT_ID}/hot-take`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: bodyOverride ?? JSON.stringify(body),
    },
  );
}

describe("DELETE /api/rooms/[id]/votes/[contestantId]/hot-take (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
    roomSelectResult = {
      data: { id: VALID_ROOM_ID, owner_user_id: OWNER_USER_ID },
      error: null,
    };
    voteUpdateResult = {
      data: { user_id: TARGET_USER_ID },
      error: null,
    };
  });

  it("returns 200 { deleted: true } on happy path", async () => {
    const res = await DELETE(
      makeRequest({
        userId: OWNER_USER_ID,
        targetUserId: TARGET_USER_ID,
      }),
      { params: { id: VALID_ROOM_ID, contestantId: VALID_CONTESTANT_ID } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);
  });

  it("returns 200 { deleted: false } when no row matched (idempotent)", async () => {
    voteUpdateResult = { data: null, error: null };
    const res = await DELETE(
      makeRequest({
        userId: OWNER_USER_ID,
        targetUserId: TARGET_USER_ID,
      }),
      { params: { id: VALID_ROOM_ID, contestantId: VALID_CONTESTANT_ID } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(false);
  });

  it("returns 400 INVALID_BODY on non-JSON body", async () => {
    const res = await DELETE(
      makeRequest(null, "not json{{{"),
      { params: { id: VALID_ROOM_ID, contestantId: VALID_CONTESTANT_ID } },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 403 FORBIDDEN when caller is not the room owner", async () => {
    const NON_ADMIN = "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb";
    const res = await DELETE(
      makeRequest({ userId: NON_ADMIN, targetUserId: TARGET_USER_ID }),
      { params: { id: VALID_ROOM_ID, contestantId: VALID_CONTESTANT_ID } },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 404 ROOM_NOT_FOUND on unknown room", async () => {
    roomSelectResult = { data: null, error: null };
    const res = await DELETE(
      makeRequest({
        userId: OWNER_USER_ID,
        targetUserId: TARGET_USER_ID,
      }),
      { params: { id: VALID_ROOM_ID, contestantId: VALID_CONTESTANT_ID } },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_FOUND");
  });
});
