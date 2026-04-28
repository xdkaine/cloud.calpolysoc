import { NextResponse } from "next/server";
import { auth } from "@/auth";

export default auth((req) => {
  const { nextUrl } = req;
  const isAuthed = !!req.auth;

  const isAuthRoute =
    nextUrl.pathname.startsWith("/auth") ||
    nextUrl.pathname.startsWith("/api/auth");

  const isPublicRoute = nextUrl.pathname === "/api/health";

  if (isAuthRoute || isPublicRoute) return NextResponse.next();

  if (!isAuthed) {
    const signInUrl = new URL("/auth/signin", nextUrl);
    signInUrl.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }

  // Refresh token failure: force re-auth
  if (req.auth?.error === "RefreshAccessTokenError") {
    const signInUrl = new URL("/auth/signin", nextUrl);
    signInUrl.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  // Run on every route except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
