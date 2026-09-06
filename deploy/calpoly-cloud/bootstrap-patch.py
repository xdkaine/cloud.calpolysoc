#!/usr/bin/env python3
"""Dev-bootstrapping patches for the EC2 wrapper container.

Applies environment-driven source adjustments before gunicorn starts so a
single image can target different Proxmox clusters without editing code:

- PROXMOX_VLAN_TAG: cloudctl hardcodes `net0: virtio,bridge=<bridge>`; when
  guests must sit on a tagged VLAN (e.g. vmbr0 with VLAN 20 carrying
  10.128.20.0/24) we append the tag to the interface definition.
- IMAGE_TEMPLATE_VMIDS_JSON: ec2-api.py ships with the production cluster's
  template VMIDs (9001/9002/...); on another cluster those don't exist, so the
  ami->vmid map and catalog entries are rewritten from a JSON mapping.

Both patches are idempotent and fail open: if anything is off we log a
warning and start unpatched rather than refusing to serve.
"""

import json
import os
import re
import sys

CLOUDCTL_PATH = "/usr/local/bin/cloudctl"
EC2_API_PATH = "/opt/calpoly-cloud/ec2-api.py"


def patch_cloudctl_vlan_tag(tag: str) -> None:
    """Append `,tag=<N>` to cloudctl's net0 definition."""
    with open(CLOUDCTL_PATH, encoding="utf-8") as f:
        src = f.read()

    old = 'f"virtio,bridge={self.bridge}"'
    new = f'f"virtio,bridge={{self.bridge}},tag={tag}"'
    if new in src:
        print(f"[bootstrap] cloudctl vlan tag={tag} already applied")
        return
    if old not in src:
        print("[bootstrap] WARNING: cloudctl net0 pattern not found; skipping VLAN patch")
        return

    with open(CLOUDCTL_PATH, "w", encoding="utf-8") as f:
        f.write(src.replace(old, new))
    print(f"[bootstrap] patched cloudctl net0 with tag={tag}")


def patch_template_vmids(mapping_json: str) -> None:
    """Rewrite IMAGE_TEMPLATE_VMIDS + IMAGE_CATALOG template_vmid values."""
    mapping = json.loads(mapping_json)
    if not mapping:
        return

    with open(EC2_API_PATH, encoding="utf-8") as f:
        src = f.read()

    # Replace the dict entries: '"ami-xxx": 9001,' -> '"ami-xxx": <new>,'
    for ami, vmid in mapping.items():
        src = re.sub(
            r'("%s":\s*)\d+' % re.escape(ami),
            lambda m: f"{m.group(1)}{int(vmid)}",
            src,
        )

    # Replace catalog entries: within each block containing "image_id": "<ami>",
    # rewrite its "template_vmid": <old> value.
    for ami, vmid in mapping.items():
        pattern = re.compile(
            r'("image_id":\s*"%s".*?"template_vmid":\s*)\d+' % re.escape(ami),
            re.DOTALL,
        )
        src = pattern.sub(lambda m: f'{m.group(1)}{int(vmid)}', src)

    with open(EC2_API_PATH, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"[bootstrap] patched template vmid map: {mapping}")


def write_proxmox_env_file() -> None:
    """Materialize /etc/calpoly-cloud/proxmox.env from PROXMOX_* env vars.

    Both cloudctl and ec2-api insist this file exists (they re-read it and
    shell out to cloudctl which exits without it), so persist whatever is in
    the environment.
    """
    path = "/etc/calpoly-cloud/proxmox.env"
    lines = [f"{k}={v}" for k, v in sorted(os.environ.items()) if k.startswith("PROXMOX_")]
    if not lines:
        return
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"[bootstrap] wrote {len(lines)} vars to {path}")


def main() -> None:
    try:
        write_proxmox_env_file()
    except Exception as exc:  # noqa: BLE001
        print(f"[bootstrap] WARNING: proxmox.env write failed: {exc}", file=sys.stderr)

    tag = os.environ.get("PROXMOX_VLAN_TAG", "").strip()
    if tag:
        try:
            patch_cloudctl_vlan_tag(tag)
        except Exception as exc:  # noqa: BLE001 — dev bootstrap fails open
            print(f"[bootstrap] WARNING: VLAN patch failed: {exc}", file=sys.stderr)

    mapping_json = os.environ.get("IMAGE_TEMPLATE_VMIDS_JSON", "").strip()
    if mapping_json:
        try:
            patch_template_vmids(mapping_json)
        except Exception as exc:  # noqa: BLE001
            print(f"[bootstrap] WARNING: template map patch failed: {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
