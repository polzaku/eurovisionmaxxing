import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ROOM_ID = "11111111-2222-4333-8444-555555555555";

const loadResultsMock = vi.fn();
const buildHtmlMock = vi.fn();
const getTranslationsMock = vi.fn();
const cookiesMock = vi.fn();

vi.mock("@/lib/results/loadResults", () => ({
  loadResults: (...args: unknown[]) => loadResultsMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ __marker: "service" }),
}));

vi.mock("@/lib/contestants", () => ({
  fetchContestants: vi.fn(),
  fetchContestantsMeta: vi.fn(),
  ContestDataError: class extends Error {},
}));

vi.mock("@/lib/export/buildResultsHtml", () => ({
  buildResultsHtml: (...args: unknown[]) => buildHtmlMock(...args),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: (...args: unknown[]) => getTranslationsMock(...args),
}));

vi.mock("next/headers", () => ({
  cookies: () => cookiesMock(),
}));

import { GET } from "@/app/api/results/[id]/export.html/route";
import { NextRequest } from "next/server";

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost/api/results/${VALID_ROOM_ID}/export.html`,
  );
}

const DONE_PAYLOAD = {
  status: "done",
  year: 2026,
  event: "final",
  pin: "TESTPN",
  ownerUserId: "u1",
  categories: [],
  leaderboard: [],
  contestants: [],
  breakdowns: [],
  contestantBreakdowns: [],
  hotTakes: [],
  awards: [],
  personalNeighbours: [],
  members: [],
  voteDetails: [],
};

beforeEach(() => {
  loadResultsMock.mockReset();
  buildHtmlMock.mockReset();
  getTranslationsMock.mockReset();
  cookiesMock.mockReset();
  cookiesMock.mockReturnValue({ get: () => undefined });
  getTranslationsMock.mockResolvedValue((key: string) => `en:${key}`);
});

describe("GET /api/results/[id]/export.html", () => {
  it("returns 200 with the rendered HTML on a done room", async () => {
    loadResultsMock.mockResolvedValue({ ok: true, data: DONE_PAYLOAD });
    buildHtmlMock.mockReturnValue({
      html: "<!DOCTYPE html><html></html>",
      filename: "emx-2026-final-TESTPN.html",
      bytes: 32,
    });

    const res = await GET(makeRequest(), { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="emx-2026-final-TESTPN.html"',
    );
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("x-content-bytes")).toBe("32");
    expect(await res.text()).toBe("<!DOCTYPE html><html></html>");
  });

  it("returns 409 RESULTS_NOT_READY when status is not done", async () => {
    loadResultsMock.mockResolvedValue({
      ok: true,
      data: { status: "announcing" },
    });
    const res = await GET(makeRequest(), { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RESULTS_NOT_READY");
  });

  it("returns 400 for invalid UUIDs (passed through from loader)", async () => {
    loadResultsMock.mockResolvedValue({
      ok: false,
      status: 400,
      error: { code: "INVALID_ROOM_ID", message: "Bad room id." },
    });
    const res = await GET(makeRequest(), { params: { id: "not-a-uuid" } });
    expect(res.status).toBe(400);
  });

  it("returns 404 when room missing", async () => {
    loadResultsMock.mockResolvedValue({
      ok: false,
      status: 404,
      error: { code: "ROOM_NOT_FOUND", message: "Room not found." },
    });
    const res = await GET(makeRequest(), { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(404);
  });

  it("returns 500 on loader internal error", async () => {
    loadResultsMock.mockResolvedValue({
      ok: false,
      status: 500,
      error: { code: "INTERNAL_ERROR", message: "DB down." },
    });
    const res = await GET(makeRequest(), { params: { id: VALID_ROOM_ID } });
    expect(res.status).toBe(500);
  });

  it("resolves locale from the NEXT_LOCALE cookie when present", async () => {
    cookiesMock.mockReturnValue({
      get: (name: string) => (name === "NEXT_LOCALE" ? { value: "es" } : undefined),
    });
    loadResultsMock.mockResolvedValue({ ok: true, data: DONE_PAYLOAD });
    buildHtmlMock.mockReturnValue({ html: "<html></html>", filename: "x.html", bytes: 13 });

    await GET(makeRequest(), { params: { id: VALID_ROOM_ID } });
    expect(getTranslationsMock).toHaveBeenCalledWith({
      locale: "es",
      namespace: "export",
    });
  });
});
