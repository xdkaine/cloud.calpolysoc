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
  instance_type?: string;
  cpus?: number;
  maxmem?: number;
  uptime?: number;
  ip?: string;
  node?: string;
};

export type LaunchInput = {
  name: string;
  instance_type: string;
  password: string;
};

export type Job = {
  job_id: string;
  instance_id?: string;
  state: string;
  message?: string;
};

async function request<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 60_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(rest.headers ?? {}),
      },
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

export const ec2 = {
  health: () => request<{ status: string }>("/ec2/health"),
  list: () => request<{ instances: Instance[] } | Instance[]>("/ec2/instances"),
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
