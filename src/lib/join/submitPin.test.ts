import { describe, it, expect, vi } from "vitest";
import { submitPinToApi } from "@/lib/join/submitPin";

describe("submitPinToApi — happy path", () => {
  it("POSTs { pin, userId } and returns { ok: true, roomId } on 200", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ roomId: "room-uuid-123" }),
    })) as unknown as typeof globalThis.fetch;

    const result = await submitPinToApi(
      { pin: "ABCDEF", userId: "user-uuid" },
      { fetch: fetchSpy }
    );

    expect(result).toEqual({ ok: true, roomId: "room-uuid-123" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchSpy as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(url).toBe("/api/rooms/join-by-pin");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      pin: "ABCDEF",
      userId: "user-uuid",
    });
  });
});

describe("submitPinToApi — API errors", () => {
  it("returns ok:false with ROOM_NOT_FOUND on a 404 body", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({
        error: {
          code: "ROOM_NOT_FOUND",
          message: "No room matches that PIN.",
        },
      }),
    })) as unknown as typeof globalThis.fetch;

    const result = await submitPinToApi(
      { pin: "ABCDEF", userId: "u" },
      { fetch: fetchSpy }
    );
    expect(result).toEqual({
      ok: false,
      code: "ROOM_NOT_FOUND",
      message: "No room matches that PIN.",
    });
  });

  it("returns ok:false with ROOM_NOT_JOINABLE on a 409 body", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        error: {
          code: "ROOM_NOT_JOINABLE",
          message: "Room is announcing.",
        },
      }),
    })) as unknown as typeof globalThis.fetch;

    const result = await submitPinToApi(
      { pin: "ABCDEF", userId: "u" },
      { fetch: fetchSpy }
    );
    expect(result).toMatchObject({
      ok: false,
      code: "ROOM_NOT_JOINABLE",
    });
  });

  it("surfaces the 'field' property when present", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: "INVALID_PIN",
          message: "bad pin",
          field: "pin",
        },
      }),
    })) as unknown as typeof globalThis.fetch;

    const result = await submitPinToApi(
      { pin: "xxx", userId: "u" },
      { fetch: fetchSpy }
    );
    expect(result).toEqual({
      ok: false,
      code: "INVALID_PIN",
      message: "bad pin",
      field: "pin",
    });
  });

  it("returns a generic INTERNAL_ERROR on a 500 with unparseable body", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    })) as unknown as typeof globalThis.fetch;

    const result = await submitPinToApi(
      { pin: "ABCDEF", userId: "u" },
      { fetch: fetchSpy }
    );
    expect(result).toMatchObject({
      ok: false,
      code: "INTERNAL_ERROR",
    });
  });

  it("returns code 'NETWORK' when fetch throws", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;

    const result = await submitPinToApi(
      { pin: "ABCDEF", userId: "u" },
      { fetch: fetchSpy }
    );
    expect(result).toMatchObject({
      ok: false,
      code: "NETWORK",
    });
  });
});
