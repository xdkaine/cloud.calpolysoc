/**
 * Server-side API client. Talks to the internal CalPolySOC cloud API
 * (api.cloud.calpolysoc.org) from inside the container, on the VPN/private
 * network. Browser requests go through Next.js route handlers which forward
 * here, so the API hostname never has to be reachable from the user's browser
 * directly.
 */

export const API_BASE =
  process.env.CLOUD_API_BASE_URL?.replace(/\/$/, "") ??
  "http://api.cloud.calpolysoc.org";

export type Instance = {
  vmid: number;
  name: string;
  status: string;
  instance_id?: string;
  instance_type?: string;
  cpus?: number;
  maxmem?: number;
  uptime?: number;
  ip?: string;
  node?: string;
  owner?: {
    principal?: string;
    email?: string;
    id?: string;
    name?: string;
    acl_subject?: string;
    acl_subject_type?: string;
    created_at?: string;
  };
  owner_principal?: string;
  owner_email?: string;
  acl_entries?: Array<{
    path?: string;
    type?: string;
    roleid?: string;
    ugid?: string;
    propagate?: number;
  }>;
  attached_volumes?: Volume[];
  security_group_ids?: string[];
};

export type LaunchInput = {
  name: string;
  instance_type: string;
  password?: string;
  image_id?: string;
  template_name?: string;
  template_vmid?: number;
  username?: string;
  minimum_disk_gib?: number;
  key_name?: string;
};

export type Job = {
  job_id: string;
  instance_id?: string;
  vmid?: number;
  state: string;
  message?: string;
  warnings?: string[];
};

export type Vpc = {
  vpc_id: string;
  cidr_block: string;
  state: string;
  name?: string | null;
  is_default?: boolean;
  created_at?: string;
  owner?: {
    principal?: string | null;
    email?: string | null;
  };
};

export type Subnet = {
  subnet_id: string;
  vpc_id: string;
  cidr_block: string;
  availability_zone?: string;
  state: string;
  name?: string | null;
  created_at?: string;
};

export type SecurityGroupRule = {
  rule_id: string;
  group_id: string;
  direction: "ingress" | "egress";
  ip_protocol: string;
  from_port?: number | null;
  to_port?: number | null;
  cidr_ip?: string | null;
  source_group_id?: string | null;
  description?: string | null;
};

export type SecurityGroup = {
  group_id: string;
  vpc_id: string;
  name: string;
  description?: string | null;
  created_at?: string;
  ingress_rules?: SecurityGroupRule[];
  egress_rules?: SecurityGroupRule[];
};

