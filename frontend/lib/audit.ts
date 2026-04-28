import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { TenantIdentity } from "@/lib/tenant";

export type AuditResult = "success" | "failure";

export type AuditEvent = {
  id: string;
  timestamp: string;
  actor: {
    subject: string;
    email?: string | null;
    name?: string | null;
  };
  action: string;
  resourceType: string;
  resourceId?: string;
  result: AuditResult;
  status?: number;
  message?: string;
};

const DEFAULT_AUDIT_LOG_PATH = "/tmp/calpolysoc-cloud-audit.jsonl";

function auditLogPath() {
  return process.env.AUDIT_LOG_PATH || DEFAULT_AUDIT_LOG_PATH;
}

function parentDirectory(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? filePath.slice(0, index) : ".";
}

export async function recordAuditEvent(input: {
  actor: TenantIdentity;
  action: string;
  resourceType: string;
  resourceId?: string;
  result: AuditResult;
  status?: number;
  message?: string;
}) {
  const event: AuditEvent = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actor: {
      subject: input.actor.subject,
      email: input.actor.email,
      name: input.actor.name,
    },
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    result: input.result,
    status: input.status,
    message: input.message,
  };

  try {
    const filePath = auditLogPath();
    await mkdir(parentDirectory(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
  } catch (error) {
    console.error("failed to write audit event", error);
  }
}

export async function readAuditEvents(limit = 100) {
  try {
    const raw = await readFile(auditLogPath(), "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(limit, 500)))
      .map((line) => JSON.parse(line) as AuditEvent)
      .reverse();
  } catch {
    return [] as AuditEvent[];
  }
}
