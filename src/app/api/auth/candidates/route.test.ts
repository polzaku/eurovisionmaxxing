import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => {
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }, error: null });
  const eqRoom = vi.fn(() => ({ maybeSingle }));
  const selectRoom = vi.fn(() => ({ eq: eqRoom }));

  const eqMembership = vi.fn().mockResolvedValue({ data: [], error: null });
  const selectMembership = vi.fn(() => ({ eq: eqMembership }));

  const fromMock = vi.fn((table: string) => {
    if (table === "rooms") return { select: selectRoom };
    return { select: selectMembership };
  });
  return {
    createServiceClient: () => ({ from: fromMock }),
  };
});

import { POST } from "@/app/api/auth/candidates/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/candidates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_ROOM_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("POST /api/auth/candidates (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with an empty candidates array on valid input", async () => {
    const res = await POST(
      makeRequest({ displayName: "Alice", roomId: VALID_ROOM_ID }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: unknown[] };
    expect(body).toEqual({ candidates: [] });
  });

  it("returns 400 INVALID_BODY when the body is not JSON", async () => {
    const req = new NextRequest("http://localhost/api/auth/candidates", {
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
    const req = new NextRequest("http://localhost/api/auth/candidates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 400 INVALID_ROOM_ID when roomId is malformed", async () => {
    const res = await POST(
      makeRequest({ displayName: "Alice", roomId: "not-a-uuid" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; field?: string } };
    expect(body.error.code).toBe("INVALID_ROOM_ID");
    expect(body.error.field).toBe("roomId");
  });
});