export type Volume = {
  volume_id: string;
  state: string;
  size_gib: number;
  availability_zone?: string | null;
  attached_vmid?: number | null;
  last_vmid?: number | null;
  device_name?: string | null;
  proxmox_volume?: string | null;
  unused_key?: string | null;
  source_snapshot_id?: string | null;
  name?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type Snapshot = {
  snapshot_id: string;
  volume_id: string;
  state: string;
  progress?: string;
  size_gib: number;
  name?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type DbInstance = {
  db_instance_id: string;
  name: string;
  engine: string;
  engine_version?: string;
  state: string;
  instance_class: string;
  allocated_storage_gib: number;
  vmid?: number | null;
  endpoint_address?: string | null;
  endpoint_port?: number | null;
  endpoint?: { address?: string | null; port?: number | null };
  security_group_ids?: string[];
  created_at?: string;
  updated_at?: string;
};

export type CacheInstance = {
  cache_instance_id: string;
  name: string;
  engine: string;
  engine_version?: string;
  state: string;
  instance_class: string;
  allocated_storage_gib: number;
  vmid?: number | null;
  endpoint_address?: string | null;
  endpoint_port?: number | null;
  endpoint?: { address?: string | null; port?: number | null };
  security_group_ids?: string[];
  created_at?: string;
  updated_at?: string;
};

export type QuotaSummary = {
  limits: Record<string, number | null>;
  usage: Record<string, number | string | null>;
  principal?: string;
};

export type CapacitySummary = {
  node?: string;
  status?: Record<string, any>;
  storage?: Array<Record<string, any>>;
};

export type AccessKey = {
  access_key_id: string;
  secret_access_key?: string;
  status: string;
  name?: string | null;
  created_at?: string;
  last_used_at?: string | null;
};

export type KeyPair = {
  key_pair_id: string;
  key_name: string;
  fingerprint: string;
  public_key: string;
  private_key?: string;
  created_at?: string;
};

export type ConsoleIdentityUser = {
  id?: string;
  email?: string | null;
  name?: string | null;
  roles?: string[];
};

async function request<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 60_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(rest.headers);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (path.startsWith("/ec2/")) {
      const internalToken =
        process.env.CLOUD_API_INTERNAL_TOKEN?.trim() ||
        process.env.EC2_API_INTERNAL_TOKEN?.trim();
      if (!internalToken) {
        throw new ApiError("EC2 internal auth token is not configured", 503, null);
      }
      headers.set("X-Console-Internal-Token", internalToken);
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      signal: controller.signal,
      cache: "no-store",
      headers,
    });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg =
        (data && (data as any).error) ||
        (data && (data as any).message) ||
        `Upstream error ${res.status}`;
      throw new ApiError(msg, res.status, data);
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function applyConsoleIdentityHeaders(
  headers: Headers,
  user?: ConsoleIdentityUser | null,
) {
  if (!user) return;

  if (user.id) {
    headers.set("X-Console-User-Id", user.id);
  }

  if (user.email) {
    headers.set("X-Console-User-Email", user.email);
  }

  if (user.name) {
    headers.set("X-Console-User-Name", user.name);
  }

  if (user.roles?.length) {
    headers.set("X-Console-User-Roles", user.roles.join(","));
  }

  headers.set("X-Console-Auth-Source", "nextauth-oidc");
}

export function consoleIdentityHeaders(user?: ConsoleIdentityUser | null) {
  const headers = new Headers();
  applyConsoleIdentityHeaders(headers, user);
  return headers;
}

export const ec2 = {
  health: () => request<{ status: string }>("/ec2/health"),
  list: (user?: ConsoleIdentityUser | null) =>
    request<{ instances: Instance[] } | Instance[]>("/ec2/instances", {
      headers: consoleIdentityHeaders(user),
    }),
  get: (vmid: number) => request<Instance>(`/ec2/instances?vmid=${vmid}`),
  launch: (body: LaunchInput) =>
    request<Job | Instance>("/ec2/instances", {
      method: "POST",
      body: JSON.stringify(body),
      timeoutMs: 120_000,
    }),
  start: (vmid: number) =>
    request<{ ok: boolean }>(`/ec2/instances/${vmid}/start`, {
      method: "POST",
    }),
  stop: (vmid: number) =>
    request<{ ok: boolean }>(`/ec2/instances/${vmid}/stop`, {
      method: "POST",
    }),
  terminate: (vmid: number) =>
    request<{ ok: boolean }>(`/ec2/instances/${vmid}`, { method: "DELETE" }),
  listVpcs: (user?: ConsoleIdentityUser | null) =>
    request<{ vpcs: Vpc[] }>("/ec2/vpcs", {
      headers: consoleIdentityHeaders(user),
    }),
  listSubnets: (user?: ConsoleIdentityUser | null) =>
    request<{ subnets: Subnet[] }>("/ec2/subnets", {
      headers: consoleIdentityHeaders(user),
    }),
  listSecurityGroups: (user?: ConsoleIdentityUser | null) =>
    request<{ security_groups: SecurityGroup[] }>("/ec2/security-groups", {
      headers: consoleIdentityHeaders(user),
    }),
  listAccessKeys: (user?: ConsoleIdentityUser | null) =>
    request<{ access_keys: AccessKey[] }>("/ec2/access-keys", {
      headers: consoleIdentityHeaders(user),
    }),
  listKeyPairs: (user?: ConsoleIdentityUser | null) =>
    request<{ key_pairs: KeyPair[] }>("/ec2/key-pairs", {
      headers: consoleIdentityHeaders(user),
    }),
  listVolumes: (user?: ConsoleIdentityUser | null) =>
    request<{ volumes: Volume[] }>("/ec2/volumes", {
      headers: consoleIdentityHeaders(user),
    }),
  listSnapshots: (user?: ConsoleIdentityUser | null) =>
    request<{ snapshots: Snapshot[] }>("/ec2/snapshots", {
      headers: consoleIdentityHeaders(user),
    }),
  listDbInstances: (user?: ConsoleIdentityUser | null) =>
    request<{ db_instances: DbInstance[] }>("/ec2/db-instances", {
      headers: consoleIdentityHeaders(user),
    }),
  listCacheInstances: (user?: ConsoleIdentityUser | null) =>
    request<{ cache_instances: CacheInstance[] }>("/ec2/cache-instances", {
      headers: consoleIdentityHeaders(user),
    }),
  quotas: (user?: ConsoleIdentityUser | null) =>
    request<QuotaSummary>("/ec2/quotas", {
      headers: consoleIdentityHeaders(user),
    }),
  capacity: () => request<{ capacity: CapacitySummary }>("/ec2/capacity"),
};
