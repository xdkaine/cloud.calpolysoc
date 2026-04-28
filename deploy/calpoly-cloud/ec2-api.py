#!/usr/bin/env python3

import copy
import hmac
import json
import os
import re
import ssl
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

from flask import Flask, jsonify, request

app = Flask(__name__)

CLOUDCTL = "/usr/local/bin/cloudctl"
PROXMOX_ENV_PATH = "/etc/calpoly-cloud/proxmox.env"
OWNER_METADATA_PREFIX = "calpolysoc_owner="
DEFAULT_ACL_ROLE = "PVEVMUser"
INTERNAL_AUTH_HEADER = "X-Console-Internal-Token"

VMID_PATTERNS = (
    re.compile(r"(?im)^\s*VMID:\s*(\d+)\s*$"),
    re.compile(r"(?im)^\s*ProxmoxVMID:\s*(\d+)\s*$"),
    re.compile(r'(?i)["\']?vmid["\']?\s*[:=]\s*["\']?(\d+)'),
    re.compile(r"(?i)\bvmid\b[^\d]{0,20}(\d+)"),
    re.compile(r"/qemu/(\d+)\b"),
)

PRIVILEGED_ROLES = {
    "admin",
    "staff",
    "cloud-admin",
    "cloud-staff",
    "cloud-operator",
    "cloud-support",
}

JOBS = {}
JOBS_LOCK = threading.Lock()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


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


def expected_internal_token():
    config = load_proxmox_config()
    return (
        config.get("CLOUD_API_INTERNAL_TOKEN")
        or config.get("EC2_API_INTERNAL_TOKEN")
        or os.environ.get("CLOUD_API_INTERNAL_TOKEN")
        or os.environ.get("EC2_API_INTERNAL_TOKEN")
    )


def require_internal_auth():
    expected = expected_internal_token()
    if not expected:
        return jsonify(
            {
                "ok": False,
                "error": "EC2 internal auth token is not configured",
            }
        ), 503

    supplied = request.headers.get(INTERNAL_AUTH_HEADER, "")
    if not hmac.compare_digest(supplied, expected):
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    return None


def proxmox_base_url(config):
    if config.get("PROXMOX_API_BASE_URL"):
        base_url = config["PROXMOX_API_BASE_URL"].rstrip("/")
        if base_url.endswith("/api2/json"):
            base_url = base_url[: -len("/api2/json")]
        return base_url

    protocol = config.get("PROXMOX_PROTOCOL", "https")
    host = config.get("PROXMOX_HOST")
    port = config.get("PROXMOX_PORT", "8006")

    if not host:
        raise RuntimeError("missing PROXMOX_HOST in environment or proxmox.env")

    return f"{protocol}://{host}:{port}"


def proxmox_verify_tls(config):
    allow_insecure = config.get("PROXMOX_ALLOW_INSECURE_TLS", "true").strip().lower()
    return allow_insecure not in {"1", "true", "yes", "on"}


def proxmox_request(config, path, method="GET", data=None, timeout=30):
    token_id = config.get("PROXMOX_TOKEN_ID")
    token_secret = config.get("PROXMOX_TOKEN_SECRET")
    if not token_id or not token_secret:
        raise RuntimeError("missing Proxmox API token configuration")

    encoded_body = None
    headers = {
        "Authorization": f"PVEAPIToken={token_id}={token_secret}",
    }
    if data is not None:
        encoded_body = urllib.parse.urlencode(data).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"

    request_obj = urllib.request.Request(
        f"{proxmox_base_url(config)}{path}",
        data=encoded_body,
        method=method,
        headers=headers,
    )

    ssl_context = None
    if not proxmox_verify_tls(config):
        ssl_context = ssl._create_unverified_context()

    try:
        with urllib.request.urlopen(
            request_obj, timeout=timeout, context=ssl_context
        ) as response:
            payload = response.read().decode("utf-8").strip()
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Proxmox request {method} {path} failed with HTTP {exc.code}: {details}"
        ) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Proxmox request {method} {path} failed: {exc}") from exc

    if not payload:
        return {"data": None}

    return json.loads(payload)


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
    result = run_cmd([CLOUDCTL, "describe-instances", "--json"])
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


def parse_roles(raw_roles):
    return [role.strip() for role in (raw_roles or "").split(",") if role.strip()]


