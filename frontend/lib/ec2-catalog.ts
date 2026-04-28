export type InstanceCatalogItem = {
  value: string;
  family: string;
  vcpus: number;
  memoryMiB: number;
  description: string;
};

export type ImageCatalogItem = {
  id: string;
  displayName: string;
  templateName: string;
  templateVmid: number;
  username: string;
  cloudInit: boolean;
  minimumDiskGiB: number;
  downloadUrl: string;
};

export type ServerProfile = {
  imageId: string;
  node: string;
  storage: string;
  bridge: string;
  region: string;
  launchFields: string[];
};

export type Ec2Capabilities = {
  source: "defaults" | "env" | "proxmox";
  defaultInstanceType: string;
  instanceCatalog: InstanceCatalogItem[];
  images: ImageCatalogItem[];
  serverProfile: ServerProfile;
};

export const DEFAULT_INSTANCE_CATALOG: InstanceCatalogItem[] = [
  {
    value: "t3.nano",
    family: "Burstable",
    vcpus: 1,
    memoryMiB: 512,
    description: "Small utility nodes, jump boxes, and test agents.",
  },
  {
    value: "t3.micro",
    family: "Burstable",
    vcpus: 1,
    memoryMiB: 1024,
    description: "Lightweight app services and low-traffic APIs.",
  },
  {
    value: "t3.small",
    family: "Burstable",
    vcpus: 1,
    memoryMiB: 2048,
    description: "Default general-purpose size for most Linux workloads.",
  },
  {
    value: "t3.medium",
    family: "Burstable",
    vcpus: 2,
    memoryMiB: 4096,
    description: "Heavier services that need more headroom for RAM and CPU.",
  },
];

export const DEFAULT_IMAGE_CATALOG: ImageCatalogItem[] = [
  {
    id: "ami-ubuntu-2404",
    displayName: "Ubuntu 24.04 LTS",
    templateName: "tmpl-ubuntu-2404",
    templateVmid: 9001,
    username: "ubuntu",
    cloudInit: true,
    minimumDiskGiB: 20,
    downloadUrl:
      "https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img",
  },
  {
    id: "ami-ubuntu-2204",
    displayName: "Ubuntu 22.04 LTS",
    templateName: "tmpl-ubuntu-2204",
    templateVmid: 9002,
    username: "ubuntu",
    cloudInit: true,
    minimumDiskGiB: 20,
    downloadUrl:
      "https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img",
  },
  {
    id: "ami-debian-12",
    displayName: "Debian 12 Bookworm",
    templateName: "tmpl-debian-12",
    templateVmid: 9010,
    username: "debian",
    cloudInit: true,
    minimumDiskGiB: 16,
    downloadUrl:
      "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2",
  },
  {
    id: "ami-rocky-9",
    displayName: "Rocky Linux 9",
    templateName: "tmpl-rocky-9",
    templateVmid: 9020,
    username: "rocky",
    cloudInit: true,
    minimumDiskGiB: 16,
    downloadUrl:
      "https://dl.rockylinux.org/pub/rocky/9/images/x86_64/Rocky-9-GenericCloud.latest.x86_64.qcow2",
  },
  {
    id: "ami-almalinux-9",
    displayName: "AlmaLinux 9",
    templateName: "tmpl-almalinux-9",
    templateVmid: 9030,
    username: "almalinux",
    cloudInit: true,
    minimumDiskGiB: 16,
    downloadUrl:
      "https://repo.almalinux.org/almalinux/9/cloud/x86_64/images/AlmaLinux-9-GenericCloud-latest.x86_64.qcow2",
  },
];

export const DEFAULT_INSTANCE_TYPE = "t3.small";

export const DEFAULT_SERVER_PROFILE: ServerProfile = {
  imageId: "ami-ubuntu-2404",
  node: "kitasanblack",
  storage: "local-lvm",
  bridge: "vmbr0",
  region: "us-east-1",
  launchFields: [
    "name",
    "instance_type",
    "password",
    "image_id",
    "template_name",
    "template_vmid",
    "username",
    "minimum_disk_gib",
  ],
};

export const DEFAULT_EC2_CAPABILITIES: Ec2Capabilities = {
  source: "defaults",
  defaultInstanceType: DEFAULT_INSTANCE_TYPE,
  instanceCatalog: DEFAULT_INSTANCE_CATALOG,
  images: DEFAULT_IMAGE_CATALOG,
  serverProfile: DEFAULT_SERVER_PROFILE,
};

export function formatMemoryMiB(memoryMiB: number) {
  if (memoryMiB >= 1024) {
    const gib = memoryMiB / 1024;
    return Number.isInteger(gib) ? `${gib} GiB` : `${gib.toFixed(1)} GiB`;
  }
  return `${memoryMiB} MiB`;
}

export function formatInstanceTypeSummary(item: InstanceCatalogItem) {
  const cpuLabel = item.vcpus === 1 ? "1 vCPU" : `${item.vcpus} vCPU`;
  return `${cpuLabel} / ${formatMemoryMiB(item.memoryMiB)}`;
}

export function formatInstanceTypeLabel(item: InstanceCatalogItem) {
  return `${item.value} — ${formatInstanceTypeSummary(item)}`;
}

export function getInstanceTypeCatalog(
  catalog: InstanceCatalogItem[],
  value?: string | null,
) {
  return catalog.find((item) => item.value === value);
}

export function getImageCatalog(images: ImageCatalogItem[], id?: string | null) {
  return images.find((item) => item.id === id);
}

export function memoryMiBToBytes(memoryMiB: number) {
  return memoryMiB * 1024 * 1024;
}