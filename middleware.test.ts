import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./src/middleware";
import { LOCALE_COOKIE } from "@/i18n/config";

function makeRequest(opts: {
  acceptLanguage?: string;
  cookie?: string;
}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.acceptLanguage !== undefined) headers["accept-language"] = opts.acceptLanguage;
  if (opts.cookie !== undefined) headers["cookie"] = opts.cookie;
  return new NextRequest("http://localhost/anything", { headers });
}

function getSetCookieLocale(res: Response): string | null {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  const match = setCookie.match(new RegExp(`${LOCALE_COOKIE}=([a-z]+)`));
  return match ? (match[1] ?? null) : null;
}

describe("middleware — locale cookie", () => {
  it("sets cookie to es when Accept-Language prefers es", async () => {
    const req = makeRequest({ acceptLanguage: "es-AR,es;q=0.9,en;q=0.5" });
    const res = await middleware(req);
    expect(getSetCookieLocale(res)).toBe("es");
  });

  it("falls back to en when Accept-Language has no supported match", async () => {
    const req = makeRequest({ acceptLanguage: "zh-CN" });
    const res = await middleware(req);
    expect(getSetCookieLocale(res)).toBe("en");
  });

  it("walks the prioritized list (pt-BR unsupported → en)", async () => {
    const req = makeRequest({ acceptLanguage: "pt-BR,en;q=0.5" });
    const res = await middleware(req);
    expect(getSetCookieLocale(res)).toBe("en");
  });

  it("does nothing when a valid cookie is already present", async () => {
    const req = makeRequest({
      acceptLanguage: "es",
      cookie: `${LOCALE_COOKIE}=fr`,
    });
    const res = await middleware(req);
    expect(getSetCookieLocale(res)).toBeNull();
  });

  it("overwrites an invalid existing cookie with the detected locale", async () => {
    const req = makeRequest({
      acceptLanguage: "uk-UA",
      cookie: `${LOCALE_COOKIE}=xyz`,
    });
    const res = await middleware(req);
    expect(getSetCookieLocale(res)).toBe("uk");
  });
});