def parse_principal_map(raw_value):
    if not raw_value:
        return {}

    try:
        parsed = json.loads(raw_value)
        if isinstance(parsed, dict):
            return {str(key): str(value) for key, value in parsed.items()}
    except json.JSONDecodeError:
        pass

    mapping = {}
    for item in re.split(r"[,\n;]+", raw_value):
        if "=" not in item:
            continue
        key, value = item.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key and value:
            mapping[key] = value
    return mapping


def map_console_principal(console_principal, config):
    principal_map = parse_principal_map(config.get("PROXMOX_CONSOLE_PRINCIPAL_MAP"))
    if console_principal in principal_map:
        return principal_map[console_principal]

    realm = config.get("PROXMOX_ACL_REALM") or config.get("PROXMOX_USER_REALM")
    if realm:
        local_part = console_principal.split("@", 1)[0]
        return f"{local_part}@{realm}"

    return console_principal


def resolve_console_identity(headers, required=True):
    console_principal = headers.get("X-Console-User-Email", "").strip()
    if not console_principal:
        if required:
            raise ValueError("missing X-Console-User-Email header")
        return None

    config = load_proxmox_config()
    acl_group = config.get("PROXMOX_ACL_GROUP", "").strip()
    acl_subject = {
        "type": "group" if acl_group else "user",
        "id": acl_group or map_console_principal(console_principal, config),
    }

    return {
        "principal": console_principal,
        "email": console_principal,
        "id": headers.get("X-Console-User-Id", "").strip() or None,
        "name": headers.get("X-Console-User-Name", "").strip() or None,
        "roles": parse_roles(headers.get("X-Console-User-Roles")),
        "auth_source": headers.get("X-Console-Auth-Source", "").strip() or None,
        "acl_subject": acl_subject,
    }


def has_privileged_role(identity):
    if not identity:
        return False

    normalized_roles = [role.strip().lower() for role in identity.get("roles", [])]
    return any(role in PRIVILEGED_ROLES for role in normalized_roles)


def owner_matches_identity(instance, identity):
    if not identity:
        return False

    owner = instance.get("owner") or {}
    candidates = {
        owner.get("principal"),
        owner.get("email"),
        owner.get("proxmox_principal"),
        owner.get("acl_subject"),
        instance.get("owner_principal"),
        instance.get("owner_email"),
    }
    candidates = {str(candidate).strip().lower() for candidate in candidates if candidate}

    acl_subject = identity.get("acl_subject") or {}
    expected = {
        identity.get("principal"),
        identity.get("email"),
        acl_subject.get("id"),
    }
    expected = {str(candidate).strip().lower() for candidate in expected if candidate}

    if candidates & expected:
        return True

    return any(
        acl_entry_matches_identity(entry, identity)
        for entry in instance.get("acl_entries", [])
    )


def acl_entry_matches_identity(entry, identity):
    if not identity:
        return False

    subject = str(entry.get("ugid") or "").strip().lower()
    if not subject:
        return False

    acl_subject = identity.get("acl_subject") or {}
    expected = {
        identity.get("principal"),
        identity.get("email"),
        identity.get("id"),
        acl_subject.get("id"),
    }
    expected = {str(candidate).strip().lower() for candidate in expected if candidate}
    if subject in expected:
        return True

    if str(entry.get("type") or "").strip().lower() != "group":
        return False

    normalized_subject = subject[1:] if subject.startswith("@") else subject
    role_candidates = {
        (
            role.strip().lower()[1:]
            if role.strip().lower().startswith("@")
            else role.strip().lower()
        )
        for role in identity.get("roles", [])
        if role.strip()
    }
    return normalized_subject in role_candidates


def filter_instances_for_identity(instances, identity):
    if not identity:
        return []

    if has_privileged_role(identity):
        return instances

    return [
        instance for instance in instances
        if owner_matches_identity(instance, identity)
    ]


def sanitize_instances_for_identity(instances, identity):
    if not identity:
        return []

    if has_privileged_role(identity):
        return instances

    sanitized = []
    for instance in instances:
        cleaned = dict(instance)
        cleaned["acl_entries"] = [
            entry for entry in instance.get("acl_entries", [])
            if acl_entry_matches_identity(entry, identity)
        ]
        sanitized.append(cleaned)

    return sanitized


