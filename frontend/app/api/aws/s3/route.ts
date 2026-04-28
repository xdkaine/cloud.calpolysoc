import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  createBucket,
  deleteBucket,
  deleteObject,
  listBuckets,
  listObjects,
  putObject,
} from "@/lib/aws";

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

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const bucket = formData.get("bucket");
      const key = formData.get("key");
      const file = formData.get("file");

      if (typeof bucket !== "string" || !bucket.trim()) {
        return NextResponse.json(
          { error: "bucket is required" },
          { status: 400 },
        );
      }
      if (typeof key !== "string" || !key.trim()) {
        return NextResponse.json(
          { error: "key is required" },
          { status: 400 },
        );
      }
      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: "file is required" },
          { status: 400 },
        );
      }

      const body = new Uint8Array(await file.arrayBuffer());
      await putObject(bucket.trim(), key.trim(), body, file.type || undefined);
      return NextResponse.json({ ok: true });
    }

    const payload = await req.json();
    if (payload?.action === "create-bucket" && typeof payload.bucket === "string") {
      await createBucket(payload.bucket.trim());
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { error: "unsupported S3 action" },
      { status: 400 },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "S3 mutation failed" },
      { status: 502 },
    );
  }
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const payload = await req.json();

    if (payload?.action === "delete-bucket" && typeof payload.bucket === "string") {
      await deleteBucket(payload.bucket.trim());
      return NextResponse.json({ ok: true });
    }

    if (
      payload?.action === "delete-object" &&
      typeof payload.bucket === "string" &&
      typeof payload.key === "string"
    ) {
      await deleteObject(payload.bucket.trim(), payload.key.trim());
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { error: "unsupported S3 action" },
      { status: 400 },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "S3 deletion failed" },
      { status: 502 },
    );
  }
}
