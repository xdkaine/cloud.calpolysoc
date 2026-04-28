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
};

export type LaunchInput = {
  name: string;
  instance_type: string;
  password: string;
  image_id?: string;
  template_name?: string;
  template_vmid?: number;
  username?: string;
  minimum_disk_gib?: number;
};

export type Job = {
  job_id: string;
  instance_id?: string;
  vmid?: number;
  state: string;
  message?: string;
  warnings?: string[];
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

  headers.set("X-Console-Auth-Source", "nextauth-keycloak");
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
};
