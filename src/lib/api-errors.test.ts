import { describe, it, expect } from "vitest";
import { apiError } from "@/lib/api-errors";

async function readBody(res: Response): Promise<unknown> {
  return await res.json();
}

describe("apiError", () => {
  it("returns the bare shape with code + message + status", async () => {
    const res = apiError("INVALID_DISPLAY_NAME", "msg", 400);
    expect(res.status).toBe(400);
    const body = await readBody(res);
    expect(body).toEqual({
      error: { code: "INVALID_DISPLAY_NAME", message: "msg" },
    });
  });

  it("includes `field` when provided", async () => {
    const res = apiError("INVALID_DISPLAY_NAME", "msg", 400, "displayName");
    const body = await readBody(res);
    expect(body).toEqual({
      error: {
        code: "INVALID_DISPLAY_NAME",
        message: "msg",
        field: "displayName",
      },
    });
  });

  it("includes `params` when provided (no field)", async () => {
    const res = apiError("INVALID_AVATAR_SEED", "msg", 400, undefined, {
      limit: 64,
    });
    const body = await readBody(res);
    expect(body).toEqual({
      error: {
        code: "INVALID_AVATAR_SEED",
        message: "msg",
        params: { limit: 64 },
      },
    });
  });

  it("includes both `field` and `params` when both provided", async () => {
    const res = apiError("INVALID_AVATAR_SEED", "msg", 400, "avatarSeed", {
      limit: 64,
    });
    const body = await readBody(res);
    expect(body).toEqual({
      error: {
        code: "INVALID_AVATAR_SEED",
        message: "msg",
        field: "avatarSeed",
        params: { limit: 64 },
      },
    });
  });

  it("honors arbitrary status codes", async () => {
    expect(apiError("INTERNAL_ERROR", "x", 500).status).toBe(500);
    expect(apiError("USER_NOT_FOUND", "x", 404).status).toBe(404);
    expect(apiError("INVALID_TOKEN", "x", 401).status).toBe(401);
  });
});
