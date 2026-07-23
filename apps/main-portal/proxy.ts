import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";

// Route guard for the whole app. Runs on the Edge runtime, so it uses ONLY the
// edge-safe config (JWT verification, no Prisma). Unauthenticated page requests
// are redirected to /login; unauthenticated API requests get a 401.
const { auth } = NextAuth(authConfig);

// Pages reachable without a session.
const PUBLIC_PAGES = ["/login", "/login/2fa", "/setup"];
// API namespaces reachable without a session: Auth.js itself, the first-boot
// setup, and the health probe (used by the Docker healthcheck).
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/setup"];
const PUBLIC_API_EXACT = ["/api/health"];
// API namespaces that ALSO accept a Personal Access Token (Authorization:
// Bearer zw_pat_…). The edge can't validate the token (no DB), so we let a
// well-formed bearer through and the route itself validates it via
// authenticateApiRequest(). Everything else stays session-only.
const PAT_API_PREFIXES = ["/api/export", "/api/backup", "/api/v1"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = Boolean(req.auth?.user);

  const isPublicPage = PUBLIC_PAGES.includes(pathname);
  const isPublicApi =
    PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    PUBLIC_API_EXACT.includes(pathname);

  if (isPublicPage || isPublicApi) {
    return NextResponse.next();
  }

  // PAT-enabled API with a well-formed bearer → defer to the route's own check.
  const bearer = req.headers.get("authorization") ?? "";
  const hasPatBearer = bearer.startsWith("Bearer zw_pat_");
  if (hasPatBearer && PAT_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  if (!isLoggedIn) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.nextUrl);
    if (pathname !== "/") loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

// Run on everything except Next internals and static assets.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
