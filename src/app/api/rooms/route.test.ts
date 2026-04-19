import { describe, it, expect, vi, beforeEach } from "vitest";

const roomRow = {
  id: "room-uuid-from-mock",
  pin: "AAAAAA",
  year: 2026,
  event: "final",
  categories: [
    { name: "Vocals", weight: 1 },
    { name: "Staging", weight: 2 },
  ],
  owner_user_id: "user-owner",
  status: "lobby",
  announcement_mode: "instant",
  announcement_order: null,
  announcing_user_id: null,
  current_announce_idx: 0,
  now_performing_id: null,
  allow_now_performing: false,
  created_at: "2026-04-19T12:00:00Z",
};

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: vi.fn((table: string) => {
      if (table === "rooms") {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: roomRow, error: null }),
            })),
          })),
          delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
        };
      }
      if (table === "room_memberships") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  }),
}));

import { POST } from "@/app/api/rooms/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  year: 2026,
  event: "final",
  categories: [
    { name: "Vocals", weight: 1 },
    { name: "Staging", weight: 2 },
  ],
  announcementMode: "instant",
  allowNowPerforming: false,
  userId: "user-owner",
};

describe("POST /api/rooms (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 201 with the created room on valid input", async () => {
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { room: { id: string; pin: string; status: string } };
    expect(body.room).toMatchObject({
      id: "room-uuid-from-mock",
      pin: "AAAAAA",
      status: "lobby",
      ownerUserId: "user-owner",
    });
  });

  it("returns 400 INVALID_BODY when the body is not JSON", async () => {
    const req = new NextRequest("http://localhost/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json{{{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 400 INVALID_YEAR with field on bad year", async () => {
    const res = await POST(makeRequest({ ...validBody, year: 1999 }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; field?: string } };
    expect(body.error.code).toBe("INVALID_YEAR");
    expect(body.error.field).toBe("year");
  });
});
