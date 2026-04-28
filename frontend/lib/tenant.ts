import { createHash } from "node:crypto";
import type { ConsoleIdentityUser } from "@/lib/api";

export type TenantIdentity = {
  subject: string;
  email?: string | null;
  name?: string | null;
  roles: string[];
  resourcePrefix: string;
};

export type ResourceKind = "s3-bucket" | "dynamodb-table" | "sqs-queue";

const TENANT_PREFIX_PATTERN = /^u-[a-f0-9]{12}-/;

function stableSubject(user?: ConsoleIdentityUser | null) {
  return user?.id?.trim() || user?.email?.trim() || user?.name?.trim() || "";
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function getTenantIdentity(user?: ConsoleIdentityUser | null): TenantIdentity {
  const subject = stableSubject(user);
  if (!subject) {
    throw new Error("authenticated user is missing a stable subject");
  }

  return {
    subject,
    email: user?.email,
    name: user?.name,
    roles: user?.roles ?? [],
    resourcePrefix: `u-${shortHash(subject)}-`,
  };
}

export function isTenantResourceName(name: string, identity: TenantIdentity) {
  return name.trim().startsWith(identity.resourcePrefix);
}

export function displayTenantResourceName(
  name: string,
  identity: TenantIdentity,
) {
  return isTenantResourceName(name, identity)
    ? name.slice(identity.resourcePrefix.length)
    : name;
}

function normalizeS3Label(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/-\./g, "-")
    .replace(/\.-/g, "-");
}

function normalizeGenericLabel(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function maxLabelLength(kind: ResourceKind, prefixLength: number) {
  if (kind === "s3-bucket") return 63 - prefixLength;
  if (kind === "sqs-queue") return 80 - prefixLength;
  return 255 - prefixLength;
}

function validateResourceName(kind: ResourceKind, name: string) {
  if (kind === "s3-bucket") {
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name)) {
      throw new Error("bucket name must be a valid S3 bucket name");
    }
    if (name.includes("..") || /^\d+\.\d+\.\d+\.\d+$/.test(name)) {
      throw new Error("bucket name cannot contain adjacent dots or look like an IP address");
    }
    return;
  }

  if (kind === "sqs-queue") {
    if (!/^[A-Za-z0-9_-]{1,80}(\.fifo)?$/.test(name)) {
      throw new Error("queue name must contain only letters, numbers, hyphens, or underscores");
    }
    return;
  }

  if (!/^[A-Za-z0-9_.-]{3,255}$/.test(name)) {
    throw new Error("table name must contain only letters, numbers, underscores, hyphens, or dots");
  }
}

export function tenantResourceName(
  requestedName: string,
  identity: TenantIdentity,
  kind: ResourceKind,
) {
  const raw = requestedName.trim();
  if (!raw) {
    throw new Error("resource name is required");
  }

  if (isTenantResourceName(raw, identity)) {
    validateResourceName(kind, raw);
    return raw;
  }

  if (TENANT_PREFIX_PATTERN.test(raw)) {
    throw new Error("forbidden for this tenant namespace");
  }

  const normalized =
    kind === "s3-bucket" ? normalizeS3Label(raw) : normalizeGenericLabel(raw);
  if (!normalized) {
    throw new Error("resource name does not contain usable characters");
  }

  const max = maxLabelLength(kind, identity.resourcePrefix.length);
  const name = `${identity.resourcePrefix}${normalized.slice(0, max)}`;
  validateResourceName(kind, name);
  return name;
}

export function assertTenantResourceName(
  requestedName: string,
  identity: TenantIdentity,
  kind: ResourceKind,
) {
  const raw = requestedName.trim();
  if (!raw) {
    throw new Error("resource name is required");
  }
  if (!isTenantResourceName(raw, identity)) {
    throw new Error("forbidden for this tenant namespace");
  }
  validateResourceName(kind, raw);
  return raw;
}

export function isFleetScopeAllowed(url: URL, canAccessAdmin: boolean) {
  return canAccessAdmin && url.searchParams.get("scope") === "fleet";
}

export function resourceOwnerLabel(identity: TenantIdentity) {
  return identity.email ?? identity.name ?? identity.subject;
}
