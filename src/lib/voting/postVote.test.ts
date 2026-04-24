import { describe, it, expect, vi } from "vitest";
import { postVote } from "@/lib/voting/postVote";

const ROOM_ID = "11111111-2222-4333-8444-555555555555";
const USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CONTESTANT_ID = "2026-ua";

function makeOkResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeErrorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("postVote", () => {
  it("POSTs to /api/rooms/{roomId}/votes with the right body shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeOkResponse({
        vote: { id: "v1", roomId: ROOM_ID, contestantId: CONTESTANT_ID },
        scoredCount: 1,
      })
    );

    await postVote(
      {
        roomId: ROOM_ID,
        userId: USER_ID,
        contestantId: CONTESTANT_ID,
        scores: { Vocals: 7 },
      },
      { fetch: fetchMock }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/rooms/${ROOM_ID}/votes`);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["content-type"]).toBe(
      "application/json"
    );
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      userId: USER_ID,
      contestantId: CONTESTANT_ID,
      scores: { Vocals: 7 },
    });
  });

  it("returns ok: true with { vote, scoredCount } on 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeOkResponse({
        vote: { id: "v1" },
        scoredCount: 2,
      })
    );

    const result = await postVote(
      {
        roomId: ROOM_ID,
        userId: USER_ID,
        contestantId: CONTESTANT_ID,
        scores: { Vocals: 7, Staging: 9 },
      },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.scoredCount).toBe(2);
    expect(result.data?.vote).toEqual({ id: "v1" });
  });

  it("returns ok: false with code + message on 400", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeErrorResponse(400, {
        error: {
          code: "INVALID_BODY",
          message: "scores must be an object",
          field: "scores",
        },
      })
    );

    const result = await postVote(
      {
        roomId: ROOM_ID,
        userId: USER_ID,
        contestantId: CONTESTANT_ID,
      },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_BODY");
    expect(result.field).toBe("scores");
    expect(result.message).toBe("scores must be an object");
  });

  it("returns ok: false with ROOM_NOT_VOTING on 409", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeErrorResponse(409, {
        error: {
          code: "ROOM_NOT_VOTING",
          message: "Room is not accepting votes",
        },
      })
    );

    const result = await postVote(
      {
        roomId: ROOM_ID,
        userId: USER_ID,
        contestantId: CONTESTANT_ID,
      },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ROOM_NOT_VOTING");
  });

  it("returns ok: false with code 'NETWORK' when fetch throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));

    const result = await postVote(
      {
        roomId: ROOM_ID,
        userId: USER_ID,
        contestantId: CONTESTANT_ID,
      },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NETWORK");
  });

  it("omits scores/missed/hotTake from the body when not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeOkResponse({ vote: {}, scoredCount: 0 })
    );

    await postVote(
      {
        roomId: ROOM_ID,
        userId: USER_ID,
        contestantId: CONTESTANT_ID,
      },
      { fetch: fetchMock }
    );

    const body = JSON.parse(
      fetchMock.mock.calls[0][1]?.body as string
    );
    expect(body).toEqual({
      userId: USER_ID,
      contestantId: CONTESTANT_ID,
    });
    expect("scores" in body).toBe(false);
    expect("missed" in body).toBe(false);
    expect("hotTake" in body).toBe(false);
  });
});
