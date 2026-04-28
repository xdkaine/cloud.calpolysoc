import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { recordAuditEvent } from "@/lib/audit";
import {
  createTable,
  deleteTable,
  deleteTableItem,
  listTableItems,
  listTables,
  putTableItem,
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

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const table = url.searchParams.get("table")?.trim();
    const identity = getTenantIdentity(session.user);
    const access = getConsoleAccess(session.user.roles);
    const fleetScope = isFleetScopeAllowed(url, access.canAccessAdmin);

    if (table) {
      const tableName = fleetScope
        ? table
        : tenantResourceName(table, identity, "dynamodb-table");
      return NextResponse.json({
        table: tableName,
        displayName: displayTenantResourceName(tableName, identity),
        items: await listTableItems(tableName),
      });
    }

    const tables = (await listTables())
      .filter((item) =>
        fleetScope ? true : isTenantResourceName(item.name, identity),
      )
      .map((item) => ({
        ...item,
        displayName: displayTenantResourceName(item.name, identity),
        ownedByCurrentUser: isTenantResourceName(item.name, identity),
      }));

    return NextResponse.json({
      tables,
      namespace: { prefix: identity.resourcePrefix },
      scope: fleetScope ? "fleet" : "user",
    });
  } catch (err: any) {
    return errorResponse(err, "DynamoDB error");
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

    if (payload?.action === "create-table") {
      const tableName = typeof payload.tableName === "string"
        ? tenantResourceName(payload.tableName, identity, "dynamodb-table")
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

      try {
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
        await recordAuditEvent({
          actor: identity,
          action: "dynamodb.create_table",
          resourceType: "dynamodb-table",
          resourceId: tableName,
          result: "success",
          status: 200,
        });
      } catch (err: any) {
        await recordAuditEvent({
          actor: identity,
          action: "dynamodb.create_table",
          resourceType: "dynamodb-table",
          resourceId: tableName,
          result: "failure",
          status: errorStatus(err),
          message: err?.message,
        });
        throw err;
      }

      return NextResponse.json({ ok: true, tableName });
    }

    if (payload?.action === "put-item") {
      const tableName = typeof payload.tableName === "string"
        ? assertTenantResourceName(payload.tableName, identity, "dynamodb-table")
        : "";
      const item = payload.item;

      if (!tableName) return badRequest("tableName is required");
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return badRequest("item must be a JSON object");
      }

      try {
        await putTableItem(tableName, item as Record<string, unknown>);
        await recordAuditEvent({
          actor: identity,
          action: "dynamodb.put_item",
          resourceType: "dynamodb-table",
          resourceId: tableName,
          result: "success",
          status: 200,
        });
      } catch (err: any) {
        await recordAuditEvent({
          actor: identity,
          action: "dynamodb.put_item",
          resourceType: "dynamodb-table",
          resourceId: tableName,
          result: "failure",
          status: errorStatus(err),
          message: err?.message,
        });
        throw err;
      }
      return NextResponse.json({ ok: true });
    }

    return badRequest("unsupported DynamoDB action");
  } catch (err: any) {
    return errorResponse(err, "DynamoDB mutation failed");
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

    if (payload?.action === "delete-table") {
      const tableName = typeof payload.tableName === "string"
        ? assertTenantResourceName(payload.tableName, identity, "dynamodb-table")
        : "";

      if (!tableName) return badRequest("tableName is required");
      try {
        await deleteTable(tableName);
        await recordAuditEvent({
          actor: identity,
          action: "dynamodb.delete_table",
          resourceType: "dynamodb-table",
          resourceId: tableName,
          result: "success",
          status: 200,
        });
      } catch (err: any) {
        await recordAuditEvent({
          actor: identity,
          action: "dynamodb.delete_table",
          resourceType: "dynamodb-table",
          resourceId: tableName,
          result: "failure",
          status: errorStatus(err),
          message: err?.message,
        });
        throw err;
      }
      return NextResponse.json({ ok: true });
    }

    if (payload?.action === "delete-item") {
      const tableName = typeof payload.tableName === "string"
        ? assertTenantResourceName(payload.tableName, identity, "dynamodb-table")
        : "";
      const key = payload.key;

      if (!tableName) return badRequest("tableName is required");
      if (!key || typeof key !== "object" || Array.isArray(key)) {
        return badRequest("key must be a JSON object");
      }

      try {
        await deleteTableItem(tableName, key as Record<string, unknown>);
        await recordAuditEvent({
          actor: identity,
          action: "dynamodb.delete_item",
          resourceType: "dynamodb-table",
          resourceId: tableName,
          result: "success",
          status: 200,
        });
      } catch (err: any) {
        await recordAuditEvent({
          actor: identity,
          action: "dynamodb.delete_item",
          resourceType: "dynamodb-table",
          resourceId: tableName,
          result: "failure",
          status: errorStatus(err),
          message: err?.message,
        });
        throw err;
      }
      return NextResponse.json({ ok: true });
    }

    return badRequest("unsupported DynamoDB deletion action");
  } catch (err: any) {
    return errorResponse(err, "DynamoDB deletion failed");
  }
}
