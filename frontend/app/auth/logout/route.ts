import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { signOut } from "@/auth";
import { terminateProviderSession } from "@/lib/provider-session";

export async function POST(request: NextRequest) {
  const expected = new URL(process.env.AUTH_URL ?? request.url).origin;
  if (request.headers.get("origin") !== expected || request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Invalid logout origin" }, { status: 403 });
  }
  if (process.env.AUTH_REQUIRE_APPLICATION_ACCESS === "true") {
    const secret = process.env.AUTH_SECRET;
    if (!secret) return NextResponse.json({ error: "Session termination is unavailable" }, { status: 503 });
    // Decode independently of auth(): an unavailable status endpoint must leave logout retryable.
    let token = null;
    for (const cookieName of ["__Secure-authjs.session-token", "authjs.session-token"]) {
      token = await getToken({ req: request, secret, cookieName, salt: cookieName });
      if (token) break;
    }
    if (token) {
      try { await terminateProviderSession(token); }
      catch {
        return new NextResponse('<!doctype html><html lang="en"><meta charset="utf-8"><title>Sign out incomplete</title><body><h1>Sign out could not be completed</h1><p>Your identity provider did not confirm session termination. Retry to end the session.</p><form method="post" action="/auth/logout"><button>Retry sign out</button></form></body></html>', { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
      }
    }
  }
  await signOut({ redirect: false, redirectTo: "/auth/signin" });
  return NextResponse.redirect(new URL("/auth/signin", expected), 303);
}
