import "server-only";

import { unstable_noStore as noStore } from "next/cache";
import {
  DEFAULT_EC2_CAPABILITIES,
  DEFAULT_INSTANCE_CATALOG,
  DEFAULT_INSTANCE_TYPE,
  type Ec2Capabilities,
} from "@/lib/ec2-catalog";
import {
  discoverProxmoxImages,
  getServerProfile,
  isProxmoxConfigured,
} from "@/lib/proxmox";

async function readCapabilitiesFromProxmox(): Promise<Ec2Capabilities> {
  const images = await discoverProxmoxImages();
  if (images.length === 0) {
    throw new Error("No Proxmox templates matched the current discovery settings");
  }

  return {
    source: "proxmox",
    defaultInstanceType: DEFAULT_INSTANCE_TYPE,
    instanceCatalog: DEFAULT_INSTANCE_CATALOG,
    images,
    serverProfile: getServerProfile(images),
  } satisfies Ec2Capabilities;
}

export async function getEc2Capabilities(): Promise<Ec2Capabilities> {
  noStore();

  if (isProxmoxConfigured()) {
    try {
      return await readCapabilitiesFromProxmox();
    } catch (error) {
      console.error("Failed to load live Proxmox capabilities", error);
    }
  }

  return DEFAULT_EC2_CAPABILITIES;
}
