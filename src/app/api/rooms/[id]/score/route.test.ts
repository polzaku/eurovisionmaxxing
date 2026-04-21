import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const runScoringMock = vi.fn();

vi.mock("@/lib/rooms/runScoring", () => ({
  runScoring: (...args: unknown[]) => runScoringMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ __marker: "service" }),
}));

vi.mock("@/lib/contestants", () => ({
  fetchContestants: vi.fn(async () => []),
  ContestDataError: class extends Error {},
}));

vi.mock("@/lib/rooms/shared", () => ({
  defaultBroadcastRoomEvent: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "@/app/api/rooms/[id]/score/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/rooms/${VALID_ROOM_ID}/score`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  runScoringMock.mockReset();
});

describe("POST /api/rooms/[id]/score (route adapter)", () => {
  it("returns 200 { leaderboard } on success", async () => {
    runScoringMock.mockResolvedValue({
      ok: true,
      leaderboard: [
        { contestantId: "2026-al", totalPoints: 24 },
        { contestantId: "2026-be", totalPoints: 20 },
      ],
    });
    const res = await POST(makeRequest({ userId: VALID_USER_ID }), {
      params: { id: VALID_ROOM_ID },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      leaderboard: { contestantId: string; totalPoints: number }[];
    };
    expect(body.leaderboard).toEqual([
      { contestantId: "2026-al", totalPoints: 24 },
      { contestantId: "2026-be", totalPoints: 20 },
    ]);

    // Forwards roomId from URL and userId from body.
    expect(runScoringMock).toHaveBeenCalledTimes(1);
    const [passedInput] = runScoringMock.mock.calls[0];
    expect(passedInput).toEqual({ roomId: VALID_ROOM_ID, userId: VALID_USER_ID });
  });

  it("returns 400 INVALID_BODY when the body is not valid JSON", async () => {
    const req = new NextRequest(
      `http://localhost/api/rooms/${VALID_ROOM_ID}/score`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json{{{",
      },
    );
    const res = await POST(req, { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_BODY");
    expect(runScoringMock).not.toHaveBeenCalled();
  });

  it.each([
    ["array body", ["foo"]],
    ["null body", null],
    ["string body", "userId"],
    ["number body", 42],
  ])("returns 400 INVALID_BODY on %s", async (_label, body) => {
    const res = await POST(makeRequest(body), { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(400);
    const resBody = (await res.json()) as { error: { code: string } };
    expect(resBody.error.code).toBe("INVALID_BODY");
    expect(runScoringMock).not.toHaveBeenCalled();
  });

  it("propagates runScoring failure into apiError (code, status, field)", async () => {
    runScoringMock.mockResolvedValue({
      ok: false,
      status: 403,
      error: {
        code: "FORBIDDEN",
        message: "Only the room owner can trigger scoring.",
      },
    });
    const res = await POST(makeRequest({ userId: VALID_USER_ID }), {
      params: { id: VALID_ROOM_ID },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error).toMatchObject({
      code: "FORBIDDEN",
      message: "Only the room owner can trigger scoring.",
    });
  });

  it("propagates a validation failure with `field` populated", async () => {
    runScoringMock.mockResolvedValue({
      ok: false,
      status: 400,
      error: {
        code: "INVALID_USER_ID",
        message: "userId must be a non-empty string.",
        field: "userId",
      },
    });
    const res = await POST(makeRequest({}), { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; field?: string };
    };
    expect(body.error.code).toBe("INVALID_USER_ID");
    expect(body.error.field).toBe("userId");
  });
});
