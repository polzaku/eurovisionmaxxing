import { describe, it, expect, vi } from "vitest";
import { __makeApiFetch } from "@/lib/api/fetch";

function makeResponse(status: number): Response {
  return new Response(null, { status });
}

describe("apiFetch", () => {
  it("refreshes session expiry on a 200 response", async () => {
    const refreshExpiry = vi.fn();
    const response = makeResponse(200);
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const apiFetch = __makeApiFetch({ fetchImpl, refreshExpiry });

    const result = await apiFetch("/x");

    expect(result).toBe(response);
    expect(refreshExpiry).toHaveBeenCalledTimes(1);
  });

  it("refreshes session expiry on a 201 response", async () => {
    const refreshExpiry = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(201));
    const apiFetch = __makeApiFetch({ fetchImpl, refreshExpiry });

    await apiFetch("/x");

    expect(refreshExpiry).toHaveBeenCalledTimes(1);
  });

  it("refreshes session expiry on a 299 response (upper 2xx boundary)", async () => {
    const refreshExpiry = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(299));
    const apiFetch = __makeApiFetch({ fetchImpl, refreshExpiry });

    await apiFetch("/x");

    expect(refreshExpiry).toHaveBeenCalledTimes(1);
  });

  it("does not refresh expiry on a 400 response, and returns the Response", async () => {
    const refreshExpiry = vi.fn();
    const response = makeResponse(400);
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const apiFetch = __makeApiFetch({ fetchImpl, refreshExpiry });

    const result = await apiFetch("/x");

    expect(result).toBe(response);
    expect(refreshExpiry).not.toHaveBeenCalled();
  });

  it("does not refresh expiry on a 401 response", async () => {
    const refreshExpiry = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(401));
    const apiFetch = __makeApiFetch({ fetchImpl, refreshExpiry });

    await apiFetch("/x");

    expect(refreshExpiry).not.toHaveBeenCalled();
  });

  it("does not refresh expiry on a 500 response", async () => {
    const refreshExpiry = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(500));
    const apiFetch = __makeApiFetch({ fetchImpl, refreshExpiry });

    await apiFetch("/x");

    expect(refreshExpiry).not.toHaveBeenCalled();
  });

  it("re-throws network errors without refreshing expiry", async () => {
    const refreshExpiry = vi.fn();
    const networkError = new TypeError("network");
    const fetchImpl = vi.fn().mockRejectedValue(networkError);
    const apiFetch = __makeApiFetch({ fetchImpl, refreshExpiry });

    await expect(apiFetch("/x")).rejects.toBe(networkError);
    expect(refreshExpiry).not.toHaveBeenCalled();
  });

  it("passes input and init through to the underlying fetch unchanged", async () => {
    const refreshExpiry = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(200));
    const apiFetch = __makeApiFetch({ fetchImpl, refreshExpiry });

    const init: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    };
    await apiFetch("/x", init);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("/x", init);
  });

  it("resolves to the exact Response instance the underlying fetch returned", async () => {
    const refreshExpiry = vi.fn();
    const response = makeResponse(200);
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const apiFetch = __makeApiFetch({ fetchImpl, refreshExpiry });

    const result = await apiFetch("/x");

    expect(result).toBe(response);
  });
});
