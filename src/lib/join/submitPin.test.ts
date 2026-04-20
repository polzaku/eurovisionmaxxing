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
