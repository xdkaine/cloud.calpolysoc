import type { ImageCatalogItem, ServerProfile } from "@/lib/ec2-catalog";

function imageFileName(image: ImageCatalogItem) {
  const fileName = image.downloadUrl.split("/").pop()?.split("?")[0];
  return fileName && fileName.length > 0 ? fileName : `${image.id}.img`;
}

export function buildProxmoxBootstrapPrelude(serverProfile: ServerProfile) {
  return [
    "# Run these commands on the Proxmox node that will host the templates.",
    `# Target node: ${serverProfile.node}`,
    "apt-get update && apt-get install -y wget",
    "mkdir -p /var/lib/vz/template/iso/cloud-images",
    "cd /var/lib/vz/template/iso/cloud-images",
    "pvesm status",
  ].join("\n");
}

export function buildProxmoxTemplateCommands(
  image: ImageCatalogItem,
  serverProfile: ServerProfile,
) {
  const fileName = imageFileName(image);
  return [
    `# ${image.displayName} -> ${image.id}`,
    "cd /var/lib/vz/template/iso/cloud-images",
    `wget -O ${fileName} ${image.downloadUrl}`,
    `qm destroy ${image.templateVmid} --purge 1 --destroy-unreferenced-disks 1 2>/dev/null || true`,
    `qm create ${image.templateVmid} --name ${image.templateName} --memory 2048 --cores 2 --cpu host --net0 virtio,bridge=${serverProfile.bridge}`,
    `qm importdisk ${image.templateVmid} ${fileName} ${serverProfile.storage}`,
    `qm set ${image.templateVmid} --scsihw virtio-scsi-pci --scsi0 ${serverProfile.storage}:vm-${image.templateVmid}-disk-0`,
    `qm set ${image.templateVmid} --ide2 ${serverProfile.storage}:cloudinit`,
    `qm set ${image.templateVmid} --boot order=scsi0 --bootdisk scsi0`,
    `qm set ${image.templateVmid} --serial0 socket --vga serial0 --agent enabled=1 --ostype l26`,
    `qm resize ${image.templateVmid} scsi0 ${image.minimumDiskGiB}G`,
    `qm set ${image.templateVmid} --ciuser ${image.username} --ipconfig0 ip=dhcp`,
    `qm template ${image.templateVmid}`,
    `qm config ${image.templateVmid}`,
  ].join("\n");
}