import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listQueues } from "@/lib/aws";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ queues: await listQueues() });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "SQS error" },
      { status: 502 },
    );
  }
}