def parse_cloudctl_instances(result):
    try:
        payload = json.loads(result.get("stdout") or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"cloudctl returned invalid JSON: {exc}") from exc

    if isinstance(payload, list):
        return {"instances": payload}
    if isinstance(payload, dict) and isinstance(payload.get("instances"), list):
        return payload

    raise RuntimeError("cloudctl JSON did not include an instances array")


def encode_owner_metadata(owner):
    clean = {
        key: value for key, value in owner.items()
        if value not in (None, "", [])
    }
    payload = json.dumps(clean, sort_keys=True, separators=(",", ":"))
    return OWNER_METADATA_PREFIX + urllib.parse.quote(payload, safe="")


def upsert_owner_metadata(existing_description, owner):
    lines = [
        line for line in (existing_description or "").splitlines()
        if not line.startswith(OWNER_METADATA_PREFIX)
    ]
    lines.append(encode_owner_metadata(owner))
    return "\n".join(line for line in lines if line.strip())


def set_vm_owner_metadata(vmid, owner):
    config = load_proxmox_config()
    node = config.get("PROXMOX_NODE")
    if not node:
        raise RuntimeError("missing PROXMOX_NODE in environment or proxmox.env")

    node_path = urllib.parse.quote(str(node), safe="")
    current = proxmox_request(
        config,
        f"/api2/json/nodes/{node_path}/qemu/{int(vmid)}/config",
    )
    current_description = (current.get("data") or {}).get("description", "")
    description = upsert_owner_metadata(current_description, owner)
    result = proxmox_request(
        config,
        f"/api2/json/nodes/{node_path}/qemu/{int(vmid)}/config",
        method="POST",
        data={"description": description},
    )

    return {"ok": True, "result": result, "owner": owner}


def fetch_vm_acl_entries(vmid, acl_subject=None, role=None):
    config = load_proxmox_config()
    payload = proxmox_request(config, "/api2/json/access/acl")
    vm_path = f"/vms/{int(vmid)}"
    entries = [
        row for row in payload.get("data", [])
        if row.get("path") == vm_path
    ]

    if acl_subject:
        entries = [
            row for row in entries
            if row.get("ugid") == acl_subject.get("id")
        ]

    if role:
        entries = [
            row for row in entries
            if row.get("roleid") == role
        ]

    return entries


def load_acl_entries_by_vmid():
    config = load_proxmox_config()
    payload = proxmox_request(config, "/api2/json/access/acl")
    by_vmid = {}

    for row in payload.get("data", []):
        path = str(row.get("path") or "")
        match = re.fullmatch(r"/vms/(\d+)", path)
        if not match:
            continue

        vmid = int(match.group(1))
        by_vmid.setdefault(vmid, []).append(row)

    return by_vmid


def attach_acl_entries(instances):
    try:
        acl_entries_by_vmid = load_acl_entries_by_vmid()
    except Exception as exc:
        log_error(f"[acl-warning] stage=list_acl error={exc}")
        return instances

    enriched = []
    for instance in instances:
        item = dict(instance)
        vmid = maybe_int(item.get("vmid"))
        item["acl_entries"] = acl_entries_by_vmid.get(vmid, []) if vmid else []
        enriched.append(item)

    return enriched


def assign_vm_acl(vmid, acl_subject, role=DEFAULT_ACL_ROLE):
    subject_id = (acl_subject or {}).get("id")
    subject_type = (acl_subject or {}).get("type", "user")
    if not subject_id:
        raise RuntimeError("missing ACL subject")
    if subject_type not in {"user", "group"}:
        raise RuntimeError(f"unsupported ACL subject type: {subject_type}")

    config = load_proxmox_config()
    body = {
        "path": f"/vms/{int(vmid)}",
        "roles": role,
        "propagate": "0",
    }
    body["groups" if subject_type == "group" else "users"] = subject_id

    result = proxmox_request(
        config,
        "/api2/json/access/acl",
        method="PUT",
        data=body,
    )
    entries = fetch_vm_acl_entries(vmid, acl_subject, role)

    return {
        "ok": True,
        "result": result,
        "subject": acl_subject,
        "role": role,
        "verified": len(entries) > 0,
        "entries": entries,
    }


