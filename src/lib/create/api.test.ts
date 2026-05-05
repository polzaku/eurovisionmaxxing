import { describe, it, expect, vi } from "vitest";
import {
  fetchContestantsPreview,
  createRoomApi,
} from "@/lib/create/api";

const VALID_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("fetchContestantsPreview", () => {
  it("GETs /api/contestants?year&event and returns { ok, data }", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        contestants: [
          { country: "Norway", flagEmoji: "🇳🇴" },
          { country: "Serbia", flagEmoji: "🇷🇸" },
          { country: "Denmark", flagEmoji: "🇩🇰" },
          { country: "Germany", flagEmoji: "🇩🇪" },
        ],
      })
    ) as unknown as typeof globalThis.fetch;

    const result = await fetchContestantsPreview(2025, "final", {
      fetch: fetchSpy,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        count: 4,
        preview: [
          { flag: "🇳🇴", country: "Norway" },
          { flag: "🇷🇸", country: "Serbia" },
          { flag: "🇩🇰", country: "Denmark" },
        ],
      },
    });
    const [url] = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("/api/contestants?year=2025&event=final");
  });

  it("returns { ok: false, code } on 404", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(404, { error: "Contest data not found" })
    ) as unknown as typeof globalThis.fetch;
    const result = await fetchContestantsPreview(2026, "final", {
      fetch: fetchSpy,
    });
    expect(result).toMatchObject({ ok: false, code: "CONTEST_DATA_NOT_FOUND" });
  });

  it("returns code NETWORK when fetch throws", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;
    const result = await fetchContestantsPreview(2025, "final", {
      fetch: fetchSpy,
    });
    expect(result).toMatchObject({ ok: false, code: "NETWORK" });
  });

  it("returns code ABORTED when the caller aborts the AbortSignal", async () => {
    // SPEC §5.1e — the wizard cancels in-flight fetches when year/event
    // changes. The API must distinguish AbortError from real network failures
    // so the UI can no-op (vs. rendering an error for a stale request).
    const fetchSpy = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof globalThis.fetch;
    const controller = new AbortController();
    controller.abort();
    const result = await fetchContestantsPreview(
      2025,
      "final",
      { fetch: fetchSpy },
      { signal: controller.signal },
    );
    expect(result).toMatchObject({ ok: false, code: "ABORTED" });
  });

  it("forwards the AbortSignal to fetch", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { contestants: [] }),
    ) as unknown as typeof globalThis.fetch;
    const controller = new AbortController();
    await fetchContestantsPreview(
      2025,
      "final",
      { fetch: fetchSpy },
      { signal: controller.signal },
    );
    const [, init] = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(init?.signal).toBe(controller.signal);
  });
});

describe("createRoomApi", () => {
  const validInput = {
    year: 2025,
    event: "final" as const,
    categories: [{ name: "Vocals", weight: 1 }],
    announcementMode: "instant" as const,
    allowNowPerforming: false,
    userId: VALID_USER_ID,
  };

  it("POSTs /api/rooms with body; returns { ok: true, room } on 201", async () => {
    const fakeRoom = {
      id: "room-123",
      pin: "AAAAAA",
      year: 2025,
      event: "final",
      categories: [{ name: "Vocals", weight: 1 }],
      ownerUserId: VALID_USER_ID,
      status: "lobby",
      announcementMode: "instant",
      announcementOrder: null,
      announcingUserId: null,
      currentAnnounceIdx: 0,
      nowPerformingId: null,
      allowNowPerforming: false,
      createdAt: "2026-04-20T00:00:00Z",
    };
    const fetchSpy = vi.fn(async () =>
      jsonResponse(201, { room: fakeRoom })
    ) as unknown as typeof globalThis.fetch;

    const result = await createRoomApi(validInput, { fetch: fetchSpy });
    expect(result).toEqual({ ok: true, room: fakeRoom });
    const [url, init] = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("/api/rooms");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      year: 2025,
      event: "final",
      categories: [{ name: "Vocals", weight: 1 }],
      announcementMode: "instant",
      allowNowPerforming: false,
      userId: VALID_USER_ID,
    });
  });

  it("returns { ok: false, code, field } on 400 INVALID_YEAR", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(400, {
        error: {
          code: "INVALID_YEAR",
          field: "year",
          message: "bad year",
        },
      })
    ) as unknown as typeof globalThis.fetch;
    const result = await createRoomApi(validInput, { fetch: fetchSpy });
    expect(result).toMatchObject({
      ok: false,
      code: "INVALID_YEAR",
      field: "year",
      message: "bad year",
    });
  });

  it("returns { ok: false, code: INTERNAL_ERROR } on 500 unparseable body", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    })) as unknown as typeof globalThis.fetch;
    const result = await createRoomApi(validInput, { fetch: fetchSpy });
    expect(result).toMatchObject({ ok: false, code: "INTERNAL_ERROR" });
  });

  it("returns { ok: false, code: NETWORK } when fetch throws", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;
    const result = await createRoomApi(validInput, { fetch: fetchSpy });
    expect(result).toMatchObject({ ok: false, code: "NETWORK" });
  });
});
