import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listBuckets, listObjects } from "@/lib/aws";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const bucket = url.searchParams.get("bucket");
  try {
    if (bucket) {
      return NextResponse.json({ objects: await listObjects(bucket) });
    }
    return NextResponse.json({ buckets: await listBuckets() });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "S3 error" },
      { status: 502 },
    );
  }
}
