import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks ────────────────────────────────────────────────────────────

const maybeSingleMock = vi.fn();
const updateEqMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }),
      update: () => ({ eq: updateEqMock }),
    }),
  }),
}));

const bcryptCompareMock = vi.fn();
vi.mock("bcryptjs", () => ({
  default: { compare: (p: string, h: string) => bcryptCompareMock(p, h) },
}));

import { POST } from "@/app/api/auth/rejoin/route";
import { NextRequest } from "next/server";

const VALID_USER_ID = "11111111-2222-4333-8444-555555555555";
const USER_ROW = {
  id: VALID_USER_ID,
  display_name: "Lia Bear",
  avatar_seed: "seed-abc",
  rejoin_token_hash: "$2a$10$fakefakefakefakefakefakefakefakefakefakefakefakefakefak",
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/rejoin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/rejoin (route adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maybeSingleMock.mockResolvedValue({ data: USER_ROW, error: null });
    updateEqMock.mockResolvedValue({ error: null });
  });

  it("returns 200 with { userId, displayName, avatarSeed } when bcrypt.compare resolves truthy", async () => {
    bcryptCompareMock.mockResolvedValue(true);
    const res = await POST(
      makeRequest({ userId: VALID_USER_ID, rejoinToken: "plaintext-token" })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      userId: VALID_USER_ID,
      displayName: "Lia Bear",
      avatarSeed: "seed-abc",
    });
  });

  it("returns 401 INVALID_TOKEN when bcrypt.compare resolves falsy", async () => {
    bcryptCompareMock.mockResolvedValue(false);
    const res = await POST(
      makeRequest({ userId: VALID_USER_ID, rejoinToken: "wrong-token" })
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_TOKEN");
  });

  it("returns INVALID_BODY with params.limit when rejoinToken exceeds 512 chars", async () => {
    const longToken = "x".repeat(513);
    const res = await POST(
      makeRequest({
        userId: "11111111-1111-4111-8111-111111111111",
        rejoinToken: longToken,
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; field?: string; params?: { limit?: number } };
    };
    expect(body.error.code).toBe("INVALID_BODY");
    expect(body.error.field).toBe("rejoinToken");
    expect(body.error.params).toEqual({ limit: 512 });
  });
});
