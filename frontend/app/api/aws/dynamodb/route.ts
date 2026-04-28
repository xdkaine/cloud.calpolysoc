import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  createTable,
  deleteTable,
  deleteTableItem,
  listTableItems,
  listTables,
  putTableItem,
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
    const table = url.searchParams.get("table")?.trim();

    if (table) {
      return NextResponse.json({ items: await listTableItems(table) });
    }

    return NextResponse.json({ tables: await listTables() });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "DynamoDB error" },
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

    if (payload?.action === "create-table") {
      const tableName = typeof payload.tableName === "string"
        ? payload.tableName.trim()
        : "";
      const partitionKeyName = typeof payload.partitionKeyName === "string"
        ? payload.partitionKeyName.trim()
        : "";
      const partitionKeyType = payload.partitionKeyType;
      const sortKeyName = typeof payload.sortKeyName === "string"
        ? payload.sortKeyName.trim()
        : "";
      const sortKeyType = payload.sortKeyType;

      if (!tableName) return badRequest("tableName is required");
      if (!partitionKeyName) return badRequest("partitionKeyName is required");
      if (!["S", "N", "B"].includes(partitionKeyType)) {
        return badRequest("partitionKeyType must be S, N, or B");
      }
      if (sortKeyName && !["S", "N", "B"].includes(sortKeyType)) {
        return badRequest("sortKeyType must be S, N, or B");
      }

      await createTable({
        tableName,
        partitionKey: {
          name: partitionKeyName,
          type: partitionKeyType,
        },
        sortKey: sortKeyName
          ? {
              name: sortKeyName,
              type: sortKeyType,
            }
          : undefined,
      });

      return NextResponse.json({ ok: true });
    }

    if (payload?.action === "put-item") {
      const tableName = typeof payload.tableName === "string"
        ? payload.tableName.trim()
        : "";
      const item = payload.item;

      if (!tableName) return badRequest("tableName is required");
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return badRequest("item must be a JSON object");
      }

      await putTableItem(tableName, item as Record<string, unknown>);
      return NextResponse.json({ ok: true });
    }

    return badRequest("unsupported DynamoDB action");
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "DynamoDB mutation failed" },
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

    if (payload?.action === "delete-table") {
      const tableName = typeof payload.tableName === "string"
        ? payload.tableName.trim()
        : "";

      if (!tableName) return badRequest("tableName is required");
      await deleteTable(tableName);
      return NextResponse.json({ ok: true });
    }

    if (payload?.action === "delete-item") {
      const tableName = typeof payload.tableName === "string"
        ? payload.tableName.trim()
        : "";
      const key = payload.key;

      if (!tableName) return badRequest("tableName is required");
      if (!key || typeof key !== "object" || Array.isArray(key)) {
        return badRequest("key must be a JSON object");
      }

      await deleteTableItem(tableName, key as Record<string, unknown>);
      return NextResponse.json({ ok: true });
    }

    return badRequest("unsupported DynamoDB deletion action");
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "DynamoDB deletion failed" },
      { status: 502 },
    );
  }
}
