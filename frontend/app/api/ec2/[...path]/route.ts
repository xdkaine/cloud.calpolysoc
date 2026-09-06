import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { recordAuditEvent } from "@/lib/audit";
import { API_BASE, applyConsoleIdentityHeaders } from "@/lib/api";
import { getTenantIdentity } from "@/lib/tenant";

export const dynamic = "force-dynamic";

async function forward(req: NextRequest, path: string[]) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const internalToken =
    process.env.CLOUD_API_INTERNAL_TOKEN?.trim() ||
    process.env.EC2_API_INTERNAL_TOKEN?.trim();
  if (!internalToken) {
    return NextResponse.json(
      { error: "EC2 internal auth token is not configured" },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const upstream = `${API_BASE}/ec2/${path.join("/")}${url.search}`;
  const headers = filterHeaders(req.headers);
  applyConsoleIdentityHeaders(headers, session.user);
  headers.set("X-Console-Internal-Token", internalToken);
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
  if (req.method !== "GET" && req.method !== "HEAD") {
    const identity = getTenantIdentity(session.user);
    await recordAuditEvent({
      actor: identity,
      action: `ec2.${req.method.toLowerCase()}`,
      resourceType: "ec2",
      resourceId: path.join("/"),
      result: r.ok ? "success" : "failure",
      status: r.status,
      message: r.ok
        ? undefined
        : new TextDecoder().decode(body).slice(0, 500),
    });
  }
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
        "x-console-internal-token",
      ].includes(k.toLowerCase())
    )
      return;
    out.set(k, v);
  });
  return out;
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
