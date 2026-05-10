import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";

const roomRow = {
  id: VALID_ROOM_ID,
  pin: "AAAAAA",
  year: 2026,
  event: "final",
  categories: [{ name: "Vocals", weight: 1 }],
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

const membershipRows = [
  {
    user_id: "user-owner",
    joined_at: "2026-04-19T12:00:00Z",
    is_ready: false,
    users: { display_name: "Owner", avatar_seed: "seed-owner" },
  },
];

let roomResult: { data: unknown; error: { message: string } | null } = {
  data: roomRow,
  error: null,
};

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: vi.fn((table: string) => {
      if (table === "rooms") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue(roomResult),
            })),
          })),
        };
      }
      if (table === "room_memberships") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: membershipRows, error: null }),
          })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  }),
}));

vi.mock("@/lib/contestants", async () => {
  const actual = await vi.importActual<typeof import("@/lib/contestants")>(
    "@/lib/contestants"
  );
  return {
    ...actual,
    fetchContestants: vi.fn().mockResolvedValue([
      {
        id: "2026-ua",
        country: "Ukraine",
        countryCode: "ua",
        flagEmoji: "🇺🇦",
        artist: "TestArtist",
        song: "TestSong",
        runningOrder: 1,
        event: "final",
        year: 2026,
      },
    ]),
    fetchContestantsMeta: vi.fn().mockResolvedValue({ broadcastStartUtc: null }),
  };
});

import { GET } from "@/app/api/rooms/[id]/route";
import { NextRequest } from "next/server";

function makeRequest(): NextRequest {
  return new NextRequest(`http://localhost/api/rooms/${VALID_ROOM_ID}`);
}

describe("GET /api/rooms/[id] (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roomResult = { data: roomRow, error: null };
  });

  it("returns 200 with room + memberships + contestants on a known id", async () => {
    const res = await GET(makeRequest(), { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      room: { id: string; pin: string };
      memberships: Array<{ userId: string; displayName: string }>;
      contestants: Array<{ id: string }>;
    };
    expect(body.room).toMatchObject({ id: VALID_ROOM_ID, pin: "AAAAAA" });
    expect(body.memberships).toHaveLength(1);
    expect(body.memberships[0]).toMatchObject({
      userId: "user-owner",
      displayName: "Owner",
    });
    expect(body.contestants).toHaveLength(1);
  });

  it("returns 400 INVALID_ROOM_ID on a malformed id", async () => {
    const res = await GET(makeRequest(), { params: { id: "not-a-uuid" } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; field?: string } };
    expect(body.error).toMatchObject({ code: "INVALID_ROOM_ID", field: "roomId" });
  });

  it("returns 404 ROOM_NOT_FOUND when the room does not exist", async () => {
    roomResult = { data: null, error: null };
    const res = await GET(makeRequest(), { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ROOM_NOT_FOUND");
  });
});
