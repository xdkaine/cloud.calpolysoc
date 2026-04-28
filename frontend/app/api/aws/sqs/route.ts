import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { recordAuditEvent } from "@/lib/audit";
import {
  createQueue,
  deleteQueue,
  deleteQueueMessage,
  listQueues,
  purgeQueue,
  receiveQueueMessages,
  sendQueueMessage,
} from "@/lib/aws";
import { getConsoleAccess } from "@/lib/console-access";
import {
  assertTenantResourceName,
  displayTenantResourceName,
  getTenantIdentity,
  isFleetScopeAllowed,
  isTenantResourceName,
  tenantResourceName,
  type TenantIdentity,
} from "@/lib/tenant";

export const dynamic = "force-dynamic";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

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

function queueNameFromUrl(queueUrl: string) {
  try {
    const parsed = new URL(queueUrl);
    return decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() ?? "");
  } catch {
    return decodeURIComponent(queueUrl.split("/").filter(Boolean).pop() ?? queueUrl);
  }
}

function assertTenantQueueUrl(queueUrl: string, identity: TenantIdentity) {
  const queueName = queueNameFromUrl(queueUrl);
  assertTenantResourceName(queueName, identity, "sqs-queue");
  return queueUrl;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const queueUrl = url.searchParams.get("queueUrl")?.trim();
    const identity = getTenantIdentity(session.user);
    const access = getConsoleAccess(session.user.roles);
    const fleetScope = isFleetScopeAllowed(url, access.canAccessAdmin);

    if (queueUrl) {
      const safeQueueUrl = fleetScope
        ? queueUrl
        : assertTenantQueueUrl(queueUrl, identity);
      return NextResponse.json({
        messages: await receiveQueueMessages(safeQueueUrl),
      });
    }

    const queues = (await listQueues())
      .filter((item) =>
        fleetScope ? true : isTenantResourceName(item.name, identity),
      )
      .map((item) => ({
        ...item,
        displayName: displayTenantResourceName(item.name, identity),
        ownedByCurrentUser: isTenantResourceName(item.name, identity),
      }));

    return NextResponse.json({
      queues,
      namespace: { prefix: identity.resourcePrefix },
      scope: fleetScope ? "fleet" : "user",
    });
  } catch (err: any) {
    return errorResponse(err, "SQS error");
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const payload = await req.json();
    const identity = getTenantIdentity(session.user);

    if (payload?.action === "create-queue") {
      const queueName = typeof payload.queueName === "string"
        ? tenantResourceName(payload.queueName, identity, "sqs-queue")
        : "";
      if (!queueName) return badRequest("queueName is required");

      try {
        const queueUrl = await createQueue(queueName);
        await recordAuditEvent({
          actor: identity,
          action: "sqs.create_queue",
          resourceType: "sqs-queue",
          resourceId: queueName,
          result: "success",
          status: 200,
        });
        return NextResponse.json({ ok: true, queueUrl, queueName });
      } catch (err: any) {
        await recordAuditEvent({
          actor: identity,
          action: "sqs.create_queue",
          resourceType: "sqs-queue",
          resourceId: queueName,
          result: "failure",
          status: errorStatus(err),
          message: err?.message,
        });
        throw err;
      }
    }

    if (payload?.action === "send-message") {
      const queueUrl = typeof payload.queueUrl === "string"
        ? assertTenantQueueUrl(payload.queueUrl.trim(), identity)
        : "";
      const body = typeof payload.body === "string" ? payload.body : "";
      if (!queueUrl) return badRequest("queueUrl is required");
      if (!body.trim()) return badRequest("body is required");

      try {
        const messageId = await sendQueueMessage(queueUrl, body);
        await recordAuditEvent({
          actor: identity,
          action: "sqs.send_message",
          resourceType: "sqs-queue",
          resourceId: queueNameFromUrl(queueUrl),
          result: "success",
          status: 200,
        });
        return NextResponse.json({ ok: true, messageId });
      } catch (err: any) {
        await recordAuditEvent({
          actor: identity,
          action: "sqs.send_message",
          resourceType: "sqs-queue",
          resourceId: queueNameFromUrl(queueUrl),
          result: "failure",
          status: errorStatus(err),
          message: err?.message,
        });
        throw err;
      }
    }

    if (payload?.action === "purge-queue") {
      const queueUrl = typeof payload.queueUrl === "string"
        ? assertTenantQueueUrl(payload.queueUrl.trim(), identity)
        : "";
      if (!queueUrl) return badRequest("queueUrl is required");

      try {
        await purgeQueue(queueUrl);
        await recordAuditEvent({
          actor: identity,
          action: "sqs.purge_queue",
          resourceType: "sqs-queue",
          resourceId: queueNameFromUrl(queueUrl),
          result: "success",
          status: 200,
        });
      } catch (err: any) {
        await recordAuditEvent({
          actor: identity,
          action: "sqs.purge_queue",
          resourceType: "sqs-queue",
          resourceId: queueNameFromUrl(queueUrl),
          result: "failure",
          status: errorStatus(err),
          message: err?.message,
        });
        throw err;
      }
      return NextResponse.json({ ok: true });
    }

    return badRequest("unsupported SQS action");
  } catch (err: any) {
    return errorResponse(err, "SQS mutation failed");
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

    if (payload?.action === "delete-queue") {
      const queueUrl = typeof payload.queueUrl === "string"
        ? assertTenantQueueUrl(payload.queueUrl.trim(), identity)
        : "";
      if (!queueUrl) return badRequest("queueUrl is required");

      try {
        await deleteQueue(queueUrl);
        await recordAuditEvent({
          actor: identity,
          action: "sqs.delete_queue",
          resourceType: "sqs-queue",
          resourceId: queueNameFromUrl(queueUrl),
          result: "success",
          status: 200,
        });
      } catch (err: any) {
        await recordAuditEvent({
          actor: identity,
          action: "sqs.delete_queue",
          resourceType: "sqs-queue",
          resourceId: queueNameFromUrl(queueUrl),
          result: "failure",
          status: errorStatus(err),
          message: err?.message,
        });
        throw err;
      }
      return NextResponse.json({ ok: true });
    }

    if (payload?.action === "delete-message") {
      const queueUrl = typeof payload.queueUrl === "string"
        ? assertTenantQueueUrl(payload.queueUrl.trim(), identity)
        : "";
      const receiptHandle = typeof payload.receiptHandle === "string"
        ? payload.receiptHandle
        : "";

      if (!queueUrl) return badRequest("queueUrl is required");
      if (!receiptHandle) return badRequest("receiptHandle is required");

      try {
        await deleteQueueMessage(queueUrl, receiptHandle);
        await recordAuditEvent({
          actor: identity,
          action: "sqs.delete_message",
          resourceType: "sqs-queue",
          resourceId: queueNameFromUrl(queueUrl),
          result: "success",
          status: 200,
        });
      } catch (err: any) {
        await recordAuditEvent({
          actor: identity,
          action: "sqs.delete_message",
          resourceType: "sqs-queue",
          resourceId: queueNameFromUrl(queueUrl),
          result: "failure",
          status: errorStatus(err),
          message: err?.message,
        });
        throw err;
      }
      return NextResponse.json({ ok: true });
    }

    return badRequest("unsupported SQS deletion action");
  } catch (err: any) {
    return errorResponse(err, "SQS deletion failed");
  }
}
