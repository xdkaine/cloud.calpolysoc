import { handlers } from "@/auth";
import { POST as terminateSession } from "@/app/auth/logout/route";
import type { NextRequest } from "next/server";
export const GET = handlers.GET;
export async function POST(request: NextRequest) {
  if (request.nextUrl.pathname.endsWith("/signout")) return terminateSession(request);
  return handlers.POST(request);
}
