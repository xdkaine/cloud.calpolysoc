import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { recordAuditEvent } from "@/lib/audit";
import {
  createBucket,
  deleteBucket,
  deleteObject,
  getObject,
  listBuckets,
  listObjects,
  putObject,
} from "@/lib/aws";
import { getConsoleAccess } from "@/lib/console-access";
import {
  assertTenantResourceName,
  displayTenantResourceName,
  getTenantIdentity,
  isFleetScopeAllowed,
  isTenantResourceName,
  tenantResourceName,
} from "@/lib/tenant";

export const dynamic = "force-dynamic";

function errorStatus(err: any) {
  const message = String(err?.message ?? "");
  if (message.includes("forbidden")) return 403;
  if (message.includes("required") || message.includes("valid")) return 400;
  return 502;
}

function errorResponse(err: any, fallback: string) {
  return NextResponse.json(
    { error: err?.message ?? fallback },
    { status: errorStatus(err) },
  );
}

function downloadFileName(key: string) {
  return key.split("/").filter(Boolean).pop()?.replace(/"/g, "") || "object";
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const bucket = url.searchParams.get("bucket");
  const key = url.searchParams.get("key");

  try {
    const identity = getTenantIdentity(session.user);
    const access = getConsoleAccess(session.user.roles);
    const fleetScope = isFleetScopeAllowed(url, access.canAccessAdmin);

    if (bucket) {
      const bucketName = fleetScope
        ? bucket.trim()
        : tenantResourceName(bucket, identity, "s3-bucket");

      if (key) {
        try {
          const object = await getObject(bucketName, key);
          await recordAuditEvent({
            actor: identity,
            action: "s3.get_object",
            resourceType: "s3-object",
            resourceId: `${bucketName}/${key}`,
            result: "success",
            status: 200,
          });
          const body = object.body.buffer.slice(
            object.body.byteOffset,
            object.body.byteOffset + object.body.byteLength,
          ) as ArrayBuffer;
          return new NextResponse(body, {
            headers: {
              "Content-Type": object.contentType ?? "application/octet-stream",
              "Content-Disposition": `attachment; filename="${downloadFileName(key)}"`,
              ...(object.contentLength
                ? { "Content-Length": String(object.contentLength) }
                : {}),
            },
          });
        } catch (err: any) {
          await recordAuditEvent({
            actor: identity,
            action: "s3.get_object",
            resourceType: "s3-object",
            resourceId: `${bucketName}/${key}`,
            result: "failure",
            status: errorStatus(err),
            message: err?.message,
          });
          throw err;
        }
      }

      const objects = await listObjects(bucketName);
      return NextResponse.json({
        bucket: bucketName,
        displayName: displayTenantResourceName(bucketName, identity),
        objects,
      });
    }

    const buckets = (await listBuckets())
      .filter((item) =>
        fleetScope ? true : isTenantResourceName(item.name, identity),
      )
      .map((item) => ({
        ...item,
        displayName: displayTenantResourceName(item.name, identity),
        ownedByCurrentUser: isTenantResourceName(item.name, identity),
      }));

    return NextResponse.json({
      buckets,
      namespace: { prefix: identity.resourcePrefix },
      scope: fleetScope ? "fleet" : "user",
    });
  } catch (err: any) {
    return errorResponse(err, "S3 error");
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const contentType = req.headers.get("content-type") ?? "";
    const identity = getTenantIdentity(session.user);

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

      const bucketName = tenantResourceName(bucket, identity, "s3-bucket");
      const body = new Uint8Array(await file.arrayBuffer());
      try {
        await putObject(bucketName, key.trim(), body, file.type || undefined);
        await recordAuditEvent({
          actor: identity,
          action: "s3.put_object",
          resourceType: "s3-object",
          resourceId: `${bucketName}/${key.trim()}`,
          result: "success",
          status: 200,
        });
      } catch (err: any) {
        await recordAuditEvent({
          actor: identity,
          action: "s3.put_object",
          resourceType: "s3-object",
          resourceId: `${bucketName}/${key.trim()}`,
          result: "failure",
          status: errorStatus(err),
          message: err?.message,
        });
        throw err;
      }
      return NextResponse.json({ ok: true });
    }

    const payload = await req.json();
    if (payload?.action === "create-bucket" && typeof payload.bucket === "string") {
      const bucketName = tenantResourceName(payload.bucket, identity, "s3-bucket");
      try {
        await createBucket(bucketName);
        await recordAuditEvent({
          actor: identity,
          action: "s3.create_bucket",
          resourceType: "s3-bucket",
          resourceId: bucketName,
          result: "success",
          status: 200,
        });
      } catch (err: any) {
        await recordAuditEvent({
          actor: identity,
          action: "s3.create_bucket",
          resourceType: "s3-bucket",
          resourceId: bucketName,
          result: "failure",
          status: errorStatus(err),
          message: err?.message,
        });
        throw err;
      }
      return NextResponse.json({ ok: true, bucket: bucketName });
    }

    return NextResponse.json(
      { error: "unsupported S3 action" },
      { status: 400 },
    );
  } catch (err: any) {
    return errorResponse(err, "S3 mutation failed");
  }
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const payload = await req.json();
    const identity = getTenantIdentity(session.user);

    if (payload?.action === "delete-bucket" && typeof payload.bucket === "string") {
      const bucketName = assertTenantResourceName(payload.bucket, identity, "s3-bucket");
      try {
        await deleteBucket(bucketName);
        await recordAuditEvent({
          actor: identity,
          action: "s3.delete_bucket",
          resourceType: "s3-bucket",
          resourceId: bucketName,
          result: "success",
          status: 200,
        });
      } catch (err: any) {
        await recordAuditEvent({
          actor: identity,
          action: "s3.delete_bucket",
          resourceType: "s3-bucket",
          resourceId: bucketName,
          result: "failure",
          status: errorStatus(err),
          message: err?.message,
        });
        throw err;
      }
      return NextResponse.json({ ok: true });
    }

    if (
      payload?.action === "delete-object" &&
      typeof payload.bucket === "string" &&
      typeof payload.key === "string"
    ) {
      const bucketName = assertTenantResourceName(payload.bucket, identity, "s3-bucket");
      try {
        await deleteObject(bucketName, payload.key.trim());
        await recordAuditEvent({
          actor: identity,
          action: "s3.delete_object",
          resourceType: "s3-object",
          resourceId: `${bucketName}/${payload.key.trim()}`,
          result: "success",
          status: 200,
        });
      } catch (err: any) {
        await recordAuditEvent({
          actor: identity,
          action: "s3.delete_object",
          resourceType: "s3-object",
          resourceId: `${bucketName}/${payload.key.trim()}`,
          result: "failure",
          status: errorStatus(err),
          message: err?.message,
        });
        throw err;
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { error: "unsupported S3 action" },
      { status: 400 },
    );
  } catch (err: any) {
    return errorResponse(err, "S3 deletion failed");
  }
}
