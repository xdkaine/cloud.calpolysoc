import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { API_BASE } from "@/lib/api";

export const dynamic = "force-dynamic";

async function forward(req: NextRequest, path: string[]) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const upstream = `${API_BASE}/ec2/${path.join("/")}${url.search}`;
  const headers = filterHeaders(req.headers);
  applySessionIdentityHeaders(headers, session.user);
  if (session.accessToken) {
    headers.set("Authorization", `Bearer ${session.accessToken}`);
  }
  const init: RequestInit = {
    method: req.method,
    headers,
    cache: "no-store",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }
  const r = await fetch(upstream, init);
  const body = await r.arrayBuffer();
  return new NextResponse(body, {
    status: r.status,
    headers: passThroughHeaders(r.headers),
  });
}

function filterHeaders(h: Headers) {
  const out = new Headers();
  h.forEach((v, k) => {
    if (
      [
        "host",
        "connection",
        "content-length",
        "authorization",
        "x-console-user-id",
        "x-console-user-email",
        "x-console-user-name",
        "x-console-user-roles",
        "x-console-auth-source",
      ].includes(k.toLowerCase())
    )
      return;
    out.set(k, v);
  });
  return out;
}

function applySessionIdentityHeaders(
  headers: Headers,
  user: {
    id?: string;
    email?: string | null;
    name?: string | null;
    roles?: string[];
  },
) {
  if (user.id) {
    headers.set("X-Console-User-Id", user.id);
  }

  if (user.email) {
    headers.set("X-Console-User-Email", user.email);
  }

  if (user.name) {
    headers.set("X-Console-User-Name", user.name);
  }

  if (user.roles?.length) {
    headers.set("X-Console-User-Roles", user.roles.join(","));
  }

  headers.set("X-Console-Auth-Source", "nextauth-keycloak");
}

function passThroughHeaders(h: Headers) {
  const out = new Headers();
  h.forEach((v, k) => {
    if (
      ["transfer-encoding", "content-encoding", "connection"].includes(
        k.toLowerCase(),
      )
    )
      return;
    out.set(k, v);
  });
  return out;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  return forward(req, path ?? []);
}
export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