def make_owner_payload(identity, body):
    acl_subject = identity.get("acl_subject") or {}
    return {
        "principal": identity.get("principal"),
        "email": identity.get("email"),
        "id": identity.get("id"),
        "name": identity.get("name"),
        "auth_source": identity.get("auth_source"),
        "roles": identity.get("roles"),
        "acl_subject": acl_subject.get("id"),
        "acl_subject_type": acl_subject.get("type"),
        "instance_type": body.get("instance_type", "t3.small"),
        "image_id": body.get("image_id"),
        "template_name": body.get("template_name"),
        "template_vmid": body.get("template_vmid"),
        "created_at": now_iso(),
    }


def job_snapshot(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return None
        return copy.deepcopy(job)


def update_job(job_id, **updates):
    with JOBS_LOCK:
        job = JOBS[job_id]
        job.update(updates)
        job["updated_at"] = now_iso()
        return copy.deepcopy(job)


def create_job(identity, body):
    job_id = uuid.uuid4().hex
    now = now_iso()
    job = {
        "ok": True,
        "job_id": job_id,
        "state": "pending",
        "message": "launch queued",
        "principal": identity.get("principal"),
        "acl_subject": identity.get("acl_subject"),
        "name": body.get("name"),
        "created_at": now,
        "updated_at": now,
    }

    with JOBS_LOCK:
        JOBS[job_id] = job

    return copy.deepcopy(job)


def fail_job(job_id, message, **extra):
    log_error(f"[launch-error] job_id={job_id} error={message}")
    return update_job(
        job_id,
        ok=False,
        state="failed",
        message=message,
        error=message,
        **extra,
    )


def command_failure_message(result, fallback):
    details = (result.get("stderr") or result.get("stdout") or "").strip()
    if not details:
        return fallback

    compact = re.sub(r"\s+", " ", details)
    if len(compact) > 700:
        compact = compact[:697] + "..."

    return f"{fallback}: {compact}"


def launch_instance_job(job_id, identity, body):
    name = body.get("name")
    instance_type = body.get("instance_type", "t3.small")
    password = body.get("password", "ChangeMe123!")
    username = body.get("username") or body.get("user")
    image_id = body.get("image_id")
    template_name = body.get("template_name")
    template_vmid = body.get("template_vmid")

    update_job(job_id, state="running", message="creating Proxmox VM")

    snapshot_result, before_vmids = snapshot_vmids()
    if not snapshot_result["ok"]:
        log_error(
            f"[launch-warning] job_id={job_id} principal={identity['principal']} "
            f"stage=snapshot_before error={snapshot_result.get('stderr')}"
        )
        before_vmids = None

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
    if image_id:
        cmd += ["--ami", str(image_id)]
    if template_vmid:
        cmd += ["--template-vmid", str(template_vmid)]
    if template_name:
        cmd += ["--template-name", str(template_name)]
    if username:
        cmd += ["--user", username]

    launch_result = run_cmd(cmd)
    update_job(job_id, launch=launch_result)
    if not launch_result["ok"]:
        fail_job(
            job_id,
            command_failure_message(launch_result, "cloudctl run-instance failed"),
            launch=launch_result,
        )
        return

    try:
        vmid = resolve_created_vmid(launch_result, before_vmids)
    except Exception as exc:
        fail_job(
            job_id,
            str(exc),
            stage="resolve_vmid",
            launch=launch_result,
        )
        return

    instance_id = f"i-{int(vmid):08d}"
    log_info(
        f"[launch] job_id={job_id} principal={identity['principal']} "
        f"acl_subject={identity['acl_subject']['id']} vmid={vmid} "
        f"instance_id={instance_id} name={name}"
    )

    owner = make_owner_payload(identity, body)
    update_job(
        job_id,
        vmid=vmid,
        instance_id=instance_id,
        owner=owner,
        message="assigning owner and ACL",
    )

    warnings = []
    owner_result = {"ok": True, "result": None}
    try:
        owner_result = set_vm_owner_metadata(vmid, owner)
        log_info(
            f"[launch-owner] job_id={job_id} principal={identity['principal']} "
            f"vmid={vmid}"
        )
    except Exception as exc:
        message = f"owner metadata assignment failed: {exc}"
        warnings.append(message)
        owner_result = {"ok": False, "error": str(exc)}
        log_error(
            f"[launch-warning] job_id={job_id} principal={identity['principal']} "
            f"vmid={vmid} stage=set_owner error={exc}"
        )

    acl = {"ok": True, "result": None}
    try:
        acl = assign_vm_acl(vmid, identity["acl_subject"])
        log_info(
            f"[launch-acl] job_id={job_id} principal={identity['principal']} "
            f"subject={identity['acl_subject']['id']} vmid={vmid} role={DEFAULT_ACL_ROLE} "
            f"verified={acl.get('verified')}"
        )
        if not acl.get("verified"):
            warnings.append("acl assignment was accepted but was not found in ACL readback")
    except Exception as exc:
        message = f"acl assignment failed: {exc}"
        warnings.append(message)
        acl = {"ok": False, "error": str(exc), "subject": identity["acl_subject"]}
        log_error(
            f"[launch-warning] job_id={job_id} principal={identity['principal']} "
            f"vmid={vmid} stage=assign_acl error={exc}"
        )

    final_state = "warning" if warnings else "succeeded"
    update_job(
        job_id,
        ok=True,
        state=final_state,
        message=(
            "instance launched with warnings"
            if warnings else
            "instance launched"
        ),
        owner_metadata=owner_result,
        acl=acl,
        warnings=warnings,
    )


def log_info(message):
    print(message, flush=True)


def log_error(message):
    print(message, file=sys.stderr, flush=True)


def load_instances(vmid=None):
    cmd = [CLOUDCTL, "describe-instances", "--json"]
    if vmid:
        cmd += ["--vmid", str(vmid)]

    result = run_cmd(cmd)
    if not result["ok"]:
        return result, None

    payload = parse_cloudctl_instances(result)
    return result, payload


def require_instance_access(vmid):
    identity = resolve_console_identity(request.headers, required=False)
    if not identity:
        return jsonify({"ok": False, "error": "missing console identity"}), 401
    if has_privileged_role(identity):
        return None

    try:
        result, payload = load_instances(vmid)
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500

    if not result["ok"]:
        return jsonify(result), 500

    instances = attach_acl_entries(payload.get("instances", []))
    if not instances:
        return jsonify({"ok": False, "error": "instance not found"}), 404

    if not owner_matches_identity(instances[0], identity):
        return jsonify({"ok": False, "error": "forbidden for this instance"}), 403

    return None


@app.before_request
def guard_internal_requests():
    if request.endpoint == "health":
        return None

    return require_internal_auth()


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "ec2-api"})


