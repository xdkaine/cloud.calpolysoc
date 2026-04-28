import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getEc2Capabilities } from "@/lib/ec2-capabilities";
import { getConsoleAccess } from "@/lib/console-access";
import { isProxmoxConfigured } from "@/lib/proxmox";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const access = getConsoleAccess(session.user.roles);
  if (!access.canManageCatalog) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    capabilities: await getEc2Capabilities(),
    proxmoxConfigured: isProxmoxConfigured(),
  });
}

export async function PUT() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const access = getConsoleAccess(session.user.roles);
  if (!access.canManageCatalog) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json(
    {
      error: "Capabilities are discovered live from Proxmox and are no longer editable through this endpoint",
    },
    { status: 405 },
  );
}