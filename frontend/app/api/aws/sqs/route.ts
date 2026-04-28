import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  createQueue,
  deleteQueue,
  deleteQueueMessage,
  listQueues,
  purgeQueue,
  receiveQueueMessages,
  sendQueueMessage,
} from "@/lib/aws";

export const dynamic = "force-dynamic";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const queueUrl = url.searchParams.get("queueUrl")?.trim();

    if (queueUrl) {
      return NextResponse.json({ messages: await receiveQueueMessages(queueUrl) });
    }

    return NextResponse.json({ queues: await listQueues() });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "SQS error" },
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
    const payload = await req.json();

    if (payload?.action === "create-queue") {
      const queueName = typeof payload.queueName === "string"
        ? payload.queueName.trim()
        : "";
      if (!queueName) return badRequest("queueName is required");

      const queueUrl = await createQueue(queueName);
      return NextResponse.json({ ok: true, queueUrl });
    }

    if (payload?.action === "send-message") {
      const queueUrl = typeof payload.queueUrl === "string"
        ? payload.queueUrl.trim()
        : "";
      const body = typeof payload.body === "string" ? payload.body : "";
      if (!queueUrl) return badRequest("queueUrl is required");
      if (!body.trim()) return badRequest("body is required");

      const messageId = await sendQueueMessage(queueUrl, body);
      return NextResponse.json({ ok: true, messageId });
    }

    if (payload?.action === "purge-queue") {
      const queueUrl = typeof payload.queueUrl === "string"
        ? payload.queueUrl.trim()
        : "";
      if (!queueUrl) return badRequest("queueUrl is required");

      await purgeQueue(queueUrl);
      return NextResponse.json({ ok: true });
    }

    return badRequest("unsupported SQS action");
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "SQS mutation failed" },
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

    if (payload?.action === "delete-queue") {
      const queueUrl = typeof payload.queueUrl === "string"
        ? payload.queueUrl.trim()
        : "";
      if (!queueUrl) return badRequest("queueUrl is required");

      await deleteQueue(queueUrl);
      return NextResponse.json({ ok: true });
    }

    if (payload?.action === "delete-message") {
      const queueUrl = typeof payload.queueUrl === "string"
        ? payload.queueUrl.trim()
        : "";
      const receiptHandle = typeof payload.receiptHandle === "string"
        ? payload.receiptHandle
        : "";

      if (!queueUrl) return badRequest("queueUrl is required");
      if (!receiptHandle) return badRequest("receiptHandle is required");

      await deleteQueueMessage(queueUrl, receiptHandle);
      return NextResponse.json({ ok: true });
    }

    return badRequest("unsupported SQS deletion action");
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "SQS deletion failed" },
      { status: 502 },
    );
  }
}
