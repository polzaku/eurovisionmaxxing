import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, isSupportedLocale } from "@/i18n/config";
import { pickLocale } from "@/i18n/pickLocale";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function middleware(request: NextRequest): NextResponse {
  const existing = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isSupportedLocale(existing)) {
    return NextResponse.next();
  }

  const detected = pickLocale(request.headers.get("accept-language"));
  const response = NextResponse.next();
  response.cookies.set(LOCALE_COOKIE, detected, {
    path: "/",
    sameSite: "lax",
    maxAge: ONE_YEAR_SECONDS,
  });
  return response;
}

export const config = {
  matcher: [
    // Skip Next.js internals and static asset routes; the cookie only matters for HTML pages.
    "/((?!_next/|api/|.*\\..*).*)",
  ],
};
