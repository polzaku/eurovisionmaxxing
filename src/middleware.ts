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
  // Use response.headers directly so that Set-Cookie is included in the HTTP
  // response to the browser. response.cookies.set() only writes to
  // x-middleware-set-cookie (an internal Next.js header that is forwarded to
  // server components for the current request but is never sent to the client).
  // HttpOnly intentionally omitted: Phase B switcher writes this cookie from client JS.
  // Locale is not a secret, so SameSite=Lax + Secure (in prod) provide sufficient protection.
  response.headers.append(
    "Set-Cookie",
    `${LOCALE_COOKIE}=${detected}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
  return response;
}

export const config = {
  matcher: [
    // Skip Next.js internals and static asset routes; the cookie only matters for HTML pages.
    "/((?!_next/|api/|.*\\..*).*)",
  ],
};
