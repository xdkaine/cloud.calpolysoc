import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listTables } from "@/lib/aws";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ tables: await listTables() });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "DynamoDB error" },
      { status: 502 },
    );
  }
}