@app.get("/jobs/<job_id>")
def get_job(job_id):
    job = job_snapshot(job_id)
    if not job:
        return jsonify({"ok": False, "error": "job not found"}), 404

    return jsonify(job), 200


@app.get("/instances")
def describe_instances():
    vmid = request.args.get("vmid")
    identity = resolve_console_identity(request.headers, required=False)

    try:
        result, payload = load_instances(vmid)
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500

    if not result["ok"]:
        return jsonify(result), 500

    try:
        instances = attach_acl_entries(payload.get("instances", []))
        instances = filter_instances_for_identity(instances, identity)
        instances = sanitize_instances_for_identity(instances, identity)
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500

    return jsonify(
        {
            "ok": True,
            "instances": instances,
            "count": len(instances),
            **({"principal": identity["principal"]} if identity else {}),
        }
    )


@app.post("/instances")
def run_instance():
    try:
        identity = resolve_console_identity(request.headers)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    body = request.get_json(force=True) or {}

    name = body.get("name")
    if not name:
        return jsonify({"ok": False, "error": "Missing required field: name"}), 400

    job = create_job(identity, body)
    thread = threading.Thread(
        target=launch_instance_job,
        args=(job["job_id"], identity, body),
        daemon=True,
    )
    thread.start()

    return jsonify(job), 202


@app.post("/instances/<int:vmid>/start")
def start_instance(vmid):
    access_error = require_instance_access(vmid)
    if access_error:
        return access_error

    result = run_cmd([CLOUDCTL, "start-instance", "--vmid", str(vmid)])
    return jsonify(result), 200 if result["ok"] else 500


@app.post("/instances/<int:vmid>/stop")
def stop_instance(vmid):
    access_error = require_instance_access(vmid)
    if access_error:
        return access_error

    result = run_cmd([CLOUDCTL, "stop-instance", "--vmid", str(vmid)])
    return jsonify(result), 200 if result["ok"] else 500


@app.delete("/instances/<int:vmid>")
def terminate_instance(vmid):
    access_error = require_instance_access(vmid)
    if access_error:
        return access_error

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
