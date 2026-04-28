import "server-only";

import http from "node:http";
import https from "node:https";
import {
  DEFAULT_IMAGE_CATALOG,
  DEFAULT_SERVER_PROFILE,
  type ImageCatalogItem,
  type ServerProfile,
} from "@/lib/ec2-catalog";

type ProxmoxVmResource = {
  vmid?: number;
  node?: string;
  name?: string;
  template?: number;
  maxdisk?: number;
};

type ProxmoxVmConfig = Record<string, string | number | boolean | null | undefined>;

const DEFAULT_TEMPLATE_PREFIX = "tmpl-";

const DEFAULT_IMAGE_BY_TEMPLATE = new Map(
  DEFAULT_IMAGE_CATALOG.map((image) => [image.templateName, image]),
);

const DEFAULT_IMAGE_BY_VMID = new Map(
  DEFAULT_IMAGE_CATALOG.map((image) => [image.templateVmid, image]),
);

function getConfiguredProtocol() {
  const protocol = process.env.PROXMOX_PROTOCOL?.trim().toLowerCase();
  return protocol === "http" ? "http" : "https";
}

function getConfiguredPort(protocol: "http" | "https") {
  const configured = process.env.PROXMOX_PORT?.trim();
  if (!configured) return protocol === "https" ? "8006" : "80";
  return configured;
}

function getConfiguredHost() {
  return process.env.PROXMOX_HOST?.trim() ?? null;
}

function getProxmoxBaseUrl() {
  const explicit = process.env.PROXMOX_API_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }

  const host = getConfiguredHost();
  if (!host) return null;

  const protocol = getConfiguredProtocol();
  const port = getConfiguredPort(protocol);
  return `${protocol}://${host}:${port}/api2/json`;
}

function getAuthHeader() {
  const tokenId = process.env.PROXMOX_TOKEN_ID?.trim();
  const tokenSecret = process.env.PROXMOX_TOKEN_SECRET?.trim();
  if (!tokenId || !tokenSecret) return null;
  return `PVEAPIToken=${tokenId}=${tokenSecret}`;
}

function allowInsecureTls() {
  const raw = process.env.PROXMOX_ALLOW_INSECURE_TLS?.trim().toLowerCase();
  if (!raw) return true;
  return raw === "1" || raw === "true" || raw === "yes";
}

function getTemplatePrefix() {
  const configured = process.env.PROXMOX_TEMPLATE_NAME_PREFIX;
  if (configured === undefined) return DEFAULT_TEMPLATE_PREFIX;
  return configured.trim();
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function proxmoxRequest<T>(path: string): Promise<T> {
  const baseUrl = getProxmoxBaseUrl();
  const authorization = getAuthHeader();

  if (!baseUrl) {
    return Promise.reject(
      new Error("PROXMOX_HOST or PROXMOX_API_BASE_URL is not configured"),
    );
  }

  if (!authorization) {
    return Promise.reject(
      new Error("PROXMOX_TOKEN_ID and PROXMOX_TOKEN_SECRET are required"),
    );
  }

  const url = new URL(path, `${baseUrl}/`);

  return new Promise<T>((resolve, reject) => {
    const handleResponse = (res: http.IncomingMessage) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        const statusCode = res.statusCode ?? 500;
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`Proxmox API request failed (${statusCode})`));
          return;
        }

        try {
          const payload = parseJson<{ data: T }>(body);
          resolve(payload.data);
        } catch (error) {
          reject(error);
        }
      });
    };

    const requestOptions = {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: authorization,
      },
    };

    const req = url.protocol === "https:"
      ? https.request(
          url,
          {
            ...requestOptions,
            rejectUnauthorized: !allowInsecureTls(),
          },
          handleResponse,
        )
      : http.request(url, requestOptions, handleResponse);

    req.on("error", reject);
    req.end();
  });
}

function slugFromTemplateName(templateName: string, vmid: number) {
  const prefix = getTemplatePrefix();
  const withoutPrefix = prefix && templateName.startsWith(prefix)
    ? templateName.slice(prefix.length)
    : templateName;

  const slug = withoutPrefix
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : `template-${vmid}`;
}

function titleCasePart(part: string) {
  if (part.length === 0 || /^\d+$/.test(part)) return part;
  return `${part[0].toUpperCase()}${part.slice(1)}`;
}

function inferDisplayName(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map(titleCasePart)
    .join(" ");
}

function inferUsername(slug: string) {
  if (slug.includes("ubuntu")) return "ubuntu";
  if (slug.includes("debian")) return "debian";
  if (slug.includes("rocky")) return "rocky";
  if (slug.includes("alma")) return "almalinux";
  if (slug.includes("centos")) return "cloud-user";
  if (slug.includes("fedora")) return "fedora";
  if (slug.includes("arch")) return "arch";
  return "ubuntu";
}

function inferDownloadUrl(slug: string) {
  if (slug.includes("ubuntu-2404")) {
    return "https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img";
  }
  if (slug.includes("ubuntu-2204")) {
    return "https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img";
  }
  if (slug.includes("debian-12")) {
    return "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2";
  }
  if (slug.includes("rocky-9")) {
    return "https://dl.rockylinux.org/pub/rocky/9/images/x86_64/Rocky-9-GenericCloud.latest.x86_64.qcow2";
  }
  if (slug.includes("almalinux-9")) {
    return "https://repo.almalinux.org/almalinux/9/cloud/x86_64/images/AlmaLinux-9-GenericCloud-latest.x86_64.qcow2";
  }
  return "";
}

