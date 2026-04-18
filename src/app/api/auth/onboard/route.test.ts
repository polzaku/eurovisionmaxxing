import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
    })),
  }),
}));

import { POST } from "@/app/api/auth/onboard/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/onboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/onboard (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 201 with the four user fields on valid input", async () => {
    const res = await POST(
      makeRequest({ displayName: "Lia Bear", avatarSeed: "seed-xyz" })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      userId: expect.any(String),
      rejoinToken: expect.any(String),
      displayName: "Lia Bear",
      avatarSeed: "seed-xyz",
    });
    expect(body.userId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(body.rejoinToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("returns 400 INVALID_BODY when the body is not JSON", async () => {
    const req = new NextRequest("http://localhost/api/auth/onboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json{{{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
  });

  it("returns 400 INVALID_DISPLAY_NAME with field on bad name", async () => {
    const res = await POST(makeRequest({ displayName: "L", avatarSeed: "x" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; field?: string };
    };
    expect(body.error.code).toBe("INVALID_DISPLAY_NAME");
    expect(body.error.field).toBe("displayName");
  });
});
