import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: {
      users: {
        id: "11111111-1111-4111-8111-111111111111",
        display_name: "Alice",
        avatar_seed: "sa",
      },
    },
    error: null,
  });
  const eqUser = vi.fn(() => ({ maybeSingle }));
  const eqRoom = vi.fn(() => ({ eq: eqUser }));
  const selectMembership = vi.fn(() => ({ eq: eqRoom }));

  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const updateMock = vi.fn(() => ({ eq: updateEq }));

  const fromMock = vi.fn((_table: string) => ({
    select: selectMembership,
    update: updateMock,
  }));
  return {
    createServiceClient: () => ({ from: fromMock }),
  };
});

import { POST } from "@/app/api/auth/claim/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_USER_ID = "11111111-1111-4111-8111-111111111111";
const VALID_ROOM_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("POST /api/auth/claim (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with the four user fields on valid input", async () => {
    const res = await POST(
      makeRequest({
        userId: VALID_USER_ID,
        roomId: VALID_ROOM_ID,
        displayName: "Alice",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      userId: VALID_USER_ID,
      rejoinToken: expect.any(String),
      displayName: "Alice",
      avatarSeed: "sa",
    });
    expect(body.rejoinToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("returns 400 INVALID_BODY when the body is not JSON", async () => {
    const req = new NextRequest("http://localhost/api/auth/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json{{{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 400 INVALID_BODY when the body is a JSON non-object (null)", async () => {
    const req = new NextRequest("http://localhost/api/auth/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 400 INVALID_USER_ID when userId is malformed", async () => {
    const res = await POST(
      makeRequest({
        userId: "not-a-uuid",
        roomId: VALID_ROOM_ID,
        displayName: "Alice",
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; field?: string } };
    expect(body.error.code).toBe("INVALID_USER_ID");
    expect(body.error.field).toBe("userId");
  });
});