function parseDiskSizeGiB(value: string | number | boolean | null | undefined) {
  if (typeof value !== "string") return undefined;

  const sizeMatch = value.match(/size=(\d+(?:\.\d+)?)([KMGTP])/i);
  if (!sizeMatch) return undefined;

  const amount = Number(sizeMatch[1]);
  const unit = sizeMatch[2].toUpperCase();
  if (!Number.isFinite(amount)) return undefined;

  switch (unit) {
    case "P":
      return Math.ceil(amount * 1024 * 1024);
    case "T":
      return Math.ceil(amount * 1024);
    case "G":
      return Math.ceil(amount);
    case "M":
      return Math.max(1, Math.ceil(amount / 1024));
    case "K":
      return 1;
    default:
      return undefined;
  }
}

function bytesToGiB(bytes?: number) {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return undefined;
  return Math.max(1, Math.ceil(bytes / 1024 / 1024 / 1024));
}

function detectCloudInit(config: ProxmoxVmConfig) {
  return Object.entries(config).some(([key, value]) => {
    if (typeof value !== "string") return false;
    return key.startsWith("ide") && value.includes("cloudinit");
  });
}

function buildImageCatalogItem(
  template: Required<Pick<ProxmoxVmResource, "vmid" | "name" | "node">> & ProxmoxVmResource,
  config: ProxmoxVmConfig,
): ImageCatalogItem {
  const defaultImage =
    DEFAULT_IMAGE_BY_VMID.get(template.vmid) ??
    DEFAULT_IMAGE_BY_TEMPLATE.get(template.name);
  const slug = slugFromTemplateName(template.name, template.vmid);
  const minimumDiskGiB =
    parseDiskSizeGiB(config.scsi0) ??
    parseDiskSizeGiB(config.virtio0) ??
    bytesToGiB(template.maxdisk) ??
    defaultImage?.minimumDiskGiB ??
    16;
  const username =
    (typeof config.ciuser === "string" && config.ciuser.trim().length > 0
      ? config.ciuser.trim()
      : undefined) ??
    defaultImage?.username ??
    inferUsername(slug);

  return {
    id: defaultImage?.id ?? `ami-${slug}`,
    displayName: defaultImage?.displayName ?? inferDisplayName(slug),
    templateName: template.name,
    templateVmid: template.vmid,
    username,
    cloudInit: detectCloudInit(config),
    minimumDiskGiB,
    downloadUrl: defaultImage?.downloadUrl ?? inferDownloadUrl(slug),
  };
}

function compareImages(a: ImageCatalogItem, b: ImageCatalogItem) {
  return a.templateVmid - b.templateVmid || a.displayName.localeCompare(b.displayName);
}

export function getServerProfile(images: ImageCatalogItem[]): ServerProfile {
  const preferredImageId = process.env.PROXMOX_DEFAULT_IMAGE_ID?.trim();
  const preferredNode = process.env.PROXMOX_NODE?.trim();
  const activeImageId = images.some((image) => image.id === preferredImageId)
    ? preferredImageId!
    : images[0]?.id ?? DEFAULT_SERVER_PROFILE.imageId;

  return {
    imageId: activeImageId,
    node: preferredNode ?? DEFAULT_SERVER_PROFILE.node,
    storage: process.env.PROXMOX_STORAGE?.trim() ?? DEFAULT_SERVER_PROFILE.storage,
    bridge: process.env.PROXMOX_BRIDGE?.trim() ?? DEFAULT_SERVER_PROFILE.bridge,
    region:
      process.env.PROXMOX_REGION?.trim() ??
      process.env.AWS_DEFAULT_REGION?.trim() ??
      DEFAULT_SERVER_PROFILE.region,
    launchFields: DEFAULT_SERVER_PROFILE.launchFields,
  };
}

export function isProxmoxConfigured() {
  return Boolean(getProxmoxBaseUrl() && getAuthHeader());
}

export async function discoverProxmoxImages(): Promise<ImageCatalogItem[]> {
  const resources = await proxmoxRequest<ProxmoxVmResource[]>("cluster/resources?type=vm");
  const templatePrefix = getTemplatePrefix();
  const preferredNode = process.env.PROXMOX_NODE?.trim();

  const templates = resources.filter(
    (
      resource,
    ): resource is Required<Pick<ProxmoxVmResource, "vmid" | "name" | "node">> & ProxmoxVmResource => {
      if (!resource.vmid || !resource.name || !resource.node) return false;
      if (resource.template !== 1) return false;
      if (preferredNode && resource.node !== preferredNode) return false;
      if (!templatePrefix) return true;
      return resource.name.startsWith(templatePrefix);
    },
  );

  const images = await Promise.all(
    templates.map(async (template) => {
      try {
        const config = await proxmoxRequest<ProxmoxVmConfig>(
          `nodes/${encodeURIComponent(template.node)}/qemu/${template.vmid}/config`,
        );
        return buildImageCatalogItem(template, config);
      } catch (error) {
        console.error(`Failed to inspect Proxmox template ${template.vmid}`, error);
        return null;
      }
    }),
  );

  return images.filter((image): image is ImageCatalogItem => image !== null).sort(compareImages);
}