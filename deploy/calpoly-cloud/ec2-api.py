root@aws:/opt/calpoly-cloud# cat ec2-api.py
#!/usr/bin/env python3

import json
import os
import re
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

from flask import Flask, jsonify, request

app = Flask(__name__)

CLOUDCTL = "/usr/local/bin/cloudctl"
PROXMOX_ENV_PATH = "/etc/calpoly-cloud/proxmox.env"
VMID_PATTERNS = (
    re.compile(r"(?im)^\s*VMID:\s*(\d+)\s*$"),
    re.compile(r"(?im)^\s*ProxmoxVMID:\s*(\d+)\s*$"),
    re.compile(r'(?i)["\']?vmid["\']?\s*[:=]\s*["\']?(\d+)'),
    re.compile(r"(?i)\\bvmid\\b[^\\d]{0,20}(\\d+)"),
    re.compile(r"/qemu/(\\d+)\\b"),
)


def run_cmd(args):
    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
    )

    return {
        "ok": result.returncode == 0,
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


def load_proxmox_config():
    config = {}

    if os.path.exists(PROXMOX_ENV_PATH):
        with open(PROXMOX_ENV_PATH, "r", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue

                if line.startswith("export "):
                    line = line[len("export ") :]

                key, value = line.split("=", 1)
                config[key.strip()] = value.strip().strip('"').strip("'")

    for key, value in os.environ.items():
        if key.startswith("PROXMOX_"):
            config[key] = value

    return config


def proxmox_base_url(config):
    if config.get("PROXMOX_API_BASE_URL"):
        return config["PROXMOX_API_BASE_URL"].rstrip("/")

    protocol = config.get("PROXMOX_PROTOCOL", "https")
    host = config.get("PROXMOX_HOST")
    port = config.get("PROXMOX_PORT", "8006")

    if not host:
        raise RuntimeError("missing PROXMOX_HOST in environment or proxmox.env")

    return f"{protocol}://{host}:{port}"


def proxmox_verify_tls(config):
    allow_insecure = config.get("PROXMOX_ALLOW_INSECURE_TLS", "true").strip().lower()
    return allow_insecure not in {"1", "true", "yes", "on"}


def maybe_int(value):
    if isinstance(value, int):
        return value

    if isinstance(value, str) and value.isdigit():
        return int(value)

    return None


def collect_vmids_from_object(value, vmids):
    if isinstance(value, dict):
        for key, item in value.items():
            lowered = str(key).lower()
            if lowered in {"vmid", "proxmox_vmid"}:
                parsed = maybe_int(item)
                if parsed is not None:
                    vmids.add(parsed)

            collect_vmids_from_object(item, vmids)
        return

    if isinstance(value, list):
        for item in value:
            collect_vmids_from_object(item, vmids)


def collect_vmids_from_text(text):
    vmids = set()
    if not text:
        return vmids

    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        payload = None

    if payload is not None:
        collect_vmids_from_object(payload, vmids)
        if vmids:
            return vmids

    for pattern in VMID_PATTERNS:
        for match in pattern.finditer(text):
            vmids.add(int(match.group(1)))

    return vmids


def collect_vmids_from_result(result):
    vmids = set()
    vmids.update(collect_vmids_from_text(result.get("stdout", "")))
    vmids.update(collect_vmids_from_text(result.get("stderr", "")))
    return vmids


def snapshot_vmids():
    result = run_cmd([CLOUDCTL, "describe-instances"])
    if not result["ok"]:
        return result, set()

    return result, collect_vmids_from_result(result)


def resolve_created_vmid(launch_result, before_vmids=None):
    launch_vmids = collect_vmids_from_result(launch_result)
    if len(launch_vmids) == 1:
        return next(iter(launch_vmids))

    if before_vmids is None:
        raise RuntimeError(
            f"launch succeeded but vmid was ambiguous in cloudctl output: {sorted(launch_vmids)}"
        )

    describe_result, after_vmids = snapshot_vmids()
    if not describe_result["ok"]:
        raise RuntimeError("launch succeeded but describe-instances failed while resolving vmid")

    created_vmids = after_vmids - before_vmids
    if len(created_vmids) == 1:
        return next(iter(created_vmids))

    overlapping_vmids = created_vmids & launch_vmids
    if len(overlapping_vmids) == 1:
        return next(iter(overlapping_vmids))

    if launch_vmids:
        raise RuntimeError(
            f"launch succeeded but vmid was ambiguous: launch={sorted(launch_vmids)}, newly_seen={sorted(created_vmids)}"
        )

    raise RuntimeError("launch succeeded but wrapper could not determine the created vmid")


def resolve_console_principal(headers):
    principal = headers.get("X-Console-User-Email", "").strip()
    if not principal:
        raise ValueError("missing X-Console-User-Email header")

    return principal


def assign_vm_acl(vmid, principal, role="PVEVMUser"):
    config = load_proxmox_config()
    token_id = config.get("PROXMOX_TOKEN_ID")
    token_secret = config.get("PROXMOX_TOKEN_SECRET")
    if not token_id or not token_secret:
        raise RuntimeError("missing Proxmox API token configuration")

    body = urllib.parse.urlencode(
        {
            "path": f"/vms/{vmid}",
            "users": principal,
            "roles": role,
            "propagate": "0",
        }
    ).encode("utf-8")

    request_obj = urllib.request.Request(
        f"{proxmox_base_url(config)}/api2/json/access/acl",
        data=body,
        method="PUT",
        headers={
            "Authorization": f"PVEAPIToken={token_id}={token_secret}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )

    ssl_context = None
    if not proxmox_verify_tls(config):
        ssl_context = ssl._create_unverified_context()

    try:
        with urllib.request.urlopen(request_obj, timeout=30, context=ssl_context) as response:
            payload = response.read().decode("utf-8").strip()
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"acl request failed with HTTP {exc.code}: {details}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"acl request failed: {exc}") from exc

    if not payload:
        return {"data": None}

    return json.loads(payload)


def log_info(message):
    print(message, flush=True)


def log_error(message):
    print(message, file=sys.stderr, flush=True)


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "ec2-api"})


@app.get("/instances")
def describe_instances():
    vmid = request.args.get("vmid")

    cmd = [CLOUDCTL, "describe-instances"]

    if vmid:
        cmd += ["--vmid", vmid]

    result = run_cmd(cmd)
    return jsonify(result), 200 if result["ok"] else 500


@app.post("/instances")
def run_instance():
    try:
        principal = resolve_console_principal(request.headers)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    body = request.get_json(force=True) or {}

    name = body.get("name")
    instance_type = body.get("instance_type", "t3.small")
    password = body.get("password", "ChangeMe123!")

    if not name:
        return jsonify({"ok": False, "error": "Missing required field: name"}), 400

    _, before_vmids = snapshot_vmids()

    cmd = [
        CLOUDCTL,
        "run-instance",
        "--name",
        name,
        "--instance-type",
        instance_type,
        "--password",
        password,
    ]

    launch_result = run_cmd(cmd)
    if not launch_result["ok"]:
        return jsonify(launch_result), 500

    try:
        vmid = resolve_created_vmid(launch_result, before_vmids)
    except Exception as exc:
        log_error(
            f"[launch-error] principal={principal} name={name} stage=resolve_vmid error={exc}"
        )
        return (
            jsonify(
                {
                    "ok": False,
                    "error": str(exc),
                    "stage": "resolve_vmid",
                    "principal": principal,
                    "launch": launch_result,
                }
            ),
            502,
        )

    instance_id = f"i-{int(vmid):08d}"
    log_info(f"[launch] principal={principal} vmid={vmid} instance_id={instance_id} name={name}")

    acl = {"ok": True, "result": None}
    warning = None
    try:
        acl["result"] = assign_vm_acl(vmid, principal)
        log_info(f"[launch-acl] principal={principal} vmid={vmid} role=PVEVMUser")
    except Exception as exc:
        warning = f"instance launched but acl assignment failed: {exc}"
        acl = {"ok": False, "error": str(exc)}
        log_error(
            f"[launch-warning] principal={principal} vmid={vmid} stage=assign_acl error={exc}"
        )

    return jsonify(
        {
            "ok": True,
            "principal": principal,
            "vmid": vmid,
            "instance_id": instance_id,
            "launch": launch_result,
            "acl": acl,
            **({"warning": warning} if warning else {}),
        }
    )


@app.post("/instances/<int:vmid>/start")
def start_instance(vmid):
    result = run_cmd([CLOUDCTL, "start-instance", "--vmid", str(vmid)])
    return jsonify(result), 200 if result["ok"] else 500


@app.post("/instances/<int:vmid>/stop")
def stop_instance(vmid):
    result = run_cmd([CLOUDCTL, "stop-instance", "--vmid", str(vmid)])
    return jsonify(result), 200 if result["ok"] else 500


@app.delete("/instances/<int:vmid>")
def terminate_instance(vmid):
    stop = run_cmd([CLOUDCTL, "stop-instance", "--vmid", str(vmid)])
    delete = run_cmd([CLOUDCTL, "terminate-instance", "--vmid", str(vmid)])

    ok = delete["ok"]

    return (
        jsonify(
            {
                "ok": ok,
                "stop": stop,
                "delete": delete,
            }
        ),
        200 if ok else 500,
    )


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8090)