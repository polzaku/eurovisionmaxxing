import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

let roomSelectResult: { data: unknown; error: { message: string } | null } = {
  data: { id: VALID_ROOM_ID, status: "lobby" },
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
      if (table === "room_memberships") {
        return { upsert: vi.fn().mockResolvedValue({ error: null }) };
      }
      if (table === "users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { display_name: "Alice", avatar_seed: "seed-abc" },
                error: null,
              }),
            })),
          })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
    channel: vi.fn(() => ({
      send: vi.fn().mockResolvedValue(undefined),
    })),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { POST } from "@/app/api/rooms/join-by-pin/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/rooms/join-by-pin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/rooms/join-by-pin (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 })
    );
    roomSelectResult = {
      data: { id: VALID_ROOM_ID, status: "lobby" },
      error: null,
    };
  });

  it("returns 200 with { roomId } on a known PIN", async () => {
    const res = await POST(makeRequest({ pin: "ABCDEF", userId: VALID_USER_ID }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roomId: string };
    expect(body).toEqual({ roomId: VALID_ROOM_ID });
  });

  it("returns 400 INVALID_BODY on non-JSON body", async () => {
    const req = new NextRequest("http://localhost/api/rooms/join-by-pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json{{{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 404 ROOM_NOT_FOUND on unknown PIN", async () => {
    roomSelectResult = { data: null, error: null };
    const res = await POST(makeRequest({ pin: "ABCDEF", userId: VALID_USER_ID }));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("returns 409 ROOM_NOT_JOINABLE on announcing", async () => {
    roomSelectResult = {
      data: { id: VALID_ROOM_ID, status: "announcing" },
      error: null,
    };
    const res = await POST(makeRequest({ pin: "ABCDEF", userId: VALID_USER_ID }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_JOINABLE");
  });
});
