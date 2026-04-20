import { describe, it, expect, vi } from "vitest";
import {
  fetchRoomData,
  joinRoomApi,
  patchRoomStatus,
} from "@/lib/room/api";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";
const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("fetchRoomData", () => {
  it("GETs /api/rooms/{id} and returns { ok: true, data } on 200", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        room: { id: VALID_ROOM_ID, status: "lobby" },
        memberships: [],
        contestants: [],
      })
    ) as unknown as typeof globalThis.fetch;

    const result = await fetchRoomData(VALID_ROOM_ID, { fetch: fetchSpy });
    expect(result).toMatchObject({
      ok: true,
      data: {
        room: { id: VALID_ROOM_ID, status: "lobby" },
        memberships: [],
        contestants: [],
      },
    });
    const [url, init] = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`/api/rooms/${VALID_ROOM_ID}`);
    expect(init).toBeUndefined();
  });

  it("returns { ok: false, code } on 404", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(404, {
        error: { code: "ROOM_NOT_FOUND", message: "Room not found." },
      })
    ) as unknown as typeof globalThis.fetch;

    const result = await fetchRoomData(VALID_ROOM_ID, { fetch: fetchSpy });
    expect(result).toMatchObject({
      ok: false,
      code: "ROOM_NOT_FOUND",
    });
  });

  it("returns code NETWORK when fetch throws", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;
    const result = await fetchRoomData(VALID_ROOM_ID, { fetch: fetchSpy });
    expect(result).toMatchObject({ ok: false, code: "NETWORK" });
  });
});

describe("joinRoomApi", () => {
  it("POSTs /api/rooms/{id}/join with { userId }; returns { ok: true } on 200", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { joined: true })
    ) as unknown as typeof globalThis.fetch;

    const result = await joinRoomApi(VALID_ROOM_ID, VALID_USER_ID, {
      fetch: fetchSpy,
    });
    expect(result).toEqual({ ok: true });
    const [url, init] = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`/api/rooms/${VALID_ROOM_ID}/join`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ userId: VALID_USER_ID });
  });

  it("returns { ok: false, code } on 409 ROOM_NOT_JOINABLE", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(409, {
        error: { code: "ROOM_NOT_JOINABLE", message: "Not joinable" },
      })
    ) as unknown as typeof globalThis.fetch;
    const result = await joinRoomApi(VALID_ROOM_ID, VALID_USER_ID, {
      fetch: fetchSpy,
    });
    expect(result).toMatchObject({ ok: false, code: "ROOM_NOT_JOINABLE" });
  });
});

describe("patchRoomStatus", () => {
  it("PATCHes /api/rooms/{id}/status with { status, userId }; returns { ok: true } on 200", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { room: { id: VALID_ROOM_ID, status: "voting" } })
    ) as unknown as typeof globalThis.fetch;

    const result = await patchRoomStatus(
      VALID_ROOM_ID,
      "voting",
      VALID_USER_ID,
      { fetch: fetchSpy }
    );
    expect(result).toEqual({ ok: true });
    const [url, init] = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`/api/rooms/${VALID_ROOM_ID}/status`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      status: "voting",
      userId: VALID_USER_ID,
    });
  });

  it("returns { ok: false, code: FORBIDDEN } on 403", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(403, {
        error: { code: "FORBIDDEN", message: "Not the owner" },
      })
    ) as unknown as typeof globalThis.fetch;
    const result = await patchRoomStatus(VALID_ROOM_ID, "voting", VALID_USER_ID, {
      fetch: fetchSpy,
    });
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("returns { ok: false, code: INTERNAL_ERROR } on 500 with unparseable body", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    })) as unknown as typeof globalThis.fetch;
    const result = await patchRoomStatus(VALID_ROOM_ID, "voting", VALID_USER_ID, {
      fetch: fetchSpy,
    });
    expect(result).toMatchObject({ ok: false, code: "INTERNAL_ERROR" });
  });
});
