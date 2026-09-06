#!/usr/bin/env python3

import copy
import base64
import hashlib
import html
import hmac
import ipaddress
import json
import os
import re
import secrets
import ssl
import sqlite3
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

from flask import Flask, Response, jsonify, request

app = Flask(__name__)

CLOUDCTL = "/usr/local/bin/cloudctl"
PROXMOX_ENV_PATH = "/etc/calpoly-cloud/proxmox.env"
OWNER_METADATA_PREFIX = "calpolysoc_owner="
DEFAULT_ACL_ROLE = "PVEVMUser"
INTERNAL_AUTH_HEADER = "X-Console-Internal-Token"
DEFAULT_DB_PATH = "/var/lib/calpoly-cloud/ec2-api.sqlite3"
EC2_XMLNS = "http://ec2.amazonaws.com/doc/2016-11-15/"
REQUEST_IDENTITY_KEY = "calpoly_cloud.identity"
SIGV4_ALGORITHM = "AWS4-HMAC-SHA256"
SIGV4_TERMINATOR = "aws4_request"
DEFAULT_SIGV4_MAX_SKEW_SECONDS = 900

IMAGE_TEMPLATE_VMIDS = {
    "ami-ubuntu-2404": 9001,
    "ami-ubuntu-2204": 9002,
    "ami-debian-12": 9010,
    "ami-rocky-9": 9020,
    "ami-almalinux-9": 9030,
}

IMAGE_CATALOG = [
    {
        "image_id": "ami-ubuntu-2404",
        "name": "Ubuntu Server 24.04 LTS",
        "template_vmid": 9001,
        "architecture": "x86_64",
        "platform": "linux",
    },
    {
        "image_id": "ami-ubuntu-2204",
        "name": "Ubuntu Server 22.04 LTS",
        "template_vmid": 9002,
        "architecture": "x86_64",
        "platform": "linux",
    },
    {
        "image_id": "ami-debian-12",
        "name": "Debian 12",
        "template_vmid": 9010,
        "architecture": "x86_64",
        "platform": "linux",
    },
    {
        "image_id": "ami-rocky-9",
        "name": "Rocky Linux 9",
        "template_vmid": 9020,
        "architecture": "x86_64",
        "platform": "linux",
    },
    {
        "image_id": "ami-almalinux-9",
        "name": "AlmaLinux 9",
        "template_vmid": 9030,
        "architecture": "x86_64",
        "platform": "linux",
    },
]

INSTANCE_TYPES = {
    "t3.nano": {"cores": 1, "memory": 512},
    "t3.micro": {"cores": 1, "memory": 1024},
    "t3.small": {"cores": 1, "memory": 2048},
    "t3.medium": {"cores": 2, "memory": 4096},
    "t3.large": {"cores": 2, "memory": 8192},
    "t3.xlarge": {"cores": 4, "memory": 16384},
    "c6i.large": {"cores": 2, "memory": 4096},
    "c6i.xlarge": {"cores": 4, "memory": 8192},
    "m6i.large": {"cores": 2, "memory": 8192},
    "m6i.xlarge": {"cores": 4, "memory": 16384},
    "r6i.large": {"cores": 2, "memory": 16384},
    "r6i.xlarge": {"cores": 4, "memory": 32768},
}

MANAGED_DB_CLASSES = {
    "db.t3.small": {"instance_type": "t3.small", "storage_gib": 20},
    "db.t3.medium": {"instance_type": "t3.medium", "storage_gib": 40},
}

MANAGED_CACHE_CLASSES = {
    "cache.t3.small": {"instance_type": "t3.small", "storage_gib": 10},
    "cache.t3.medium": {"instance_type": "t3.medium", "storage_gib": 20},
}

MANAGED_DB_ENGINES = {
    "postgres": {"version": "16", "port": 5432, "username": "postgres"},
    "postgres16": {"version": "16", "port": 5432, "username": "postgres"},
}

MANAGED_CACHE_ENGINES = {
    "redis": {"version": "7", "port": 6379, "username": "default"},
    "redis7": {"version": "7", "port": 6379, "username": "default"},
}

QUOTA_ENV_DEFAULTS = {
    "instances": "CLOUD_QUOTA_MAX_INSTANCES",
    "vcpus": "CLOUD_QUOTA_MAX_VCPUS",
    "memory_mib": "CLOUD_QUOTA_MAX_MEMORY_MIB",
    "volume_gib": "CLOUD_QUOTA_MAX_VOLUME_GIB",
    "db_instances": "CLOUD_QUOTA_MAX_DB_INSTANCES",
    "cache_instances": "CLOUD_QUOTA_MAX_CACHE_INSTANCES",
}

REGION_CATALOG = [
    {
        "region_name": "us-calpoly-1",
        "endpoint": "api.cloud.calpolysoc.org",
    }
]

AVAILABILITY_ZONE_CATALOG = [
    {
        "zone_name": "us-calpoly-1a",
        "region_name": "us-calpoly-1",
        "state": "available",
    }
]

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

JOBS_LOCK = threading.Lock()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def run_cmd(args, extra_env=None):
    env = None
    if extra_env:
        env = os.environ.copy()
        env.update(extra_env)

    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
        env=env,
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


def request_has_valid_internal_token():
    expected = expected_internal_token()
    supplied = request.headers.get(INTERNAL_AUTH_HEADER, "")
    return bool(expected and supplied and hmac.compare_digest(supplied, expected))


def sigv4_max_skew_seconds():
    config = load_proxmox_config()
    raw_value = (
        config.get("EC2_SIGV4_MAX_SKEW_SECONDS")
        or os.environ.get("EC2_SIGV4_MAX_SKEW_SECONDS")
        or str(DEFAULT_SIGV4_MAX_SKEW_SECONDS)
    )
    try:
        return max(0, int(raw_value))
    except ValueError:
        return DEFAULT_SIGV4_MAX_SKEW_SECONDS


def database_path():
    config = load_proxmox_config()
    return (
        config.get("CLOUD_API_DB_PATH")
        or os.environ.get("CLOUD_API_DB_PATH")
        or DEFAULT_DB_PATH
    )


def db_connect():
    path = database_path()
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, mode=0o700, exist_ok=True)

    connection = sqlite3.connect(path, timeout=30)
    connection.row_factory = sqlite3.Row
    return connection


def init_database():
    with db_connect() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                job_id TEXT PRIMARY KEY,
                state TEXT NOT NULL,
                ok INTEGER NOT NULL,
                principal TEXT,
                name TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                payload TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_events (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL,
                actor_principal TEXT,
                actor_email TEXT,
                action TEXT NOT NULL,
                resource_type TEXT,
                resource_id TEXT,
                result TEXT NOT NULL,
                status INTEGER,
                message TEXT,
                details TEXT
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS jobs_updated_at_idx ON jobs(updated_at)"
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS audit_events_timestamp_idx
            ON audit_events(timestamp)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS vpcs (
                vpc_id TEXT PRIMARY KEY,
                cidr_block TEXT NOT NULL,
                state TEXT NOT NULL,
                principal TEXT,
                name TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                payload TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS subnets (
                subnet_id TEXT PRIMARY KEY,
                vpc_id TEXT NOT NULL,
                cidr_block TEXT NOT NULL,
                availability_zone TEXT,
                state TEXT NOT NULL,
                principal TEXT,
                name TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                payload TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS security_groups (
                group_id TEXT PRIMARY KEY,
                vpc_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                principal TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                payload TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS security_group_rules (
                rule_id TEXT PRIMARY KEY,
                group_id TEXT NOT NULL,
                direction TEXT NOT NULL,
                ip_protocol TEXT NOT NULL,
                from_port INTEGER,
                to_port INTEGER,
                cidr_ip TEXT,
                source_group_id TEXT,
                description TEXT,
                created_at TEXT NOT NULL,
                payload TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS vpcs_principal_idx ON vpcs(principal)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS subnets_vpc_id_idx ON subnets(vpc_id)"
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS security_groups_vpc_id_idx
            ON security_groups(vpc_id)
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS security_group_rules_group_id_idx
            ON security_group_rules(group_id)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS access_keys (
                access_key_id TEXT PRIMARY KEY,
                secret_access_key TEXT NOT NULL,
                status TEXT NOT NULL,
                principal TEXT,
                name TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_used_at TEXT,
                payload TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS access_keys_principal_idx
            ON access_keys(principal)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS key_pairs (
                key_pair_id TEXT PRIMARY KEY,
                key_name TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                public_key TEXT NOT NULL,
                principal TEXT,
                created_at TEXT NOT NULL,
                payload TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS key_pairs_principal_idx
            ON key_pairs(principal)
            """
        )
        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS key_pairs_principal_name_idx
            ON key_pairs(principal, key_name)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS instance_security_groups (
                vmid INTEGER NOT NULL,
                group_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (vmid, group_id)
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS instance_sg_vmid_idx
            ON instance_security_groups(vmid)
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS instance_sg_group_id_idx
            ON instance_security_groups(group_id)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS volumes (
                volume_id TEXT PRIMARY KEY,
                state TEXT NOT NULL,
                size_gib INTEGER NOT NULL,
                availability_zone TEXT,
                attached_vmid INTEGER,
                last_vmid INTEGER,
                device_name TEXT,
                proxmox_volume TEXT,
                unused_key TEXT,
                source_snapshot_id TEXT,
                principal TEXT,
                name TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                payload TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS volumes_principal_idx ON volumes(principal)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS volumes_attached_vmid_idx ON volumes(attached_vmid)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS snapshots (
                snapshot_id TEXT PRIMARY KEY,
                volume_id TEXT NOT NULL,
                state TEXT NOT NULL,
                size_gib INTEGER NOT NULL,
                principal TEXT,
                name TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                payload TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS snapshots_principal_idx ON snapshots(principal)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS snapshots_volume_id_idx ON snapshots(volume_id)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS db_instances (
                db_instance_id TEXT PRIMARY KEY,
                engine TEXT NOT NULL,
                state TEXT NOT NULL,
                instance_class TEXT NOT NULL,
                allocated_storage_gib INTEGER NOT NULL,
                vmid INTEGER,
                endpoint_address TEXT,
                endpoint_port INTEGER,
                principal TEXT,
                name TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                payload TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS db_instances_principal_idx ON db_instances(principal)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS cache_instances (
                cache_instance_id TEXT PRIMARY KEY,
                engine TEXT NOT NULL,
                state TEXT NOT NULL,
                instance_class TEXT NOT NULL,
                allocated_storage_gib INTEGER NOT NULL,
                vmid INTEGER,
                endpoint_address TEXT,
                endpoint_port INTEGER,
                principal TEXT,
                name TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                payload TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS cache_instances_principal_idx ON cache_instances(principal)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS quota_usage (
                principal TEXT PRIMARY KEY,
                updated_at TEXT NOT NULL,
                payload TEXT NOT NULL
            )
            """
        )


def save_job(job):
    payload = json.dumps(job, sort_keys=True)
    with db_connect() as connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO jobs (
                job_id,
                state,
                ok,
                principal,
                name,
                created_at,
                updated_at,
                payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job["job_id"],
                job.get("state", "unknown"),
                1 if job.get("ok", False) else 0,
                job.get("principal"),
                job.get("name"),
                job.get("created_at") or now_iso(),
                job.get("updated_at") or now_iso(),
                payload,
            ),
        )


def job_from_row(row):
    if not row:
        return None

    try:
        payload = json.loads(row["payload"])
    except json.JSONDecodeError:
        payload = {}

    payload.setdefault("job_id", row["job_id"])
    payload.setdefault("state", row["state"])
    payload.setdefault("ok", bool(row["ok"]))
    payload.setdefault("principal", row["principal"])
    payload.setdefault("name", row["name"])
    payload.setdefault("created_at", row["created_at"])
    payload.setdefault("updated_at", row["updated_at"])
    return payload


def list_jobs(limit=100):
    bounded_limit = max(1, min(int(limit), 500))
    with db_connect() as connection:
        rows = connection.execute(
            """
            SELECT * FROM jobs
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (bounded_limit,),
        ).fetchall()

    return [job_from_row(row) for row in rows]


def record_audit_event(
    action,
    identity=None,
    resource_type=None,
    resource_id=None,
    result="success",
    status=None,
    message=None,
    details=None,
):
    actor = identity or {}
    event_id = uuid.uuid4().hex
    timestamp = now_iso()
    try:
        with db_connect() as connection:
            connection.execute(
                """
                INSERT INTO audit_events (
                    id,
                    timestamp,
                    actor_principal,
                    actor_email,
                    action,
                    resource_type,
                    resource_id,
                    result,
                    status,
                    message,
                    details
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event_id,
                    timestamp,
                    actor.get("principal"),
                    actor.get("email"),
                    action,
                    resource_type,
                    str(resource_id) if resource_id is not None else None,
                    result,
                    status,
                    message,
                    (
                        json.dumps(details, sort_keys=True)
                        if details is not None
                        else None
                    ),
                ),
            )
    except Exception as exc:
        log_error(f"[audit-warning] action={action} error={exc}")

    return {
        "id": event_id,
        "timestamp": timestamp,
        "action": action,
        "result": result,
    }


def list_audit_events(limit=100):
    bounded_limit = max(1, min(int(limit), 500))
    with db_connect() as connection:
        rows = connection.execute(
            """
            SELECT * FROM audit_events
            ORDER BY timestamp DESC
            LIMIT ?
            """,
            (bounded_limit,),
        ).fetchall()

    events = []
    for row in rows:
        details = None
        if row["details"]:
            try:
                details = json.loads(row["details"])
            except json.JSONDecodeError:
                details = row["details"]

        events.append(
            {
                "id": row["id"],
                "timestamp": row["timestamp"],
                "actor": {
                    "principal": row["actor_principal"],
                    "email": row["actor_email"],
                },
                "action": row["action"],
                "resource_type": row["resource_type"],
                "resource_id": row["resource_id"],
                "result": row["result"],
                "status": row["status"],
                "message": row["message"],
                "details": details,
            }
        )

    return events


def generated_id(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def validate_cidr(value, field_name):
    if not value:
        raise ValueError(f"missing {field_name}")

    try:
        return str(ipaddress.ip_network(str(value), strict=False))
    except ValueError as exc:
        raise ValueError(f"invalid {field_name}: {value}") from exc


def json_payload(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def decode_payload(row):
    payload = json.loads(row["payload"])
    return payload


def control_owner_payload(identity):
    identity = identity or {}
    return {
        "principal": identity.get("principal"),
        "email": identity.get("email"),
        "id": identity.get("id"),
        "name": identity.get("name"),
        "roles": identity.get("roles"),
        "auth_source": identity.get("auth_source"),
    }


def record_matches_identity(record, identity):
    if not identity:
        return False
    if has_privileged_role(identity):
        return True

    owner = record.get("owner") or {}
    candidates = {
        record.get("principal"),
        owner.get("principal"),
        owner.get("email"),
        owner.get("id"),
    }
    acl_subject = identity.get("acl_subject") or {}
    expected = {
        identity.get("principal"),
        identity.get("email"),
        identity.get("id"),
        acl_subject.get("id"),
    }
    candidates = {str(item).strip().lower() for item in candidates if item}
    expected = {str(item).strip().lower() for item in expected if item}
    return bool(candidates & expected)


def filter_records_for_identity(records, identity):
    if not identity:
        return []
    if has_privileged_role(identity):
        return records
    return [record for record in records if record_matches_identity(record, identity)]


def list_images(image_ids=None):
    records = [dict(image) for image in IMAGE_CATALOG]
    if image_ids:
        wanted = {str(item) for item in image_ids}
        records = [record for record in records if record["image_id"] in wanted]
    return records


def list_regions(region_names=None):
    records = [dict(region) for region in REGION_CATALOG]
    if region_names:
        wanted = {str(item) for item in region_names}
        records = [record for record in records if record["region_name"] in wanted]
    return records


def list_availability_zones(zone_names=None):
    records = [dict(zone) for zone in AVAILABILITY_ZONE_CATALOG]
    if zone_names:
        wanted = {str(item) for item in zone_names}
        records = [record for record in records if record["zone_name"] in wanted]
    return records


def list_instance_types(instance_type_names=None):
    records = [
        {
            "instance_type": name,
            "vcpu": spec["cores"],
            "memory_mib": spec["memory"],
        }
        for name, spec in INSTANCE_TYPES.items()
    ]
    if instance_type_names:
        wanted = {str(item) for item in instance_type_names}
        records = [
            record for record in records
            if record["instance_type"] in wanted
        ]
    return records


def parse_positive_int(value, field_name, minimum=1):
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be an integer") from exc
    if parsed < minimum:
        raise ValueError(f"{field_name} must be at least {minimum}")
    return parsed


def config_int(name):
    config = load_proxmox_config()
    raw_value = config.get(name) or os.environ.get(name)
    if raw_value in (None, ""):
        return None
    try:
        parsed = int(raw_value)
    except ValueError:
        return None
    return parsed if parsed >= 0 else None


def quota_limits():
    return {
        quota_name: config_int(env_name)
        for quota_name, env_name in QUOTA_ENV_DEFAULTS.items()
    }


def save_quota_usage(principal, usage):
    if not principal:
        return
    with db_connect() as connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO quota_usage (principal, updated_at, payload)
            VALUES (?, ?, ?)
            """,
            (principal, now_iso(), json_payload(usage)),
        )


def active_resource(record):
    return record.get("state") not in {"deleted", "deleting"}


def instance_usage_for_identity(identity):
    result, payload = load_instances()
    if not result["ok"]:
        raise RuntimeError(command_failure_message(result, "describe-instances failed"))

    instances = attach_acl_entries(payload.get("instances", []))
    instances = filter_instances_for_identity(instances, identity)
    usage = {"instances": len(instances), "vcpus": 0, "memory_mib": 0}
    for instance in instances:
        instance_type = instance.get("instance_type")
        spec = INSTANCE_TYPES.get(instance_type or "")
        usage["vcpus"] += (
            int(spec["cores"])
            if spec else
            int(instance.get("cpus") or 0)
        )
        if spec:
            usage["memory_mib"] += int(spec["memory"])
        else:
            usage["memory_mib"] += int(instance.get("maxmem") or 0) // 1024 // 1024
    return usage


def quota_usage(identity, include_instances=True):
    usage = {
        "instances": 0,
        "vcpus": 0,
        "memory_mib": 0,
        "volume_gib": 0,
        "db_instances": 0,
        "cache_instances": 0,
    }

    if include_instances:
        usage.update(instance_usage_for_identity(identity))

    volumes = [item for item in list_volumes(identity) if active_resource(item)]
    db_instances = [item for item in list_db_instances(identity) if active_resource(item)]
    cache_instances = [item for item in list_cache_instances(identity) if active_resource(item)]

    usage["volume_gib"] += sum(int(volume.get("size_gib") or 0) for volume in volumes)
    usage["volume_gib"] += sum(
        int(item.get("allocated_storage_gib") or 0)
        for item in db_instances + cache_instances
    )
    usage["db_instances"] = len(db_instances)
    usage["cache_instances"] = len(cache_instances)
    save_quota_usage(identity.get("principal") if identity else None, usage)
    return usage


def assert_quota_available(identity, requested):
    if has_privileged_role(identity):
        return

    limits = quota_limits()
    relevant_instance_keys = {"instances", "vcpus", "memory_mib"}
    include_instances = bool(relevant_instance_keys & set(requested))
    usage = quota_usage(identity, include_instances=include_instances)
    exceeded = []
    for key, amount in requested.items():
        limit = limits.get(key)
        if limit in (None, 0):
            continue
        projected = usage.get(key, 0) + int(amount or 0)
        if projected > limit:
            exceeded.append(f"{key} quota exceeded ({projected}/{limit})")
    if exceeded:
        raise ValueError("; ".join(exceeded))


def save_volume(record):
    with db_connect() as connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO volumes (
                volume_id,
                state,
                size_gib,
                availability_zone,
                attached_vmid,
                last_vmid,
                device_name,
                proxmox_volume,
                unused_key,
                source_snapshot_id,
                principal,
                name,
                created_at,
                updated_at,
                payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["volume_id"],
                record["state"],
                record["size_gib"],
                record.get("availability_zone"),
                record.get("attached_vmid"),
                record.get("last_vmid"),
                record.get("device_name"),
                record.get("proxmox_volume"),
                record.get("unused_key"),
                record.get("source_snapshot_id"),
                record.get("principal"),
                record.get("name"),
                record["created_at"],
                record["updated_at"],
                json_payload(record),
            ),
        )


def list_volumes(identity=None, volume_ids=None):
    with db_connect() as connection:
        rows = connection.execute(
            "SELECT * FROM volumes ORDER BY created_at DESC"
        ).fetchall()
    records = [decode_payload(row) for row in rows]
    if volume_ids:
        wanted = {str(item) for item in volume_ids}
        records = [record for record in records if record["volume_id"] in wanted]
    return filter_records_for_identity(records, identity) if identity else records


def get_volume(volume_id, identity=None):
    with db_connect() as connection:
        row = connection.execute(
            "SELECT * FROM volumes WHERE volume_id = ?",
            (volume_id,),
        ).fetchone()
    if not row:
        return None
    record = decode_payload(row)
    if identity and not record_matches_identity(record, identity):
        return None
    return record


def update_volume(volume_id, **updates):
    record = get_volume(volume_id)
    if not record:
        raise KeyError(volume_id)
    record.update(updates)
    record["updated_at"] = now_iso()
    save_volume(record)
    return record


def delete_volume_record(volume_id):
    with db_connect() as connection:
        connection.execute("DELETE FROM volumes WHERE volume_id = ?", (volume_id,))


def create_volume_record(identity, body):
    size_gib = parse_positive_int(
        body.get("size_gib") or body.get("Size"),
        "size_gib",
    )
    snapshot_id = body.get("snapshot_id") or body.get("SnapshotId")
    if snapshot_id and not get_snapshot(snapshot_id, identity):
        raise ValueError("snapshot not found")

    assert_quota_available(identity, {"volume_gib": size_gib})
    now = now_iso()
    record = {
        "volume_id": generated_id("vol"),
        "state": "available",
        "size_gib": size_gib,
        "availability_zone": (
            body.get("availability_zone")
            or body.get("AvailabilityZone")
            or "us-calpoly-1a"
        ),
        "attached_vmid": None,
        "last_vmid": None,
        "device_name": None,
        "proxmox_volume": None,
        "unused_key": None,
        "source_snapshot_id": snapshot_id,
        "name": body.get("name") or body.get("Name"),
        "principal": identity.get("principal"),
        "owner": control_owner_payload(identity),
        "created_at": now,
        "updated_at": now,
    }
    save_volume(record)
    return record


def save_snapshot(record):
    with db_connect() as connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO snapshots (
                snapshot_id,
                volume_id,
                state,
                size_gib,
                principal,
                name,
                created_at,
                updated_at,
                payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["snapshot_id"],
                record["volume_id"],
                record["state"],
                record["size_gib"],
                record.get("principal"),
                record.get("name"),
                record["created_at"],
                record["updated_at"],
                json_payload(record),
            ),
        )


def list_snapshots(identity=None, snapshot_ids=None):
    with db_connect() as connection:
        rows = connection.execute(
            "SELECT * FROM snapshots ORDER BY created_at DESC"
        ).fetchall()
    records = [decode_payload(row) for row in rows]
    if snapshot_ids:
        wanted = {str(item) for item in snapshot_ids}
        records = [record for record in records if record["snapshot_id"] in wanted]
    return filter_records_for_identity(records, identity) if identity else records


def get_snapshot(snapshot_id, identity=None):
    with db_connect() as connection:
        row = connection.execute(
            "SELECT * FROM snapshots WHERE snapshot_id = ?",
            (snapshot_id,),
        ).fetchone()
    if not row:
        return None
    record = decode_payload(row)
    if identity and not record_matches_identity(record, identity):
        return None
    return record


def update_snapshot(snapshot_id, **updates):
    record = get_snapshot(snapshot_id)
    if not record:
        raise KeyError(snapshot_id)
    record.update(updates)
    record["updated_at"] = now_iso()
    save_snapshot(record)
    return record


def delete_snapshot_record(snapshot_id):
    with db_connect() as connection:
        connection.execute("DELETE FROM snapshots WHERE snapshot_id = ?", (snapshot_id,))


def create_snapshot_record(identity, body):
    volume_id = body.get("volume_id") or body.get("VolumeId")
    if not volume_id:
        raise ValueError("missing volume_id")
    volume = get_volume(volume_id, identity)
    if not volume:
        raise ValueError("volume not found")
    now = now_iso()
    record = {
        "snapshot_id": generated_id("snap"),
        "volume_id": volume_id,
        "state": "pending",
        "progress": "0%",
        "size_gib": int(volume.get("size_gib") or 0),
        "name": body.get("name") or body.get("Description"),
        "principal": identity.get("principal"),
        "owner": control_owner_payload(identity),
        "source": {
            "attached_vmid": volume.get("attached_vmid"),
            "last_vmid": volume.get("last_vmid"),
            "device_name": volume.get("device_name"),
            "proxmox_volume": volume.get("proxmox_volume"),
            "unused_key": volume.get("unused_key"),
        },
        "created_at": now,
        "updated_at": now,
    }
    save_snapshot(record)
    return record


def service_table(kind):
    if kind == "db":
        return "db_instances", "db_instance_id"
    if kind == "cache":
        return "cache_instances", "cache_instance_id"
    raise ValueError(f"unsupported service kind: {kind}")


def save_db_instance(record):
    with db_connect() as connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO db_instances (
                db_instance_id,
                engine,
                state,
                instance_class,
                allocated_storage_gib,
                vmid,
                endpoint_address,
                endpoint_port,
                principal,
                name,
                created_at,
                updated_at,
                payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["db_instance_id"],
                record["engine"],
                record["state"],
                record["instance_class"],
                record["allocated_storage_gib"],
                record.get("vmid"),
                record.get("endpoint_address"),
                record.get("endpoint_port"),
                record.get("principal"),
                record.get("name"),
                record["created_at"],
                record["updated_at"],
                json_payload(record),
            ),
        )


def save_cache_instance(record):
    with db_connect() as connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO cache_instances (
                cache_instance_id,
                engine,
                state,
                instance_class,
                allocated_storage_gib,
                vmid,
                endpoint_address,
                endpoint_port,
                principal,
                name,
                created_at,
                updated_at,
                payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["cache_instance_id"],
                record["engine"],
                record["state"],
                record["instance_class"],
                record["allocated_storage_gib"],
                record.get("vmid"),
                record.get("endpoint_address"),
                record.get("endpoint_port"),
                record.get("principal"),
                record.get("name"),
                record["created_at"],
                record["updated_at"],
                json_payload(record),
            ),
        )


def list_service_instances(kind, identity=None, ids=None):
    table, id_field = service_table(kind)
    with db_connect() as connection:
        rows = connection.execute(
            f"SELECT * FROM {table} ORDER BY created_at DESC"
        ).fetchall()
    records = [decode_payload(row) for row in rows]
    if ids:
        wanted = {str(item) for item in ids}
        records = [record for record in records if record[id_field] in wanted]
    return filter_records_for_identity(records, identity) if identity else records


def list_db_instances(identity=None, ids=None):
    return list_service_instances("db", identity, ids)


def list_cache_instances(identity=None, ids=None):
    return list_service_instances("cache", identity, ids)


def get_service_instance(kind, resource_id, identity=None):
    table, id_field = service_table(kind)
    with db_connect() as connection:
        row = connection.execute(
            f"SELECT * FROM {table} WHERE {id_field} = ?",
            (resource_id,),
        ).fetchone()
    if not row:
        return None
    record = decode_payload(row)
    if identity and not record_matches_identity(record, identity):
        return None
    return record


def save_service_instance(kind, record):
    if kind == "db":
        save_db_instance(record)
    else:
        save_cache_instance(record)


def update_service_instance(kind, resource_id, **updates):
    record = get_service_instance(kind, resource_id)
    if not record:
        raise KeyError(resource_id)
    record.update(updates)
    record["updated_at"] = now_iso()
    save_service_instance(kind, record)
    return record


def delete_service_instance_record(kind, resource_id):
    table, id_field = service_table(kind)
    with db_connect() as connection:
        connection.execute(f"DELETE FROM {table} WHERE {id_field} = ?", (resource_id,))


def normalize_security_group_ids(identity, raw_value):
    group_ids = raw_value or []
    if isinstance(group_ids, str):
        group_ids = [group_ids]
    normalized = []
    for group_id in group_ids:
        if not get_security_group(group_id, identity):
            raise ValueError(f"security group not found: {group_id}")
        normalized.append(group_id)
    return normalized


def create_db_instance_record(identity, body):
    engine_key = str(body.get("engine") or "postgres").strip().lower()
    engine = MANAGED_DB_ENGINES.get(engine_key)
    if not engine:
        raise ValueError("unsupported DB engine")
    instance_class = str(body.get("instance_class") or "db.t3.small")
    class_spec = MANAGED_DB_CLASSES.get(instance_class)
    if not class_spec:
        raise ValueError("unsupported DB instance_class")
    storage_gib = parse_positive_int(
        body.get("allocated_storage_gib") or body.get("storage_gib") or class_spec["storage_gib"],
        "allocated_storage_gib",
    )
    security_group_ids = normalize_security_group_ids(
        identity,
        body.get("security_group_ids"),
    )
    assert_quota_available(identity, {"db_instances": 1, "volume_gib": storage_gib})
    now = now_iso()
    resource_id = generated_id("db")
    name = body.get("name") or body.get("db_instance_identifier") or resource_id
    record = {
        "db_instance_id": resource_id,
        "name": name,
        "engine": "postgres",
        "engine_version": engine["version"],
        "state": "creating",
        "instance_class": instance_class,
        "proxmox_instance_type": class_spec["instance_type"],
        "allocated_storage_gib": storage_gib,
        "master_username": body.get("master_username") or engine["username"],
        "endpoint_address": None,
        "endpoint_port": engine["port"],
        "vmid": None,
        "security_group_ids": security_group_ids,
        "principal": identity.get("principal"),
        "owner": control_owner_payload(identity),
        "created_at": now,
        "updated_at": now,
    }
    save_db_instance(record)
    return record


def create_cache_instance_record(identity, body):
    engine_key = str(body.get("engine") or "redis").strip().lower()
    engine = MANAGED_CACHE_ENGINES.get(engine_key)
    if not engine:
        raise ValueError("unsupported cache engine")
    instance_class = str(body.get("instance_class") or "cache.t3.small")
    class_spec = MANAGED_CACHE_CLASSES.get(instance_class)
    if not class_spec:
        raise ValueError("unsupported cache instance_class")
    storage_gib = parse_positive_int(
        body.get("allocated_storage_gib") or body.get("storage_gib") or class_spec["storage_gib"],
        "allocated_storage_gib",
    )
    security_group_ids = normalize_security_group_ids(
        identity,
        body.get("security_group_ids"),
    )
    assert_quota_available(identity, {"cache_instances": 1, "volume_gib": storage_gib})
    now = now_iso()
    resource_id = generated_id("cache")
    name = body.get("name") or body.get("cache_instance_identifier") or resource_id
    record = {
        "cache_instance_id": resource_id,
        "name": name,
        "engine": "redis",
        "engine_version": engine["version"],
        "state": "creating",
        "instance_class": instance_class,
        "proxmox_instance_type": class_spec["instance_type"],
        "allocated_storage_gib": storage_gib,
        "username": engine["username"],
        "endpoint_address": None,
        "endpoint_port": engine["port"],
        "vmid": None,
        "security_group_ids": security_group_ids,
        "principal": identity.get("principal"),
        "owner": control_owner_payload(identity),
        "created_at": now,
        "updated_at": now,
    }
    save_cache_instance(record)
    return record


def save_vpc(record):
    with db_connect() as connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO vpcs (
                vpc_id,
                cidr_block,
                state,
                principal,
                name,
                created_at,
                updated_at,
                payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["vpc_id"],
                record["cidr_block"],
                record["state"],
                record.get("principal"),
                record.get("name"),
                record["created_at"],
                record["updated_at"],
                json_payload(record),
            ),
        )


def list_vpcs(identity=None, vpc_ids=None):
    with db_connect() as connection:
        rows = connection.execute(
            "SELECT * FROM vpcs ORDER BY created_at DESC"
        ).fetchall()
    records = [decode_payload(row) for row in rows]
    if vpc_ids:
        wanted = {str(item) for item in vpc_ids}
        records = [record for record in records if record["vpc_id"] in wanted]
    return filter_records_for_identity(records, identity) if identity else records


def get_vpc(vpc_id, identity=None):
    with db_connect() as connection:
        row = connection.execute(
            "SELECT * FROM vpcs WHERE vpc_id = ?",
            (vpc_id,),
        ).fetchone()
    if not row:
        return None
    record = decode_payload(row)
    if identity and not record_matches_identity(record, identity):
        return None
    return record


def create_vpc_record(identity, body):
    cidr_block = validate_cidr(body.get("cidr_block") or body.get("CidrBlock"), "cidr_block")
    now = now_iso()
    record = {
        "vpc_id": generated_id("vpc"),
        "cidr_block": cidr_block,
        "state": "available",
        "is_default": False,
        "name": body.get("name") or body.get("Name"),
        "principal": identity.get("principal"),
        "owner": control_owner_payload(identity),
        "created_at": now,
        "updated_at": now,
    }
    save_vpc(record)
    return record


def delete_vpc_record(vpc_id):
    with db_connect() as connection:
        subnet_count = connection.execute(
            "SELECT COUNT(*) AS count FROM subnets WHERE vpc_id = ?",
            (vpc_id,),
        ).fetchone()["count"]
        sg_count = connection.execute(
            "SELECT COUNT(*) AS count FROM security_groups WHERE vpc_id = ?",
            (vpc_id,),
        ).fetchone()["count"]
        if subnet_count or sg_count:
            raise RuntimeError("vpc has dependent subnets or security groups")
        connection.execute("DELETE FROM vpcs WHERE vpc_id = ?", (vpc_id,))


def save_subnet(record):
    with db_connect() as connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO subnets (
                subnet_id,
                vpc_id,
                cidr_block,
                availability_zone,
                state,
                principal,
                name,
                created_at,
                updated_at,
                payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["subnet_id"],
                record["vpc_id"],
                record["cidr_block"],
                record.get("availability_zone"),
                record["state"],
                record.get("principal"),
                record.get("name"),
                record["created_at"],
                record["updated_at"],
                json_payload(record),
            ),
        )


def list_subnets(identity=None, subnet_ids=None, vpc_id=None):
    with db_connect() as connection:
        rows = connection.execute(
            "SELECT * FROM subnets ORDER BY created_at DESC"
        ).fetchall()
    records = [decode_payload(row) for row in rows]
    if subnet_ids:
        wanted = {str(item) for item in subnet_ids}
        records = [record for record in records if record["subnet_id"] in wanted]
    if vpc_id:
        records = [record for record in records if record["vpc_id"] == vpc_id]
    return filter_records_for_identity(records, identity) if identity else records


def get_subnet(subnet_id, identity=None):
    with db_connect() as connection:
        row = connection.execute(
            "SELECT * FROM subnets WHERE subnet_id = ?",
            (subnet_id,),
        ).fetchone()
    if not row:
        return None
    record = decode_payload(row)
    if identity and not record_matches_identity(record, identity):
        return None
    return record


def create_subnet_record(identity, body):
    vpc_id = body.get("vpc_id") or body.get("VpcId")
    if not vpc_id:
        raise ValueError("missing vpc_id")
    vpc = get_vpc(vpc_id, identity)
    if not vpc:
        raise ValueError("vpc not found")

    cidr_block = validate_cidr(body.get("cidr_block") or body.get("CidrBlock"), "cidr_block")
    vpc_network = ipaddress.ip_network(vpc["cidr_block"], strict=False)
    subnet_network = ipaddress.ip_network(cidr_block, strict=False)
    if not subnet_network.subnet_of(vpc_network):
        raise ValueError("subnet cidr_block must be inside vpc cidr_block")

    now = now_iso()
    record = {
        "subnet_id": generated_id("subnet"),
        "vpc_id": vpc_id,
        "cidr_block": cidr_block,
        "availability_zone": (
            body.get("availability_zone")
            or body.get("AvailabilityZone")
            or "us-calpoly-1a"
        ),
        "state": "available",
        "name": body.get("name") or body.get("Name"),
        "principal": identity.get("principal"),
        "owner": control_owner_payload(identity),
        "created_at": now,
        "updated_at": now,
    }
    save_subnet(record)
    return record


def delete_subnet_record(subnet_id):
    with db_connect() as connection:
        connection.execute("DELETE FROM subnets WHERE subnet_id = ?", (subnet_id,))


def save_security_group(record):
    with db_connect() as connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO security_groups (
                group_id,
                vpc_id,
                name,
                description,
                principal,
                created_at,
                updated_at,
                payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["group_id"],
                record["vpc_id"],
                record["name"],
                record.get("description"),
                record.get("principal"),
                record["created_at"],
                record["updated_at"],
                json_payload(record),
            ),
        )


def list_security_group_rules(group_id):
    with db_connect() as connection:
        rows = connection.execute(
            """
            SELECT * FROM security_group_rules
            WHERE group_id = ?
            ORDER BY created_at ASC
            """,
            (group_id,),
        ).fetchall()
    return [decode_payload(row) for row in rows]


def attach_security_group_rules(record):
    enriched = dict(record)
    rules = list_security_group_rules(record["group_id"])
    enriched["ingress_rules"] = [
        rule for rule in rules
        if rule.get("direction") == "ingress"
    ]
    enriched["egress_rules"] = [
        rule for rule in rules
        if rule.get("direction") == "egress"
    ]
    return enriched


def list_security_groups(identity=None, group_ids=None, vpc_id=None):
    with db_connect() as connection:
        rows = connection.execute(
            "SELECT * FROM security_groups ORDER BY created_at DESC"
        ).fetchall()
    records = [attach_security_group_rules(decode_payload(row)) for row in rows]
    if group_ids:
        wanted = {str(item) for item in group_ids}
        records = [record for record in records if record["group_id"] in wanted]
    if vpc_id:
        records = [record for record in records if record["vpc_id"] == vpc_id]
    return filter_records_for_identity(records, identity) if identity else records


def get_security_group(group_id, identity=None):
    with db_connect() as connection:
        row = connection.execute(
            "SELECT * FROM security_groups WHERE group_id = ?",
            (group_id,),
        ).fetchone()
    if not row:
        return None
    record = attach_security_group_rules(decode_payload(row))
    if identity and not record_matches_identity(record, identity):
        return None
    return record


def create_security_group_record(identity, body):
    vpc_id = body.get("vpc_id") or body.get("VpcId")
    if not vpc_id:
        raise ValueError("missing vpc_id")
    if not get_vpc(vpc_id, identity):
        raise ValueError("vpc not found")

    name = (body.get("name") or body.get("GroupName") or "").strip()
    if not name:
        raise ValueError("missing name")

    now = now_iso()
    record = {
        "group_id": generated_id("sg"),
        "vpc_id": vpc_id,
        "name": name,
        "description": (
            body.get("description")
            or body.get("GroupDescription")
            or "Managed by CalPolySOC Cloud"
        ),
        "principal": identity.get("principal"),
        "owner": control_owner_payload(identity),
        "created_at": now,
        "updated_at": now,
    }
    save_security_group(record)
    return attach_security_group_rules(record)


def delete_security_group_record(group_id):
    with db_connect() as connection:
        connection.execute(
            "DELETE FROM security_group_rules WHERE group_id = ?",
            (group_id,),
        )
        connection.execute(
            "DELETE FROM security_groups WHERE group_id = ?",
            (group_id,),
        )


def save_security_group_rule(record):
    with db_connect() as connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO security_group_rules (
                rule_id,
                group_id,
                direction,
                ip_protocol,
                from_port,
                to_port,
                cidr_ip,
                source_group_id,
                description,
                created_at,
                payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["rule_id"],
                record["group_id"],
                record["direction"],
                record["ip_protocol"],
                record.get("from_port"),
                record.get("to_port"),
                record.get("cidr_ip"),
                record.get("source_group_id"),
                record.get("description"),
                record["created_at"],
                json_payload(record),
            ),
        )


def create_security_group_rule(identity, group_id, body, direction="ingress"):
    if not get_security_group(group_id, identity):
        raise ValueError("security group not found")

    cidr_ip = body.get("cidr_ip") or body.get("CidrIp")
    if cidr_ip:
        cidr_ip = validate_cidr(cidr_ip, "cidr_ip")

    source_group_id = body.get("source_group_id") or body.get("SourceSecurityGroupId")
    if not cidr_ip and not source_group_id:
        raise ValueError("missing cidr_ip or source_group_id")

    ip_protocol = str(body.get("ip_protocol") or body.get("IpProtocol") or "tcp")
    from_port = body.get("from_port", body.get("FromPort"))
    to_port = body.get("to_port", body.get("ToPort", from_port))
    from_port = int(from_port) if from_port not in (None, "") else None
    to_port = int(to_port) if to_port not in (None, "") else None

    record = {
        "rule_id": generated_id("sgr"),
        "group_id": group_id,
        "direction": direction,
        "ip_protocol": ip_protocol,
        "from_port": from_port,
        "to_port": to_port,
        "cidr_ip": cidr_ip,
        "source_group_id": source_group_id,
        "description": body.get("description") or body.get("Description"),
        "created_at": now_iso(),
    }
    save_security_group_rule(record)
    try:
        sync_security_group_to_all_vms(group_id)
    except Exception as exc:
        log_error(f"[sg-sync-warning] group_id={group_id} stage=add_rule error={exc}")
    return record


def delete_security_group_rule(identity, group_id, rule_id):
    if not get_security_group(group_id, identity):
        raise ValueError("security group not found")
    with db_connect() as connection:
        connection.execute(
            """
            DELETE FROM security_group_rules
            WHERE group_id = ? AND rule_id = ?
            """,
            (group_id, rule_id),
        )
    try:
        sync_security_group_to_all_vms(group_id)
    except Exception as exc:
        log_error(f"[sg-sync-warning] group_id={group_id} stage=remove_rule error={exc}")


# ---------------------------------------------------------------------------
#  Proxmox Firewall Sync — Security Group Enforcement
# ---------------------------------------------------------------------------


def list_instance_security_groups(vmid):
    """Return all security group IDs associated with a VM."""
    with db_connect() as connection:
        rows = connection.execute(
            "SELECT group_id FROM instance_security_groups WHERE vmid = ? ORDER BY created_at",
            (int(vmid),),
        ).fetchall()
    return [row["group_id"] for row in rows]


def associate_instance_security_groups(vmid, group_ids):
    """Set the security groups for a VM (replaces existing associations)."""
    vmid = int(vmid)
    now = now_iso()
    with db_connect() as connection:
        connection.execute(
            "DELETE FROM instance_security_groups WHERE vmid = ?", (vmid,)
        )
        for group_id in group_ids:
            connection.execute(
                """
                INSERT OR IGNORE INTO instance_security_groups (vmid, group_id, created_at)
                VALUES (?, ?, ?)
                """,
                (vmid, group_id, now),
            )


def list_vms_for_security_group(group_id):
    """Return all VMIDs that have a given security group attached."""
    with db_connect() as connection:
        rows = connection.execute(
            "SELECT vmid FROM instance_security_groups WHERE group_id = ?",
            (group_id,),
        ).fetchall()
    return [row["vmid"] for row in rows]


def proxmox_firewall_request(config, vmid, path, method="GET", data=None, timeout=30):
    """Make a request to the Proxmox per-VM firewall API."""
    node = config.get("PROXMOX_NODE")
    if not node:
        raise RuntimeError("missing PROXMOX_NODE")
    node_path = urllib.parse.quote(str(node), safe="")
    full_path = f"/api2/json/nodes/{node_path}/qemu/{int(vmid)}/firewall{path}"
    return proxmox_request(config, full_path, method=method, data=data, timeout=timeout)


def enable_vm_firewall(vmid):
    """Enable the Proxmox firewall on a VM with default-deny ingress."""
    config = load_proxmox_config()
    proxmox_firewall_request(
        config,
        vmid,
        "/options",
        method="PUT",
        data={
            "enable": "1",
            "policy_in": "DROP",
            "policy_out": "ACCEPT",
            "dhcp": "1",
            "macfilter": "0",
        },
    )
    log_info(f"[firewall] vmid={vmid} enabled policy_in=DROP policy_out=ACCEPT")


def clear_vm_firewall_rules(vmid):
    """Remove all existing Proxmox firewall rules from a VM."""
    config = load_proxmox_config()
    result = proxmox_firewall_request(config, vmid, "/rules")
    rules = result.get("data", [])
    # Delete in reverse order (highest position first) to avoid index shifting
    for rule in sorted(rules, key=lambda r: int(r.get("pos", 0)), reverse=True):
        pos = rule.get("pos")
        if pos is not None:
            proxmox_firewall_request(
                config, vmid, f"/rules/{int(pos)}", method="DELETE"
            )
    log_info(f"[firewall] vmid={vmid} cleared {len(rules)} existing rules")


def sg_rule_to_proxmox_rule(sg_rule):
    """Convert a CalPolySOC SG rule dict to Proxmox firewall rule params."""
    direction = sg_rule.get("direction", "ingress")
    rule_type = "in" if direction == "ingress" else "out"

    ip_protocol = str(sg_rule.get("ip_protocol", "tcp")).lower()
    from_port = sg_rule.get("from_port")
    to_port = sg_rule.get("to_port")
    cidr_ip = sg_rule.get("cidr_ip")

    pve_rule = {
        "type": rule_type,
        "action": "ACCEPT",
        "enable": "1",
    }

    # Protocol mapping
    if ip_protocol == "-1" or ip_protocol == "all":
        # Allow all protocols — omit proto to match everything
        pass
    elif ip_protocol == "icmp":
        pve_rule["proto"] = "icmp"
    else:
        pve_rule["proto"] = ip_protocol

    # Port mapping
    if from_port is not None and to_port is not None:
        from_port = int(from_port)
        to_port = int(to_port)
        if from_port == to_port:
            pve_rule["dport"] = str(from_port)
        else:
            pve_rule["dport"] = f"{from_port}:{to_port}"

    # Source/dest CIDR
    if cidr_ip:
        if rule_type == "in":
            pve_rule["source"] = cidr_ip
        else:
            pve_rule["dest"] = cidr_ip

    # Comment for traceability
    rule_id = sg_rule.get("rule_id", "")
    group_id = sg_rule.get("group_id", "")
    description = sg_rule.get("description", "")
    comment_parts = [f"sg={group_id}", f"rule={rule_id}"]
    if description:
        comment_parts.append(description)
    pve_rule["comment"] = " ".join(comment_parts)

    return pve_rule


def push_vm_firewall_rules(vmid, sg_rules):
    """Push a list of SG rules to the Proxmox firewall for a VM."""
    config = load_proxmox_config()
    for sg_rule in sg_rules:
        pve_rule = sg_rule_to_proxmox_rule(sg_rule)
        proxmox_firewall_request(
            config, vmid, "/rules", method="POST", data=pve_rule
        )
    log_info(f"[firewall] vmid={vmid} pushed {len(sg_rules)} rules")


def sync_security_groups_to_vm(vmid):
    """Full sync: read all SGs for a VM, rebuild Proxmox firewall rules."""
    group_ids = list_instance_security_groups(vmid)
    if not group_ids:
        return

    # Collect all rules from all attached security groups
    all_rules = []
    for group_id in group_ids:
        rules = list_security_group_rules(group_id)
        all_rules.extend(rules)

    try:
        enable_vm_firewall(vmid)
        clear_vm_firewall_rules(vmid)
        if all_rules:
            push_vm_firewall_rules(vmid, all_rules)
        log_info(
            f"[firewall] vmid={vmid} synced {len(all_rules)} rules "
            f"from {len(group_ids)} security groups"
        )
    except Exception as exc:
        log_error(f"[firewall-error] vmid={vmid} sync failed: {exc}")
        raise


def sync_security_group_to_all_vms(group_id):
    """When a SG is modified, re-sync firewall on every VM using it."""
    vmids = list_vms_for_security_group(group_id)
    for vmid in vmids:
        try:
            sync_security_groups_to_vm(vmid)
        except Exception as exc:
            log_error(
                f"[firewall-error] vmid={vmid} group_id={group_id} "
                f"sync failed: {exc}"
            )


def create_access_key_record(identity, body):
    now = now_iso()
    access_key_id = "CPCS" + secrets.token_hex(10).upper()
    secret_access_key = secrets.token_urlsafe(30)
    record = {
        "access_key_id": access_key_id,
        "status": "active",
        "name": body.get("name") or body.get("Name") or "default",
        "principal": identity.get("principal"),
        "owner": control_owner_payload(identity),
        "created_at": now,
        "updated_at": now,
        "last_used_at": None,
    }
    with db_connect() as connection:
        connection.execute(
            """
            INSERT INTO access_keys (
                access_key_id,
                secret_access_key,
                status,
                principal,
                name,
                created_at,
                updated_at,
                last_used_at,
                payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                access_key_id,
                secret_access_key,
                record["status"],
                record["principal"],
                record["name"],
                record["created_at"],
                record["updated_at"],
                record["last_used_at"],
                json_payload(record),
            ),
        )

    response = dict(record)
    response["secret_access_key"] = secret_access_key
    return response


def access_key_from_row(row, include_secret=False):
    record = decode_payload(row)
    record["status"] = row["status"]
    record["last_used_at"] = row["last_used_at"]
    if include_secret:
        record["secret_access_key"] = row["secret_access_key"]
    return record


def list_access_keys(identity):
    with db_connect() as connection:
        rows = connection.execute(
            """
            SELECT * FROM access_keys
            ORDER BY created_at DESC
            """
        ).fetchall()
    records = [access_key_from_row(row) for row in rows]
    return filter_records_for_identity(records, identity)


def get_access_key(access_key_id, identity=None, include_secret=False):
    with db_connect() as connection:
        row = connection.execute(
            "SELECT * FROM access_keys WHERE access_key_id = ?",
            (access_key_id,),
        ).fetchone()
    if not row:
        return None
    record = access_key_from_row(row, include_secret=include_secret)
    if identity and not record_matches_identity(record, identity):
        return None
    return record


def delete_access_key_record(access_key_id, identity):
    record = get_access_key(access_key_id, identity)
    if not record:
        return False
    with db_connect() as connection:
        connection.execute(
            "DELETE FROM access_keys WHERE access_key_id = ?",
            (access_key_id,),
        )
    return True


def mark_access_key_used(access_key_id):
    now = now_iso()
    with db_connect() as connection:
        row = connection.execute(
            "SELECT * FROM access_keys WHERE access_key_id = ?",
            (access_key_id,),
        ).fetchone()
        if not row:
            return

        record = access_key_from_row(row)
        record["last_used_at"] = now
        record["updated_at"] = now
        connection.execute(
            """
            UPDATE access_keys
            SET last_used_at = ?, updated_at = ?, payload = ?
            WHERE access_key_id = ?
            """,
            (now, now, json_payload(record), access_key_id),
        )


def access_key_identity(record):
    owner = record.get("owner") or {}
    principal = record.get("principal") or owner.get("principal")
    if not principal:
        principal = record.get("access_key_id")

    config = load_proxmox_config()
    acl_group = config.get("PROXMOX_ACL_GROUP", "").strip()
    acl_subject = {
        "type": "group" if acl_group else "user",
        "id": acl_group or map_console_principal(principal, config),
    }

    return {
        "principal": principal,
        "email": owner.get("email") or principal,
        "id": owner.get("id"),
        "name": owner.get("name") or record.get("name"),
        "roles": owner.get("roles") or [],
        "auth_source": "access-key",
        "access_key_id": record.get("access_key_id"),
        "acl_subject": acl_subject,
    }


def decode_public_key_material(value):
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("missing public key material")

    if raw.startswith(("ssh-rsa ", "ssh-ed25519 ", "ecdsa-sha2-")):
        return raw

    compact = re.sub(r"\s+", "", raw)
    try:
        decoded = base64.b64decode(compact, validate=True).decode("utf-8").strip()
    except Exception as exc:
        raise ValueError("invalid public key material") from exc

    if decoded.startswith(("ssh-rsa ", "ssh-ed25519 ", "ecdsa-sha2-")):
        return decoded

    raise ValueError("unsupported public key material")


def public_key_fingerprint(public_key):
    parts = public_key.strip().split()
    if len(parts) < 2:
        raise ValueError("invalid public key")

    key_type, key_body = parts[0], parts[1]
    if key_type not in {"ssh-rsa", "ssh-ed25519"} and not key_type.startswith(
        "ecdsa-sha2-"
    ):
        raise ValueError(f"unsupported public key type: {key_type}")

    try:
        key_bytes = base64.b64decode(key_body.encode("ascii"), validate=True)
    except Exception as exc:
        raise ValueError("invalid public key body") from exc

    digest = base64.b64encode(hashlib.sha256(key_bytes).digest()).rstrip(b"=")
    return "SHA256:" + digest.decode("ascii")


def generate_ssh_key_pair(key_name):
    with tempfile.TemporaryDirectory() as directory:
        key_path = os.path.join(directory, "key")
        result = subprocess.run(
            [
                "ssh-keygen",
                "-t",
                "ed25519",
                "-N",
                "",
                "-C",
                key_name,
                "-f",
                key_path,
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(command_failure_message({
                "stdout": result.stdout,
                "stderr": result.stderr,
            }, "ssh-keygen failed"))

        with open(key_path, "r", encoding="utf-8") as handle:
            private_key = handle.read()
        with open(key_path + ".pub", "r", encoding="utf-8") as handle:
            public_key = handle.read().strip()

    return private_key, public_key


def key_pair_from_row(row):
    record = decode_payload(row)
    record["fingerprint"] = row["fingerprint"]
    record["public_key"] = row["public_key"]
    return record


def list_key_pairs(identity=None, key_names=None):
    with db_connect() as connection:
        rows = connection.execute(
            "SELECT * FROM key_pairs ORDER BY created_at DESC"
        ).fetchall()
    records = [key_pair_from_row(row) for row in rows]
    if key_names:
        wanted = {str(item) for item in key_names}
        records = [record for record in records if record["key_name"] in wanted]
    return filter_records_for_identity(records, identity) if identity else records


def get_key_pair(key_name, identity=None):
    matches = list_key_pairs(identity, [key_name])
    return matches[0] if matches else None


def create_key_pair_record(identity, key_name, public_key):
    key_name = str(key_name or "").strip()
    if not key_name:
        raise ValueError("missing key_name")
    if get_key_pair(key_name, identity):
        raise ValueError("key pair already exists")

    normalized_public_key = decode_public_key_material(public_key)
    fingerprint = public_key_fingerprint(normalized_public_key)
    now = now_iso()
    record = {
        "key_pair_id": generated_id("key"),
        "key_name": key_name,
        "fingerprint": fingerprint,
        "public_key": normalized_public_key,
        "principal": identity.get("principal"),
        "owner": control_owner_payload(identity),
        "created_at": now,
    }

    with db_connect() as connection:
        connection.execute(
            """
            INSERT INTO key_pairs (
                key_pair_id,
                key_name,
                fingerprint,
                public_key,
                principal,
                created_at,
                payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["key_pair_id"],
                record["key_name"],
                record["fingerprint"],
                record["public_key"],
                record["principal"],
                record["created_at"],
                json_payload(record),
            ),
        )

    return record


def delete_key_pair_record(identity, key_name):
    record = get_key_pair(key_name, identity)
    if not record:
        return False

    with db_connect() as connection:
        connection.execute(
            "DELETE FROM key_pairs WHERE key_pair_id = ?",
            (record["key_pair_id"],),
        )
    return True


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
        "key_name": body.get("key_name") or body.get("KeyName"),
        "created_at": now_iso(),
    }


def job_snapshot(job_id):
    with JOBS_LOCK:
        with db_connect() as connection:
            row = connection.execute(
                "SELECT * FROM jobs WHERE job_id = ?",
                (job_id,),
            ).fetchone()
        job = job_from_row(row)
        return copy.deepcopy(job) if job else None


def update_job(job_id, **updates):
    with JOBS_LOCK:
        with db_connect() as connection:
            row = connection.execute(
                "SELECT * FROM jobs WHERE job_id = ?",
                (job_id,),
            ).fetchone()
        job = job_from_row(row)
        if not job:
            raise KeyError(job_id)

        job.update(updates)
        job["updated_at"] = now_iso()
        save_job(job)
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
        save_job(job)

    return copy.deepcopy(job)


def fail_job(job_id, message, **extra):
    log_error(f"[launch-error] job_id={job_id} error={message}")
    job = update_job(
        job_id,
        ok=False,
        state="failed",
        message=message,
        error=message,
        **extra,
    )
    record_audit_event(
        "ec2.launch.failed",
        identity={
            "principal": job.get("principal"),
            "email": job.get("principal"),
        },
        resource_type="ec2.job",
        resource_id=job_id,
        result="failure",
        message=message,
        details={"stage": extra.get("stage")},
    )
    return job


def create_resource_job(identity, action, resource_type, resource_id, message):
    job_id = uuid.uuid4().hex
    now = now_iso()
    job = {
        "ok": True,
        "job_id": job_id,
        "state": "pending",
        "message": message,
        "action": action,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "principal": identity.get("principal") if identity else None,
        "created_at": now,
        "updated_at": now,
    }
    with JOBS_LOCK:
        save_job(job)
    return copy.deepcopy(job)


def fail_resource_job(job_id, message, **extra):
    log_error(f"[resource-job-error] job_id={job_id} error={message}")
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
    password = body.get("password")
    username = body.get("username") or body.get("user")
    image_id = body.get("image_id")
    template_name = body.get("template_name")
    template_vmid = body.get("template_vmid")
    key_name = body.get("key_name") or body.get("KeyName")
    ssh_public_key = body.get("ssh_public_key")
    security_group_ids = (
        body.get("security_group_ids")
        or body.get("SecurityGroupId")
        or []
    )
    if isinstance(security_group_ids, str):
        security_group_ids = [security_group_ids]
    if image_id and not template_vmid:
        template_vmid = IMAGE_TEMPLATE_VMIDS.get(str(image_id))

    if key_name and not ssh_public_key:
        key_pair = get_key_pair(key_name, identity)
        if not key_pair:
            fail_job(job_id, f"key pair not found: {key_name}", stage="key_pair")
            return
        ssh_public_key = key_pair["public_key"]

    if password is None and not ssh_public_key:
        password = "ChangeMe123!"

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
    ]
    cmd_env = None
    if password:
        password_env_name = "CALPOLY_CLOUD_INSTANCE_PASSWORD"
        cmd += ["--password-env", password_env_name]
        cmd_env = {password_env_name: password}

    if image_id:
        cmd += ["--ami", str(image_id)]
    if template_vmid:
        cmd += ["--template-vmid", str(template_vmid)]
    if template_name:
        cmd += ["--template-name", str(template_name)]
    if username:
        cmd += ["--user", username]
    if ssh_public_key:
        cmd += ["--ssh-key", ssh_public_key]

    launch_result = run_cmd(cmd, extra_env=cmd_env)
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

    # --- Security Group Firewall Enforcement ---
    firewall_result = {"ok": True}
    if security_group_ids:
        try:
            # Validate all SG IDs exist
            valid_group_ids = []
            for sg_id in security_group_ids:
                sg = get_security_group(sg_id)
                if sg:
                    valid_group_ids.append(sg_id)
                else:
                    warnings.append(f"security group not found: {sg_id}")

            if valid_group_ids:
                associate_instance_security_groups(vmid, valid_group_ids)
                sync_security_groups_to_vm(vmid)
                log_info(
                    f"[launch-firewall] job_id={job_id} vmid={vmid} "
                    f"security_groups={valid_group_ids}"
                )
        except Exception as exc:
            message = f"security group firewall sync failed: {exc}"
            warnings.append(message)
            firewall_result = {"ok": False, "error": str(exc)}
            log_error(
                f"[launch-warning] job_id={job_id} vmid={vmid} "
                f"stage=firewall_sync error={exc}"
            )

    final_state = "warning" if warnings else "succeeded"
    final_job = update_job(
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
        firewall=firewall_result,
        security_group_ids=security_group_ids,
        warnings=warnings,
    )
    record_audit_event(
        "ec2.launch.completed",
        identity=identity,
        resource_type="ec2.instance",
        resource_id=instance_id,
        result="warning" if warnings else "success",
        message=final_job.get("message"),
        details={
            "job_id": job_id,
            "vmid": vmid,
            "security_group_ids": security_group_ids,
            "warnings": warnings,
        },
    )


def parse_cloudctl_json(result, fallback):
    try:
        return json.loads(result.get("stdout") or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{fallback}: invalid JSON from cloudctl: {exc}") from exc


def attach_volume_job(job_id, identity, volume_id, vmid, device_name=None):
    volume = get_volume(volume_id)
    if not volume:
        fail_resource_job(job_id, "volume not found")
        return

    update_job(job_id, state="running", message="attaching volume")
    update_volume(volume_id, state="attaching", attached_vmid=int(vmid), last_vmid=int(vmid))
    cmd = [
        CLOUDCTL,
        "attach-volume",
        "--vmid",
        str(vmid),
        "--volume-id",
        volume_id,
        "--size-gib",
        str(volume["size_gib"]),
    ]
    if device_name:
        cmd += ["--device", str(device_name)]
    if volume.get("proxmox_volume"):
        cmd += ["--backing", volume["proxmox_volume"]]
    if volume.get("unused_key"):
        cmd += ["--unused-key", volume["unused_key"]]

    result = run_cmd(cmd)
    if not result["ok"]:
        update_volume(volume_id, state="available", attached_vmid=None, device_name=None)
        fail_resource_job(
            job_id,
            command_failure_message(result, "cloudctl attach-volume failed"),
            cloudctl=result,
        )
        return

    payload = parse_cloudctl_json(result, "attach-volume failed")
    updated = update_volume(
        volume_id,
        state="in-use",
        attached_vmid=int(vmid),
        last_vmid=int(vmid),
        device_name=payload.get("device") or device_name,
        proxmox_volume=payload.get("backing") or volume.get("proxmox_volume"),
        unused_key=None,
    )
    update_job(
        job_id,
        ok=True,
        state="succeeded",
        message="volume attached",
        volume=updated,
        cloudctl=payload,
    )
    record_audit_event(
        "ec2.volume.attach.completed",
        identity=identity,
        resource_type="ec2.volume",
        resource_id=volume_id,
        details={"vmid": vmid, "device": updated.get("device_name")},
    )


def detach_volume_job(job_id, identity, volume_id):
    volume = get_volume(volume_id)
    if not volume:
        fail_resource_job(job_id, "volume not found")
        return

    vmid = volume.get("attached_vmid")
    if not vmid:
        fail_resource_job(job_id, "volume is not attached")
        return

    update_job(job_id, state="running", message="detaching volume")
    update_volume(volume_id, state="detaching")
    cmd = [
        CLOUDCTL,
        "detach-volume",
        "--vmid",
        str(vmid),
    ]
    if volume.get("device_name"):
        cmd += ["--device", volume["device_name"]]
    if volume.get("proxmox_volume"):
        cmd += ["--backing", volume["proxmox_volume"]]

    result = run_cmd(cmd)
    if not result["ok"]:
        update_volume(volume_id, state="in-use")
        fail_resource_job(
            job_id,
            command_failure_message(result, "cloudctl detach-volume failed"),
            cloudctl=result,
        )
        return

    payload = parse_cloudctl_json(result, "detach-volume failed")
    updated = update_volume(
        volume_id,
        state="available",
        attached_vmid=None,
        last_vmid=int(vmid),
        device_name=None,
        proxmox_volume=payload.get("backing") or volume.get("proxmox_volume"),
        unused_key=payload.get("unused_key"),
    )
    update_job(
        job_id,
        ok=True,
        state="succeeded",
        message="volume detached",
        volume=updated,
        cloudctl=payload,
    )
    record_audit_event(
        "ec2.volume.detach.completed",
        identity=identity,
        resource_type="ec2.volume",
        resource_id=volume_id,
        details={"vmid": vmid},
    )


def create_snapshot_job(job_id, identity, snapshot_id):
    snapshot = get_snapshot(snapshot_id)
    if not snapshot:
        fail_resource_job(job_id, "snapshot not found")
        return
    volume = get_volume(snapshot["volume_id"])
    if not volume:
        update_snapshot(snapshot_id, state="error", progress="0%")
        fail_resource_job(job_id, "source volume not found")
        return

    update_job(job_id, state="running", message="creating snapshot")
    cmd = [
        CLOUDCTL,
        "create-volume-snapshot",
        "--snapshot-id",
        snapshot_id,
        "--volume-id",
        volume["volume_id"],
    ]
    if volume.get("attached_vmid"):
        cmd += ["--vmid", str(volume["attached_vmid"])]
    if volume.get("device_name"):
        cmd += ["--device", volume["device_name"]]
    if volume.get("proxmox_volume"):
        cmd += ["--backing", volume["proxmox_volume"]]

    result = run_cmd(cmd)
    if not result["ok"]:
        update_snapshot(snapshot_id, state="error", progress="0%")
        fail_resource_job(
            job_id,
            command_failure_message(result, "cloudctl create-volume-snapshot failed"),
            cloudctl=result,
        )
        return

    payload = parse_cloudctl_json(result, "create-volume-snapshot failed")
    updated = update_snapshot(
        snapshot_id,
        state="completed",
        progress="100%",
        provider_snapshot=payload,
    )
    update_job(
        job_id,
        ok=True,
        state="succeeded",
        message="snapshot created",
        snapshot=updated,
        cloudctl=payload,
    )
    record_audit_event(
        "ec2.snapshot.create.completed",
        identity=identity,
        resource_type="ec2.snapshot",
        resource_id=snapshot_id,
        details={"volume_id": snapshot.get("volume_id")},
    )


def provision_managed_service_job(job_id, identity, kind, resource_id, password):
    record = get_service_instance(kind, resource_id)
    if not record:
        fail_resource_job(job_id, "managed service not found")
        return

    update_job(job_id, state="running", message="provisioning VM")
    cmd_env = {"CALPOLY_CLOUD_SERVICE_PASSWORD": password}
    service_name = "postgres" if kind == "db" else "redis"
    cmd = [
        CLOUDCTL,
        "provision-service",
        "--service",
        service_name,
        "--name",
        record["name"],
        "--instance-type",
        record["proxmox_instance_type"],
        "--storage-gib",
        str(record["allocated_storage_gib"]),
        "--username",
        record.get("master_username") or record.get("username") or "default",
        "--password-env",
        "CALPOLY_CLOUD_SERVICE_PASSWORD",
        "--port",
        str(record["endpoint_port"]),
        "--json",
    ]

    result = run_cmd(cmd, extra_env=cmd_env)
    if not result["ok"]:
        update_service_instance(kind, resource_id, state="failed")
        fail_resource_job(
            job_id,
            command_failure_message(result, "cloudctl provision-service failed"),
            cloudctl=result,
        )
        return

    payload = parse_cloudctl_json(result, "provision-service failed")
    vmid = maybe_int(payload.get("vmid"))
    endpoint_address = payload.get("ip") or payload.get("endpoint_address")
    if not vmid:
        update_service_instance(kind, resource_id, state="failed")
        fail_resource_job(job_id, "cloudctl did not return a vmid", cloudctl=payload)
        return

    warnings = []
    owner = {
        **control_owner_payload(identity),
        "resource_type": f"{kind}-instance",
        "resource_id": resource_id,
        "instance_type": record["proxmox_instance_type"],
        "created_at": now_iso(),
    }
    try:
        set_vm_owner_metadata(vmid, owner)
    except Exception as exc:
        warnings.append(f"owner metadata assignment failed: {exc}")
        log_error(f"[service-warning] resource_id={resource_id} stage=owner error={exc}")

    try:
        assign_vm_acl(vmid, identity["acl_subject"])
    except Exception as exc:
        warnings.append(f"acl assignment failed: {exc}")
        log_error(f"[service-warning] resource_id={resource_id} stage=acl error={exc}")

    try:
        group_ids = record.get("security_group_ids") or []
        if group_ids:
            associate_instance_security_groups(vmid, group_ids)
            sync_security_groups_to_vm(vmid)
        else:
            enable_vm_firewall(vmid)
            clear_vm_firewall_rules(vmid)
    except Exception as exc:
        warnings.append(f"security group firewall sync failed: {exc}")
        log_error(f"[service-warning] resource_id={resource_id} stage=firewall error={exc}")

    updated = update_service_instance(
        kind,
        resource_id,
        state="available" if endpoint_address else "warning",
        vmid=vmid,
        endpoint_address=endpoint_address,
        endpoint={
            "address": endpoint_address,
            "port": record["endpoint_port"],
        },
        warnings=warnings,
        provision=payload,
    )
    update_job(
        job_id,
        ok=True,
        state="warning" if warnings else "succeeded",
        message="managed service provisioned with warnings" if warnings else "managed service provisioned",
        resource=updated,
        warnings=warnings,
    )
    record_audit_event(
        f"{kind}.create.completed",
        identity=identity,
        resource_type=f"{kind}.instance",
        resource_id=resource_id,
        result="warning" if warnings else "success",
        details={"vmid": vmid, "endpoint_address": endpoint_address},
    )


def delete_managed_service_job(job_id, identity, kind, resource_id):
    record = get_service_instance(kind, resource_id)
    if not record:
        fail_resource_job(job_id, "managed service not found")
        return
    update_service_instance(kind, resource_id, state="deleting")
    update_job(job_id, state="running", message="deleting managed service VM")
    vmid = record.get("vmid")
    if vmid:
        run_cmd([CLOUDCTL, "stop-instance", "--vmid", str(vmid)])
        result = run_cmd([CLOUDCTL, "terminate-instance", "--vmid", str(vmid)])
        if not result["ok"]:
            details = (result.get("stderr") or result.get("stdout") or "").lower()
            if "does not exist" not in details and "not found" not in details:
                update_service_instance(kind, resource_id, state="failed")
                fail_resource_job(
                    job_id,
                    command_failure_message(result, "cloudctl terminate-instance failed"),
                    cloudctl=result,
                )
                return
            log_info(
                f"[service-delete] resource_id={resource_id} vmid={vmid} already absent"
            )

    delete_service_instance_record(kind, resource_id)
    update_job(
        job_id,
        ok=True,
        state="succeeded",
        message="managed service deleted",
    )
    record_audit_event(
        f"{kind}.delete.completed",
        identity=identity,
        resource_type=f"{kind}.instance",
        resource_id=resource_id,
        result="success",
        details={"vmid": vmid},
    )


def set_managed_service_power(kind, resource_id, action):
    try:
        identity = resolve_console_identity(request.headers)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    record = get_service_instance(kind, resource_id, identity)
    if not record:
        return jsonify({"ok": False, "error": "managed service not found"}), 404
    vmid = record.get("vmid")
    if not vmid:
        return jsonify({"ok": False, "error": "managed service has no VM yet"}), 409
    command = "start-instance" if action == "start" else "stop-instance"
    result = run_cmd([CLOUDCTL, command, "--vmid", str(vmid)])
    if result["ok"]:
        update_service_instance(
            kind,
            resource_id,
            state="available" if action == "start" else "stopped",
        )
    record_audit_event(
        f"{kind}.{action}",
        identity=identity,
        resource_type=f"{kind}.instance",
        resource_id=resource_id,
        result="success" if result["ok"] else "failure",
        status=200 if result["ok"] else 500,
        message=None if result["ok"] else command_failure_message(result, f"{action} failed"),
    )
    return jsonify(result), 200 if result["ok"] else 500


def delete_managed_service_route(kind, resource_id):
    try:
        identity = resolve_console_identity(request.headers)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    record = get_service_instance(kind, resource_id, identity)
    if not record:
        return jsonify({"ok": False, "error": "managed service not found"}), 404

    job = create_resource_job(
        identity,
        f"{kind}.delete",
        f"{kind}.instance",
        resource_id,
        "managed service delete queued",
    )
    thread = threading.Thread(
        target=delete_managed_service_job,
        args=(job["job_id"], identity, kind, resource_id),
        daemon=True,
    )
    thread.start()
    record_audit_event(
        f"{kind}.delete.queued",
        identity=identity,
        resource_type=f"{kind}.instance",
        resource_id=resource_id,
        result="success",
        status=202,
    )
    return jsonify({"ok": True, "job": job}), 202


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


def attach_volume_records_to_instances(instances, identity):
    volumes = [
        volume for volume in list_volumes(identity)
        if volume.get("state") == "in-use" and volume.get("attached_vmid")
    ]
    by_vmid = {}
    for volume in volumes:
        by_vmid.setdefault(int(volume["attached_vmid"]), []).append(volume)

    enriched = []
    for instance in instances:
        item = dict(instance)
        vmid = maybe_int(item.get("vmid"))
        item["attached_volumes"] = by_vmid.get(vmid, []) if vmid else []
        item["security_group_ids"] = list_instance_security_groups(vmid) if vmid else []
        enriched.append(item)
    return enriched


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


def xml_text(value):
    if value is None:
        return ""
    return html.escape(str(value), quote=True)


def xml_response(action, body, status=200):
    request_id = uuid.uuid4()
    payload = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<{action}Response xmlns="{EC2_XMLNS}">'
        f"<requestId>{request_id}</requestId>"
        f"{body}"
        f"</{action}Response>"
    )
    return Response(payload, status=status, mimetype="text/xml")


def ec2_error_response(code, message, status=400):
    request_id = uuid.uuid4()
    payload = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        "<Errors>"
        "<Error>"
        f"<Code>{xml_text(code)}</Code>"
        f"<Message>{xml_text(message)}</Message>"
        "</Error>"
        "</Errors>"
        f"<RequestID>{request_id}</RequestID>"
        "</Response>"
    )
    return Response(payload, status=status, mimetype="text/xml")


def aws_percent_encode(value):
    return urllib.parse.quote(str(value), safe="-_.~")


def parse_authorization_params(value):
    if not value:
        return None

    parts = value.split(None, 1)
    if len(parts) != 2 or parts[0] != SIGV4_ALGORITHM:
        return None

    params = {}
    for item in re.split(r",\s*", parts[1]):
        if "=" not in item:
            continue
        key, raw_value = item.split("=", 1)
        params[key] = raw_value

    if not {"Credential", "SignedHeaders", "Signature"} <= set(params):
        return None

    return params


def sigv4_auth_material_present():
    authorization = request.headers.get("Authorization", "")
    if authorization.startswith(SIGV4_ALGORITHM):
        return True

    return request.args.get("X-Amz-Algorithm") == SIGV4_ALGORITHM


def parse_sigv4_auth():
    authorization = request.headers.get("Authorization", "")
    params = parse_authorization_params(authorization)
    if params:
        credential = params["Credential"]
        signed_headers = params["SignedHeaders"]
        signature = params["Signature"]
        amz_date = request.headers.get("X-Amz-Date") or request.args.get("X-Amz-Date")
        return {
            "credential": credential,
            "signed_headers": signed_headers,
            "signature": signature,
            "amz_date": amz_date,
            "presigned": False,
        }

    if request.args.get("X-Amz-Algorithm") != SIGV4_ALGORITHM:
        raise ValueError("unsupported signing algorithm")

    required = {
        "X-Amz-Credential",
        "X-Amz-Date",
        "X-Amz-SignedHeaders",
        "X-Amz-Signature",
    }
    missing = sorted(item for item in required if not request.args.get(item))
    if missing:
        raise ValueError(f"missing signature parameter: {', '.join(missing)}")

    return {
        "credential": request.args["X-Amz-Credential"],
        "signed_headers": request.args["X-Amz-SignedHeaders"],
        "signature": request.args["X-Amz-Signature"],
        "amz_date": request.args["X-Amz-Date"],
        "presigned": True,
    }


def parse_sigv4_credential(credential):
    parts = credential.split("/")
    if len(parts) != 5 or parts[4] != SIGV4_TERMINATOR:
        raise ValueError("invalid credential scope")

    access_key_id, date_stamp, region, service, terminator = parts
    if not access_key_id or not date_stamp or not region or not service:
        raise ValueError("invalid credential scope")

    return {
        "access_key_id": access_key_id,
        "date_stamp": date_stamp,
        "region": region,
        "service": service,
        "terminator": terminator,
        "scope": "/".join(parts[1:]),
    }


def parse_sigv4_datetime(value):
    if not value:
        raise ValueError("missing X-Amz-Date")

    try:
        return datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise ValueError("invalid X-Amz-Date") from exc


def validate_sigv4_timestamp(auth):
    timestamp = parse_sigv4_datetime(auth["amz_date"])
    now = datetime.now(timezone.utc)
    skew = sigv4_max_skew_seconds()
    age = (now - timestamp).total_seconds()
    if age < -skew:
        raise ValueError("request timestamp is too far in the future")

    if auth["presigned"]:
        try:
            expires = int(request.args.get("X-Amz-Expires", "900"))
        except ValueError as exc:
            raise ValueError("invalid X-Amz-Expires") from exc
        if expires < 1 or expires > 604800:
            raise ValueError("invalid X-Amz-Expires")
        if age > expires + skew:
            raise ValueError("presigned request has expired")
        return

    if age > skew:
        raise ValueError("request timestamp is too old")


def canonical_query_string(exclude_signature=False):
    parsed = urllib.parse.parse_qsl(
        request.query_string.decode("utf-8", errors="replace"),
        keep_blank_values=True,
    )
    encoded = []
    for key, value in parsed:
        if exclude_signature and key == "X-Amz-Signature":
            continue
        encoded.append((aws_percent_encode(key), aws_percent_encode(value)))
    encoded.sort()
    return "&".join(f"{key}={value}" for key, value in encoded)


def canonical_header_value(name):
    if name == "host":
        value = request.headers.get("Host") or request.host
    else:
        value = request.headers.get(name)
    if value is None:
        raise ValueError(f"missing signed header: {name}")
    return re.sub(r"\s+", " ", str(value).strip())


def canonical_headers_and_names(signed_headers):
    names = [item.strip().lower() for item in signed_headers.split(";") if item.strip()]
    if not names or names != sorted(names):
        raise ValueError("SignedHeaders must be sorted")

    headers = "".join(
        f"{name}:{canonical_header_value(name)}\n"
        for name in names
    )
    return headers, ";".join(names)


def sigv4_payload_hash():
    supplied = (
        request.headers.get("X-Amz-Content-Sha256")
        or request.args.get("X-Amz-Content-Sha256")
    )
    if supplied:
        return supplied
    return hashlib.sha256(request.get_data(cache=True) or b"").hexdigest()


def sigv4_canonical_request(auth):
    canonical_uri = urllib.parse.quote(request.path or "/", safe="/-_.~")
    canonical_headers, signed_headers = canonical_headers_and_names(
        auth["signed_headers"]
    )
    return "\n".join(
        [
            request.method.upper(),
            canonical_uri,
            canonical_query_string(exclude_signature=auth["presigned"]),
            canonical_headers,
            signed_headers,
            sigv4_payload_hash(),
        ]
    )


def sigv4_signing_key(secret_access_key, date_stamp, region, service):
    key = ("AWS4" + secret_access_key).encode("utf-8")
    for value in (date_stamp, region, service, SIGV4_TERMINATOR):
        key = hmac.new(key, value.encode("utf-8"), hashlib.sha256).digest()
    return key


def verify_sigv4_request():
    auth = parse_sigv4_auth()
    credential = parse_sigv4_credential(auth["credential"])
    validate_sigv4_timestamp(auth)

    record = get_access_key(
        credential["access_key_id"],
        include_secret=True,
    )
    if not record or record.get("status") != "active":
        raise PermissionError("invalid access key")

    canonical_request = sigv4_canonical_request(auth)
    string_to_sign = "\n".join(
        [
            SIGV4_ALGORITHM,
            auth["amz_date"],
            credential["scope"],
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signing_key = sigv4_signing_key(
        record["secret_access_key"],
        credential["date_stamp"],
        credential["region"],
        credential["service"],
    )
    expected_signature = hmac.new(
        signing_key,
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_signature, auth["signature"]):
        raise PermissionError("signature does not match")

    mark_access_key_used(record["access_key_id"])
    identity = access_key_identity(record)
    request.environ[REQUEST_IDENTITY_KEY] = identity
    return identity


def require_ec2_query_auth():
    if request_has_valid_internal_token():
        return None

    if not sigv4_auth_material_present():
        return ec2_error_response(
            "AuthFailure",
            "missing or invalid authentication",
            401,
        )

    try:
        verify_sigv4_request()
    except PermissionError as exc:
        return ec2_error_response("AuthFailure", str(exc), 403)
    except ValueError as exc:
        return ec2_error_response("AuthFailure", str(exc), 400)

    return None


def query_identity():
    identity = request.environ.get(REQUEST_IDENTITY_KEY)
    if identity:
        return identity

    identity = resolve_console_identity(request.headers, required=False)
    if identity:
        return identity

    return {
        "principal": "programmatic",
        "email": None,
        "id": None,
        "name": "Programmatic API",
        "roles": ["cloud-admin"],
        "auth_source": "ec2-query",
        "acl_subject": {"type": "user", "id": "programmatic"},
    }


def indexed_values(prefix):
    values = []
    index = 1
    while True:
        value = request.values.get(f"{prefix}.{index}")
        if value is None:
            break
        values.append(value)
        index += 1
    return values


def query_tag_name():
    spec_index = 1
    while True:
        resource_type = request.values.get(f"TagSpecification.{spec_index}.ResourceType")
        if resource_type is None:
            break
        tag_index = 1
        while True:
            key = request.values.get(
                f"TagSpecification.{spec_index}.Tag.{tag_index}.Key"
            )
            value = request.values.get(
                f"TagSpecification.{spec_index}.Tag.{tag_index}.Value"
            )
            if key is None:
                break
            if key == "Name":
                return value
            tag_index += 1
        spec_index += 1

    tag_index = 1
    while True:
        key = request.values.get(f"Tag.{tag_index}.Key")
        value = request.values.get(f"Tag.{tag_index}.Value")
        if key is None:
            return None
        if key == "Name":
            return value
        tag_index += 1


def vmid_from_instance_id(instance_id):
    raw = str(instance_id)
    if raw.startswith("i-") and raw[2:].isdigit():
        return int(raw[2:])
    if raw.isdigit():
        return int(raw)
    raise ValueError(f"invalid instance id: {instance_id}")


def instance_to_ec2_xml(instance):
    state = instance.get("status") or "unknown"
    owner = instance.get("owner") or {}
    image_id = owner.get("image_id") or "ami-unknown"
    launch_time = owner.get("created_at") or ""
    key_name = owner.get("key_name")
    return (
        "<item>"
        f"<instanceId>{xml_text(instance.get('instance_id'))}</instanceId>"
        f"<imageId>{xml_text(image_id)}</imageId>"
        f"<instanceState><name>{xml_text(state)}</name></instanceState>"
        f"<privateDnsName>{xml_text(instance.get('name'))}</privateDnsName>"
        f"<dnsName>{xml_text(instance.get('name'))}</dnsName>"
        f"<instanceType>{xml_text(instance.get('instance_type'))}</instanceType>"
        f"<keyName>{xml_text(key_name)}</keyName>"
        f"<launchTime>{xml_text(launch_time)}</launchTime>"
        f"<placement><availabilityZone>{xml_text(instance.get('node'))}</availabilityZone></placement>"
        "<tagSet>"
        "<item><key>Name</key>"
        f"<value>{xml_text(instance.get('name'))}</value></item>"
        "</tagSet>"
        "</item>"
    )


def vpc_to_ec2_xml(vpc):
    return (
        "<item>"
        f"<vpcId>{xml_text(vpc.get('vpc_id'))}</vpcId>"
        f"<state>{xml_text(vpc.get('state'))}</state>"
        f"<cidrBlock>{xml_text(vpc.get('cidr_block'))}</cidrBlock>"
        f"<isDefault>{str(bool(vpc.get('is_default'))).lower()}</isDefault>"
        "</item>"
    )


def subnet_to_ec2_xml(subnet):
    return (
        "<item>"
        f"<subnetId>{xml_text(subnet.get('subnet_id'))}</subnetId>"
        f"<state>{xml_text(subnet.get('state'))}</state>"
        f"<vpcId>{xml_text(subnet.get('vpc_id'))}</vpcId>"
        f"<cidrBlock>{xml_text(subnet.get('cidr_block'))}</cidrBlock>"
        f"<availabilityZone>{xml_text(subnet.get('availability_zone'))}</availabilityZone>"
        "</item>"
    )


def security_group_to_ec2_xml(group):
    ingress = ""
    for rule in group.get("ingress_rules", []):
        ingress += (
            "<item>"
            f"<ipProtocol>{xml_text(rule.get('ip_protocol'))}</ipProtocol>"
            f"<fromPort>{xml_text(rule.get('from_port'))}</fromPort>"
            f"<toPort>{xml_text(rule.get('to_port'))}</toPort>"
            "<ipRanges>"
            "<item>"
            f"<cidrIp>{xml_text(rule.get('cidr_ip'))}</cidrIp>"
            "</item>"
            "</ipRanges>"
            "</item>"
        )

    return (
        "<item>"
        f"<groupId>{xml_text(group.get('group_id'))}</groupId>"
        f"<groupName>{xml_text(group.get('name'))}</groupName>"
        f"<groupDescription>{xml_text(group.get('description'))}</groupDescription>"
        f"<vpcId>{xml_text(group.get('vpc_id'))}</vpcId>"
        f"<ipPermissions>{ingress}</ipPermissions>"
        "<ipPermissionsEgress/>"
        "</item>"
    )


def key_pair_to_ec2_xml(key_pair):
    return (
        "<item>"
        f"<keyName>{xml_text(key_pair.get('key_name'))}</keyName>"
        f"<keyFingerprint>{xml_text(key_pair.get('fingerprint'))}</keyFingerprint>"
        f"<keyPairId>{xml_text(key_pair.get('key_pair_id'))}</keyPairId>"
        "</item>"
    )


def image_to_ec2_xml(image):
    return (
        "<item>"
        f"<imageId>{xml_text(image.get('image_id'))}</imageId>"
        f"<imageLocation>{xml_text(image.get('name'))}</imageLocation>"
        f"<imageState>available</imageState>"
        f"<imageOwnerId>calpolysoc</imageOwnerId>"
        f"<name>{xml_text(image.get('name'))}</name>"
        f"<architecture>{xml_text(image.get('architecture'))}</architecture>"
        f"<platformDetails>{xml_text(image.get('platform'))}</platformDetails>"
        "<rootDeviceType>ebs</rootDeviceType>"
        "<virtualizationType>hvm</virtualizationType>"
        "</item>"
    )


def region_to_ec2_xml(region):
    return (
        "<item>"
        f"<regionName>{xml_text(region.get('region_name'))}</regionName>"
        f"<regionEndpoint>{xml_text(region.get('endpoint'))}</regionEndpoint>"
        "</item>"
    )


def availability_zone_to_ec2_xml(zone):
    return (
        "<item>"
        f"<zoneName>{xml_text(zone.get('zone_name'))}</zoneName>"
        f"<zoneState>{xml_text(zone.get('state'))}</zoneState>"
        f"<regionName>{xml_text(zone.get('region_name'))}</regionName>"
        "</item>"
    )


def instance_type_to_ec2_xml(instance_type):
    return (
        "<item>"
        f"<instanceType>{xml_text(instance_type.get('instance_type'))}</instanceType>"
        "<currentGeneration>true</currentGeneration>"
        "<vcpuInfo>"
        f"<defaultVCpus>{xml_text(instance_type.get('vcpu'))}</defaultVCpus>"
        "</vcpuInfo>"
        "<memoryInfo>"
        f"<sizeInMiB>{xml_text(instance_type.get('memory_mib'))}</sizeInMiB>"
        "</memoryInfo>"
        "</item>"
    )


def volume_to_ec2_xml(volume):
    attachment = ""
    if volume.get("attached_vmid"):
        instance_id = f"i-{int(volume.get('attached_vmid')):08d}"
        attachment = (
            "<attachmentSet><item>"
            f"<volumeId>{xml_text(volume.get('volume_id'))}</volumeId>"
            f"<instanceId>{xml_text(instance_id)}</instanceId>"
            f"<device>{xml_text(volume.get('device_name'))}</device>"
            f"<status>{xml_text('attached' if volume.get('state') == 'in-use' else volume.get('state'))}</status>"
            f"<attachTime>{xml_text(volume.get('updated_at'))}</attachTime>"
            "</item></attachmentSet>"
        )
    else:
        attachment = "<attachmentSet/>"

    return (
        "<item>"
        f"<volumeId>{xml_text(volume.get('volume_id'))}</volumeId>"
        f"<size>{xml_text(volume.get('size_gib'))}</size>"
        f"<availabilityZone>{xml_text(volume.get('availability_zone'))}</availabilityZone>"
        f"<status>{xml_text(volume.get('state'))}</status>"
        f"<createTime>{xml_text(volume.get('created_at'))}</createTime>"
        f"<snapshotId>{xml_text(volume.get('source_snapshot_id'))}</snapshotId>"
        f"{attachment}"
        "<volumeType>gp3</volumeType>"
        "</item>"
    )


def snapshot_to_ec2_xml(snapshot):
    return (
        "<item>"
        f"<snapshotId>{xml_text(snapshot.get('snapshot_id'))}</snapshotId>"
        f"<volumeId>{xml_text(snapshot.get('volume_id'))}</volumeId>"
        f"<status>{xml_text(snapshot.get('state'))}</status>"
        f"<startTime>{xml_text(snapshot.get('created_at'))}</startTime>"
        f"<progress>{xml_text(snapshot.get('progress', '100%' if snapshot.get('state') == 'completed' else '0%'))}</progress>"
        f"<volumeSize>{xml_text(snapshot.get('size_gib'))}</volumeSize>"
        f"<description>{xml_text(snapshot.get('name'))}</description>"
        "</item>"
    )


def attachment_to_ec2_xml(volume, state):
    vmid = volume.get("attached_vmid")
    instance_id = f"i-{int(vmid):08d}" if vmid else ""
    return (
        f"<volumeId>{xml_text(volume.get('volume_id'))}</volumeId>"
        f"<instanceId>{xml_text(instance_id)}</instanceId>"
        f"<device>{xml_text(volume.get('device_name'))}</device>"
        f"<status>{xml_text(state)}</status>"
        f"<attachTime>{xml_text(volume.get('updated_at'))}</attachTime>"
    )


def describe_instances_query(identity):
    instance_ids = indexed_values("InstanceId")
    vmid = None
    if len(instance_ids) == 1:
        vmid = vmid_from_instance_id(instance_ids[0])

    result, payload = load_instances(vmid)
    if not result["ok"]:
        raise RuntimeError(command_failure_message(result, "describe failed"))

    instances = attach_acl_entries(payload.get("instances", []))
    instances = filter_instances_for_identity(instances, identity)
    instances = sanitize_instances_for_identity(instances, identity)
    if len(instance_ids) > 1:
        wanted = {vmid_from_instance_id(item) for item in instance_ids}
        instances = [
            instance for instance in instances
            if maybe_int(instance.get("vmid")) in wanted
        ]

    items = "".join(
        "<item><instancesSet>"
        f"{instance_to_ec2_xml(instance)}"
        "</instancesSet></item>"
        for instance in instances
    )
    return xml_response("DescribeInstances", f"<reservationSet>{items}</reservationSet>")


def instance_state_change_query(action, command):
    identity = query_identity()
    instance_ids = indexed_values("InstanceId")
    if not instance_ids:
        raise ValueError("missing InstanceId.1")

    items = ""
    for instance_id in instance_ids:
        vmid = vmid_from_instance_id(instance_id)
        if not has_privileged_role(identity):
            access_error = require_instance_access(vmid)
            if access_error:
                raise PermissionError(f"forbidden for instance {instance_id}")
        if command == "terminate-instance":
            run_cmd([CLOUDCTL, "stop-instance", "--vmid", str(vmid)])
        result = run_cmd([CLOUDCTL, command, "--vmid", str(vmid)])
        if not result["ok"]:
            raise RuntimeError(command_failure_message(result, f"{command} failed"))
        items += (
            "<item>"
            f"<instanceId>{xml_text(f'i-{vmid:08d}')}</instanceId>"
            "<currentState><name>pending</name></currentState>"
            "</item>"
        )
        record_audit_event(
            f"ec2.query.{action.lower()}",
            identity=identity,
            resource_type="ec2.instance",
            resource_id=vmid,
            result="success",
        )

    return xml_response(action, f"<instancesSet>{items}</instancesSet>")


def run_instances_query():
    identity = query_identity()
    image_id = request.values.get("ImageId") or "ami-ubuntu-2404"
    instance_type = request.values.get("InstanceType") or "t3.small"
    if image_id not in IMAGE_TEMPLATE_VMIDS:
        raise ValueError(f"unsupported ImageId: {image_id}")
    if instance_type not in INSTANCE_TYPES:
        raise ValueError(f"unsupported InstanceType: {instance_type}")
    assert_quota_available(
        identity,
        {
            "instances": 1,
            "vcpus": INSTANCE_TYPES[instance_type]["cores"],
            "memory_mib": INSTANCE_TYPES[instance_type]["memory"],
        },
    )
    name = query_tag_name() or f"ec2-query-{uuid.uuid4().hex[:8]}"
    key_name = request.values.get("KeyName")
    if key_name and not get_key_pair(key_name, identity):
        raise ValueError("key pair not found")

    security_group_ids = indexed_values("SecurityGroupId")
    body = {
        "name": name,
        "instance_type": instance_type,
        "image_id": image_id,
        "template_vmid": IMAGE_TEMPLATE_VMIDS.get(image_id),
        "password": request.values.get("Password"),
        "key_name": key_name,
        "security_group_ids": security_group_ids,
    }
    job = create_job(identity, body)
    record_audit_event(
        "ec2.query.run_instances",
        identity=identity,
        resource_type="ec2.job",
        resource_id=job["job_id"],
        result="success",
        details={
            "name": name,
            "instance_type": instance_type,
            "image_id": image_id,
            "template_vmid": body.get("template_vmid"),
            "key_name": key_name,
        },
    )
    thread = threading.Thread(
        target=launch_instance_job,
        args=(job["job_id"], identity, body),
        daemon=True,
    )
    thread.start()
    return xml_response(
        "RunInstances",
        "<instancesSet>"
        "<item>"
        f"<instanceId>{xml_text(job['job_id'])}</instanceId>"
        f"<keyName>{xml_text(key_name)}</keyName>"
        "<instanceState><name>pending</name></instanceState>"
        "</item>"
        "</instancesSet>",
        status=202,
    )


def handle_ec2_query_action(action):
    identity = query_identity()

    if action == "DescribeInstances":
        return describe_instances_query(identity)
    if action == "RunInstances":
        return run_instances_query()
    if action == "StartInstances":
        return instance_state_change_query(action, "start-instance")
    if action == "StopInstances":
        return instance_state_change_query(action, "stop-instance")
    if action == "TerminateInstances":
        return instance_state_change_query(action, "terminate-instance")
    if action == "DescribeImages":
        images = list_images(indexed_values("ImageId"))
        return xml_response(
            action,
            f"<imagesSet>{''.join(image_to_ec2_xml(image) for image in images)}</imagesSet>",
        )
    if action == "DescribeRegions":
        regions = list_regions(indexed_values("RegionName"))
        return xml_response(
            action,
            (
                "<regionInfo>"
                f"{''.join(region_to_ec2_xml(region) for region in regions)}"
                "</regionInfo>"
            ),
        )
    if action == "DescribeAvailabilityZones":
        zones = list_availability_zones(indexed_values("ZoneName"))
        return xml_response(
            action,
            (
                "<availabilityZoneInfo>"
                f"{''.join(availability_zone_to_ec2_xml(zone) for zone in zones)}"
                "</availabilityZoneInfo>"
            ),
        )
    if action == "DescribeInstanceTypes":
        instance_types = list_instance_types(indexed_values("InstanceType"))
        return xml_response(
            action,
            (
                "<instanceTypeSet>"
                f"{''.join(instance_type_to_ec2_xml(item) for item in instance_types)}"
                "</instanceTypeSet>"
            ),
        )
    if action == "DescribeAccountAttributes":
        return xml_response(
            action,
            (
                "<accountAttributeSet>"
                "<item><attributeName>supported-platforms</attributeName>"
                "<attributeValueSet><item><attributeValue>VPC</attributeValue></item></attributeValueSet>"
                "</item>"
                "</accountAttributeSet>"
            ),
        )
    if action == "DescribeKeyPairs":
        key_pairs = list_key_pairs(identity, indexed_values("KeyName"))
        return xml_response(
            action,
            (
                "<keySet>"
                f"{''.join(key_pair_to_ec2_xml(key_pair) for key_pair in key_pairs)}"
                "</keySet>"
            ),
        )
    if action == "ImportKeyPair":
        key_name = request.values.get("KeyName")
        key_pair = create_key_pair_record(
            identity,
            key_name,
            request.values.get("PublicKeyMaterial"),
        )
        record_audit_event(
            "ec2.query.import_key_pair",
            identity,
            "ec2.key_pair",
            key_pair["key_name"],
        )
        return xml_response(
            action,
            (
                f"<keyName>{xml_text(key_pair['key_name'])}</keyName>"
                f"<keyFingerprint>{xml_text(key_pair['fingerprint'])}</keyFingerprint>"
                f"<keyPairId>{xml_text(key_pair['key_pair_id'])}</keyPairId>"
            ),
        )
    if action == "CreateKeyPair":
        key_name = request.values.get("KeyName")
        private_key, public_key = generate_ssh_key_pair(str(key_name or "keypair"))
        key_pair = create_key_pair_record(identity, key_name, public_key)
        record_audit_event(
            "ec2.query.create_key_pair",
            identity,
            "ec2.key_pair",
            key_pair["key_name"],
        )
        return xml_response(
            action,
            (
                f"<keyName>{xml_text(key_pair['key_name'])}</keyName>"
                f"<keyFingerprint>{xml_text(key_pair['fingerprint'])}</keyFingerprint>"
                f"<keyPairId>{xml_text(key_pair['key_pair_id'])}</keyPairId>"
                f"<keyMaterial>{xml_text(private_key)}</keyMaterial>"
            ),
        )
    if action == "DeleteKeyPair":
        key_name = request.values.get("KeyName")
        if not delete_key_pair_record(identity, key_name):
            raise ValueError("key pair not found")
        record_audit_event(
            "ec2.query.delete_key_pair",
            identity,
            "ec2.key_pair",
            key_name,
        )
        return xml_response(action, "<return>true</return>")
    if action == "CreateVpc":
        vpc = create_vpc_record(identity, {"CidrBlock": request.values.get("CidrBlock")})
        record_audit_event("ec2.query.create_vpc", identity, "ec2.vpc", vpc["vpc_id"])
        return xml_response(action, f"<vpc>{vpc_to_ec2_xml(vpc)}</vpc>")
    if action == "DescribeVpcs":
        vpcs = list_vpcs(identity, indexed_values("VpcId"))
        return xml_response(
            action,
            f"<vpcSet>{''.join(vpc_to_ec2_xml(vpc) for vpc in vpcs)}</vpcSet>",
        )
    if action == "DeleteVpc":
        vpc_id = request.values.get("VpcId")
        if not get_vpc(vpc_id, identity):
            raise ValueError("vpc not found")
        delete_vpc_record(vpc_id)
        record_audit_event("ec2.query.delete_vpc", identity, "ec2.vpc", vpc_id)
        return xml_response(action, "<return>true</return>")
    if action == "CreateSubnet":
        subnet = create_subnet_record(
            identity,
            {
                "VpcId": request.values.get("VpcId"),
                "CidrBlock": request.values.get("CidrBlock"),
                "AvailabilityZone": request.values.get("AvailabilityZone"),
            },
        )
        record_audit_event(
            "ec2.query.create_subnet",
            identity,
            "ec2.subnet",
            subnet["subnet_id"],
        )
        return xml_response(action, f"<subnet>{subnet_to_ec2_xml(subnet)}</subnet>")
    if action == "DescribeSubnets":
        subnets = list_subnets(identity, indexed_values("SubnetId"))
        return xml_response(
            action,
            (
                "<subnetSet>"
                f"{''.join(subnet_to_ec2_xml(subnet) for subnet in subnets)}"
                "</subnetSet>"
            ),
        )
    if action == "DeleteSubnet":
        subnet_id = request.values.get("SubnetId")
        if not get_subnet(subnet_id, identity):
            raise ValueError("subnet not found")
        delete_subnet_record(subnet_id)
        record_audit_event("ec2.query.delete_subnet", identity, "ec2.subnet", subnet_id)
        return xml_response(action, "<return>true</return>")
    if action == "CreateSecurityGroup":
        group = create_security_group_record(
            identity,
            {
                "VpcId": request.values.get("VpcId"),
                "GroupName": request.values.get("GroupName"),
                "GroupDescription": request.values.get("GroupDescription"),
            },
        )
        record_audit_event(
            "ec2.query.create_security_group",
            identity,
            "ec2.security_group",
            group["group_id"],
        )
        return xml_response(action, f"<groupId>{xml_text(group['group_id'])}</groupId>")
    if action == "DescribeSecurityGroups":
        groups = list_security_groups(identity, indexed_values("GroupId"))
        return xml_response(
            action,
            (
                "<securityGroupInfo>"
                f"{''.join(security_group_to_ec2_xml(group) for group in groups)}"
                "</securityGroupInfo>"
            ),
        )
    if action == "DeleteSecurityGroup":
        group_id = request.values.get("GroupId")
        if not get_security_group(group_id, identity):
            raise ValueError("security group not found")
        delete_security_group_record(group_id)
        record_audit_event(
            "ec2.query.delete_security_group",
            identity,
            "ec2.security_group",
            group_id,
        )
        return xml_response(action, "<return>true</return>")
    if action == "AuthorizeSecurityGroupIngress":
        group_id = request.values.get("GroupId")
        rule = create_security_group_rule(
            identity,
            group_id,
            {
                "IpProtocol": request.values.get("IpProtocol"),
                "FromPort": request.values.get("FromPort"),
                "ToPort": request.values.get("ToPort"),
                "CidrIp": request.values.get("CidrIp"),
                "SourceSecurityGroupId": request.values.get("SourceSecurityGroupId"),
            },
            "ingress",
        )
        record_audit_event(
            "ec2.query.authorize_security_group_ingress",
            identity,
            "ec2.security_group_rule",
            rule["rule_id"],
        )
        return xml_response(action, "<return>true</return>")
    if action == "CreateVolume":
        volume = create_volume_record(
            identity,
            {
                "Size": request.values.get("Size"),
                "AvailabilityZone": request.values.get("AvailabilityZone"),
                "SnapshotId": request.values.get("SnapshotId"),
            },
        )
        record_audit_event(
            "ec2.query.create_volume",
            identity,
            "ec2.volume",
            volume["volume_id"],
        )
        return xml_response(action, volume_to_ec2_xml(volume))
    if action == "DescribeVolumes":
        volumes = list_volumes(identity, indexed_values("VolumeId"))
        return xml_response(
            action,
            f"<volumeSet>{''.join(volume_to_ec2_xml(volume) for volume in volumes)}</volumeSet>",
        )
    if action == "AttachVolume":
        volume_id = request.values.get("VolumeId")
        instance_id = request.values.get("InstanceId")
        if not volume_id or not instance_id:
            raise ValueError("missing VolumeId or InstanceId")
        volume = get_volume(volume_id, identity)
        if not volume:
            raise ValueError("volume not found")
        if volume.get("state") != "available":
            raise ValueError("volume must be available")
        vmid = vmid_from_instance_id(instance_id)
        if not has_privileged_role(identity):
            access_error = require_instance_access(vmid)
            if access_error:
                raise PermissionError(f"forbidden for instance {instance_id}")
        job = create_resource_job(
            identity,
            "ec2.volume.attach",
            "ec2.volume",
            volume_id,
            "volume attach queued",
        )
        thread = threading.Thread(
            target=attach_volume_job,
            args=(job["job_id"], identity, volume_id, vmid, request.values.get("Device")),
            daemon=True,
        )
        thread.start()
        response_volume = dict(volume)
        response_volume.update(
            {
                "attached_vmid": vmid,
                "device_name": request.values.get("Device"),
                "state": "attaching",
            }
        )
        return xml_response(action, attachment_to_ec2_xml(response_volume, "attaching"), status=202)
    if action == "DetachVolume":
        volume_id = request.values.get("VolumeId")
        if not volume_id:
            raise ValueError("missing VolumeId")
        volume = get_volume(volume_id, identity)
        if not volume:
            raise ValueError("volume not found")
        if not volume.get("attached_vmid"):
            raise ValueError("volume is not attached")
        if not has_privileged_role(identity):
            access_error = require_instance_access(volume["attached_vmid"])
            if access_error:
                raise PermissionError("forbidden for attached instance")
        job = create_resource_job(
            identity,
            "ec2.volume.detach",
            "ec2.volume",
            volume_id,
            "volume detach queued",
        )
        thread = threading.Thread(
            target=detach_volume_job,
            args=(job["job_id"], identity, volume_id),
            daemon=True,
        )
        thread.start()
        return xml_response(action, attachment_to_ec2_xml(volume, "detaching"), status=202)
    if action == "DeleteVolume":
        volume_id = request.values.get("VolumeId")
        volume = get_volume(volume_id, identity)
        if not volume:
            raise ValueError("volume not found")
        if volume.get("attached_vmid"):
            raise ValueError("volume is attached")
        if volume.get("last_vmid") and volume.get("unused_key"):
            result = run_cmd(
                [
                    CLOUDCTL,
                    "delete-volume-backing",
                    "--vmid",
                    str(volume["last_vmid"]),
                    "--unused-key",
                    volume["unused_key"],
                ]
            )
            if not result["ok"]:
                raise RuntimeError(command_failure_message(result, "cloudctl delete-volume-backing failed"))
        delete_volume_record(volume_id)
        record_audit_event("ec2.query.delete_volume", identity, "ec2.volume", volume_id)
        return xml_response(action, "<return>true</return>")
    if action == "CreateSnapshot":
        snapshot = create_snapshot_record(
            identity,
            {
                "VolumeId": request.values.get("VolumeId"),
                "Description": request.values.get("Description"),
            },
        )
        job = create_resource_job(
            identity,
            "ec2.snapshot.create",
            "ec2.snapshot",
            snapshot["snapshot_id"],
            "snapshot create queued",
        )
        thread = threading.Thread(
            target=create_snapshot_job,
            args=(job["job_id"], identity, snapshot["snapshot_id"]),
            daemon=True,
        )
        thread.start()
        record_audit_event(
            "ec2.query.create_snapshot",
            identity,
            "ec2.snapshot",
            snapshot["snapshot_id"],
        )
        return xml_response(action, snapshot_to_ec2_xml(snapshot), status=202)
    if action == "DescribeSnapshots":
        snapshots = list_snapshots(identity, indexed_values("SnapshotId"))
        return xml_response(
            action,
            f"<snapshotSet>{''.join(snapshot_to_ec2_xml(snapshot) for snapshot in snapshots)}</snapshotSet>",
        )
    if action == "DeleteSnapshot":
        snapshot_id = request.values.get("SnapshotId")
        snapshot = get_snapshot(snapshot_id, identity)
        if not snapshot:
            raise ValueError("snapshot not found")
        delete_snapshot_record(snapshot_id)
        record_audit_event("ec2.query.delete_snapshot", identity, "ec2.snapshot", snapshot_id)
        return xml_response(action, "<return>true</return>")

    raise NotImplementedError(f"unsupported EC2 action: {action}")


@app.route("/", methods=["GET", "POST"])
def ec2_query_api():
    action = request.values.get("Action")
    if not action:
        return ec2_error_response("MissingParameter", "missing Action", 400)

    try:
        return handle_ec2_query_action(action)
    except PermissionError as exc:
        return ec2_error_response("UnauthorizedOperation", str(exc), 403)
    except ValueError as exc:
        return ec2_error_response("InvalidParameterValue", str(exc), 400)
    except NotImplementedError as exc:
        return ec2_error_response("UnsupportedOperation", str(exc), 400)
    except Exception as exc:
        log_error(f"[ec2-query-error] action={action} error={exc}")
        return ec2_error_response("InternalError", str(exc), 500)


@app.before_request
def guard_internal_requests():
    if request.endpoint == "health":
        return None

    if request.endpoint == "ec2_query_api":
        return require_ec2_query_auth()

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


@app.get("/jobs")
def get_jobs():
    identity = resolve_console_identity(request.headers, required=False)
    raw_limit = request.args.get("limit", "100")
    try:
        limit = int(raw_limit)
    except ValueError:
        return jsonify({"ok": False, "error": "limit must be an integer"}), 400

    jobs = list_jobs(limit)
    if identity and not has_privileged_role(identity):
        principal = str(identity.get("principal") or "").strip().lower()
        jobs = [
            job for job in jobs
            if str(job.get("principal") or "").strip().lower() == principal
        ]

    return jsonify({"ok": True, "jobs": jobs, "count": len(jobs)}), 200


@app.get("/audit")
def get_audit():
    identity = resolve_console_identity(request.headers, required=False)
    if not has_privileged_role(identity):
        return jsonify({"ok": False, "error": "forbidden"}), 403

    raw_limit = request.args.get("limit", "100")
    try:
        limit = int(raw_limit)
    except ValueError:
        return jsonify({"ok": False, "error": "limit must be an integer"}), 400

    events = list_audit_events(limit)
    return jsonify({"ok": True, "events": events, "count": len(events)}), 200


@app.get("/images")
def describe_images():
    image_ids = request.args.getlist("image_id")
    records = list_images(image_ids)
    return jsonify({"ok": True, "images": records, "count": len(records)}), 200


@app.get("/regions")
def describe_regions():
    region_names = request.args.getlist("region_name")
    records = list_regions(region_names)
    return jsonify({"ok": True, "regions": records, "count": len(records)}), 200


@app.get("/availability-zones")
def describe_availability_zones():
    zone_names = request.args.getlist("zone_name")
    records = list_availability_zones(zone_names)
    return jsonify(
        {"ok": True, "availability_zones": records, "count": len(records)}
    ), 200


@app.get("/instance-types")
def describe_instance_types():
    names = request.args.getlist("instance_type")
    records = list_instance_types(names)
    return jsonify({"ok": True, "instance_types": records, "count": len(records)}), 200


@app.get("/access-keys")
def describe_access_keys():
    try:
        identity = resolve_console_identity(request.headers)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    records = list_access_keys(identity)
    return jsonify({"ok": True, "access_keys": records, "count": len(records)}), 200


@app.post("/access-keys")
def create_access_key():
    try:
        identity = resolve_console_identity(request.headers)
        body = request.get_json(force=True) or {}
        record = create_access_key_record(identity, body)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    record_audit_event(
        "ec2.create_access_key",
        identity=identity,
        resource_type="iam.access_key",
        resource_id=record["access_key_id"],
        result="success",
        status=201,
        details={"name": record.get("name")},
    )
    return jsonify({"ok": True, "access_key": record}), 201


@app.delete("/access-keys/<access_key_id>")
def delete_access_key(access_key_id):
    try:
        identity = resolve_console_identity(request.headers)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    if not delete_access_key_record(access_key_id, identity):
        return jsonify({"ok": False, "error": "access key not found"}), 404

    record_audit_event(
        "ec2.delete_access_key",
        identity=identity,
        resource_type="iam.access_key",
        resource_id=access_key_id,
        result="success",
        status=200,
    )
    return jsonify({"ok": True, "access_key_id": access_key_id}), 200


@app.get("/key-pairs")
def describe_key_pairs():
    identity = resolve_console_identity(request.headers, required=False)
    records = list_key_pairs(identity)
    return jsonify({"ok": True, "key_pairs": records, "count": len(records)}), 200


@app.post("/key-pairs")
def create_key_pair():
    try:
        identity = resolve_console_identity(request.headers)
        body = request.get_json(force=True) or {}
        key_name = body.get("key_name") or body.get("name") or body.get("KeyName")
        private_key = None
        public_key = body.get("public_key") or body.get("PublicKeyMaterial")
        if not public_key:
            private_key, public_key = generate_ssh_key_pair(str(key_name or "keypair"))
        record = create_key_pair_record(identity, key_name, public_key)
    except (RuntimeError, ValueError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    response = dict(record)
    if private_key:
        response["private_key"] = private_key

    record_audit_event(
        "ec2.create_key_pair",
        identity=identity,
        resource_type="ec2.key_pair",
        resource_id=record["key_name"],
        result="success",
        status=201,
        details={"fingerprint": record.get("fingerprint")},
    )
    return jsonify({"ok": True, "key_pair": response}), 201


@app.delete("/key-pairs/<key_name>")
def delete_key_pair(key_name):
    try:
        identity = resolve_console_identity(request.headers)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    if not delete_key_pair_record(identity, key_name):
        return jsonify({"ok": False, "error": "key pair not found"}), 404

    record_audit_event(
        "ec2.delete_key_pair",
        identity=identity,
        resource_type="ec2.key_pair",
        resource_id=key_name,
        result="success",
        status=200,
    )
    return jsonify({"ok": True, "key_name": key_name}), 200


@app.get("/vpcs")
def describe_vpcs():
    identity = resolve_console_identity(request.headers, required=False)
    records = list_vpcs(identity)
    return jsonify({"ok": True, "vpcs": records, "count": len(records)}), 200


@app.post("/vpcs")
def create_vpc():
    try:
        identity = resolve_console_identity(request.headers)
        body = request.get_json(force=True) or {}
        record = create_vpc_record(identity, body)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    record_audit_event(
        "ec2.create_vpc",
        identity=identity,
        resource_type="ec2.vpc",
        resource_id=record["vpc_id"],
        result="success",
        status=201,
        details={"cidr_block": record["cidr_block"]},
    )
    return jsonify({"ok": True, "vpc": record}), 201


@app.get("/vpcs/<vpc_id>")
def get_vpc_route(vpc_id):
    identity = resolve_console_identity(request.headers, required=False)
    record = get_vpc(vpc_id, identity)
    if not record:
        return jsonify({"ok": False, "error": "vpc not found"}), 404
    return jsonify({"ok": True, "vpc": record}), 200


@app.delete("/vpcs/<vpc_id>")
def delete_vpc(vpc_id):
    identity = resolve_console_identity(request.headers, required=False)
    record = get_vpc(vpc_id, identity)
    if not record:
        return jsonify({"ok": False, "error": "vpc not found"}), 404

    try:
        delete_vpc_record(vpc_id)
    except RuntimeError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 409

    record_audit_event(
        "ec2.delete_vpc",
        identity=identity,
        resource_type="ec2.vpc",
        resource_id=vpc_id,
        result="success",
        status=200,
    )
    return jsonify({"ok": True, "vpc_id": vpc_id}), 200


@app.get("/subnets")
def describe_subnets():
    identity = resolve_console_identity(request.headers, required=False)
    records = list_subnets(identity, vpc_id=request.args.get("vpc_id"))
    return jsonify({"ok": True, "subnets": records, "count": len(records)}), 200


@app.post("/subnets")
def create_subnet():
    try:
        identity = resolve_console_identity(request.headers)
        body = request.get_json(force=True) or {}
        record = create_subnet_record(identity, body)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    record_audit_event(
        "ec2.create_subnet",
        identity=identity,
        resource_type="ec2.subnet",
        resource_id=record["subnet_id"],
        result="success",
        status=201,
        details={"vpc_id": record["vpc_id"], "cidr_block": record["cidr_block"]},
    )
    return jsonify({"ok": True, "subnet": record}), 201


@app.delete("/subnets/<subnet_id>")
def delete_subnet(subnet_id):
    identity = resolve_console_identity(request.headers, required=False)
    record = get_subnet(subnet_id, identity)
    if not record:
        return jsonify({"ok": False, "error": "subnet not found"}), 404

    delete_subnet_record(subnet_id)
    record_audit_event(
        "ec2.delete_subnet",
        identity=identity,
        resource_type="ec2.subnet",
        resource_id=subnet_id,
        result="success",
        status=200,
    )
    return jsonify({"ok": True, "subnet_id": subnet_id}), 200


@app.get("/security-groups")
def describe_security_groups():
    identity = resolve_console_identity(request.headers, required=False)
    records = list_security_groups(identity, vpc_id=request.args.get("vpc_id"))
    return jsonify(
        {"ok": True, "security_groups": records, "count": len(records)}
    ), 200


@app.post("/security-groups")
def create_security_group():
    try:
        identity = resolve_console_identity(request.headers)
        body = request.get_json(force=True) or {}
        record = create_security_group_record(identity, body)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    record_audit_event(
        "ec2.create_security_group",
        identity=identity,
        resource_type="ec2.security_group",
        resource_id=record["group_id"],
        result="success",
        status=201,
        details={"vpc_id": record["vpc_id"], "name": record["name"]},
    )
    return jsonify({"ok": True, "security_group": record}), 201


@app.delete("/security-groups/<group_id>")
def delete_security_group(group_id):
    identity = resolve_console_identity(request.headers, required=False)
    record = get_security_group(group_id, identity)
    if not record:
        return jsonify({"ok": False, "error": "security group not found"}), 404

    delete_security_group_record(group_id)
    record_audit_event(
        "ec2.delete_security_group",
        identity=identity,
        resource_type="ec2.security_group",
        resource_id=group_id,
        result="success",
        status=200,
    )
    return jsonify({"ok": True, "group_id": group_id}), 200


@app.post("/security-groups/<group_id>/ingress")
def authorize_security_group_ingress_route(group_id):
    try:
        identity = resolve_console_identity(request.headers)
        body = request.get_json(force=True) or {}
        record = create_security_group_rule(identity, group_id, body, "ingress")
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    record_audit_event(
        "ec2.authorize_security_group_ingress",
        identity=identity,
        resource_type="ec2.security_group_rule",
        resource_id=record["rule_id"],
        result="success",
        status=201,
        details={"group_id": group_id},
    )
    return jsonify({"ok": True, "rule": record}), 201


@app.delete("/security-groups/<group_id>/ingress/<rule_id>")
def revoke_security_group_ingress_route(group_id, rule_id):
    try:
        identity = resolve_console_identity(request.headers)
        delete_security_group_rule(identity, group_id, rule_id)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404

    record_audit_event(
        "ec2.revoke_security_group_ingress",
        identity=identity,
        resource_type="ec2.security_group_rule",
        resource_id=rule_id,
        result="success",
        status=200,
        details={"group_id": group_id},
    )
    return jsonify({"ok": True, "rule_id": rule_id}), 200


@app.post("/security-groups/<group_id>/egress")
def authorize_security_group_egress_route(group_id):
    try:
        identity = resolve_console_identity(request.headers)
        body = request.get_json(force=True) or {}
        record = create_security_group_rule(identity, group_id, body, "egress")
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    record_audit_event(
        "ec2.authorize_security_group_egress",
        identity=identity,
        resource_type="ec2.security_group_rule",
        resource_id=record["rule_id"],
        result="success",
        status=201,
        details={"group_id": group_id},
    )
    return jsonify({"ok": True, "rule": record}), 201


@app.delete("/security-groups/<group_id>/egress/<rule_id>")
def revoke_security_group_egress_route(group_id, rule_id):
    try:
        identity = resolve_console_identity(request.headers)
        delete_security_group_rule(identity, group_id, rule_id)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404

    record_audit_event(
        "ec2.revoke_security_group_egress",
        identity=identity,
        resource_type="ec2.security_group_rule",
        resource_id=rule_id,
        result="success",
        status=200,
        details={"group_id": group_id},
    )
    return jsonify({"ok": True, "rule_id": rule_id}), 200


@app.get("/instances/<int:vmid>/security-groups")
def describe_instance_security_groups(vmid):
    identity = resolve_console_identity(request.headers, required=False)
    group_ids = list_instance_security_groups(vmid)
    groups = []
    for group_id in group_ids:
        sg = get_security_group(group_id, identity)
        if sg:
            groups.append(sg)
    return jsonify({"ok": True, "security_groups": groups, "count": len(groups)}), 200


@app.put("/instances/<int:vmid>/security-groups")
def modify_instance_security_groups(vmid):
    try:
        identity = resolve_console_identity(request.headers)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    access_error = require_instance_access(vmid)
    if access_error:
        return access_error

    body = request.get_json(force=True) or {}
    group_ids = body.get("security_group_ids") or body.get("GroupId") or []
    if isinstance(group_ids, str):
        group_ids = [group_ids]

    for sg_id in group_ids:
        if not get_security_group(sg_id):
            return jsonify({"ok": False, "error": f"security group not found: {sg_id}"}), 400

    try:
        associate_instance_security_groups(vmid, group_ids)
        sync_security_groups_to_vm(vmid)
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500

    record_audit_event(
        "ec2.modify_instance_security_groups",
        identity=identity,
        resource_type="ec2.instance",
        resource_id=vmid,
        result="success",
        details={"security_group_ids": group_ids},
    )
    return jsonify({"ok": True, "vmid": vmid, "security_group_ids": group_ids}), 200


@app.get("/quotas")
def describe_quotas():
    identity = resolve_console_identity(request.headers, required=False)
    try:
        usage = quota_usage(identity, include_instances=True)
    except Exception as exc:
        usage = {
            "instances": 0,
            "vcpus": 0,
            "memory_mib": 0,
            "volume_gib": 0,
            "db_instances": 0,
            "cache_instances": 0,
            "error": str(exc),
        }
    return jsonify(
        {
            "ok": True,
            "limits": quota_limits(),
            "usage": usage,
            **({"principal": identity["principal"]} if identity else {}),
        }
    ), 200


@app.get("/capacity")
def describe_capacity():
    result = run_cmd([CLOUDCTL, "capacity-summary", "--json"])
    if not result["ok"]:
        return jsonify(
            {
                "ok": False,
                "error": command_failure_message(result, "cloudctl capacity-summary failed"),
                "cloudctl": result,
            }
        ), 500
    try:
        payload = parse_cloudctl_json(result, "capacity-summary failed")
    except RuntimeError as exc:
        return jsonify({"ok": False, "error": str(exc), "cloudctl": result}), 500
    return jsonify({"ok": True, "capacity": payload}), 200


@app.get("/volumes")
def describe_volumes():
    identity = resolve_console_identity(request.headers, required=False)
    records = list_volumes(identity, request.args.getlist("volume_id"))
    return jsonify({"ok": True, "volumes": records, "count": len(records)}), 200


@app.post("/volumes")
def create_volume():
    try:
        identity = resolve_console_identity(request.headers)
        body = request.get_json(force=True) or {}
        record = create_volume_record(identity, body)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    record_audit_event(
        "ec2.create_volume",
        identity=identity,
        resource_type="ec2.volume",
        resource_id=record["volume_id"],
        result="success",
        status=201,
        details={"size_gib": record["size_gib"]},
    )
    return jsonify({"ok": True, "volume": record}), 201


@app.get("/volumes/<volume_id>")
def get_volume_route(volume_id):
    identity = resolve_console_identity(request.headers, required=False)
    record = get_volume(volume_id, identity)
    if not record:
        return jsonify({"ok": False, "error": "volume not found"}), 404
    return jsonify({"ok": True, "volume": record}), 200


@app.post("/volumes/<volume_id>/attach")
def attach_volume_route(volume_id):
    try:
        identity = resolve_console_identity(request.headers)
        body = request.get_json(force=True) or {}
        vmid = parse_positive_int(body.get("vmid"), "vmid")
        device_name = body.get("device_name") or body.get("device")
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    record = get_volume(volume_id, identity)
    if not record:
        return jsonify({"ok": False, "error": "volume not found"}), 404
    if record.get("state") != "available":
        return jsonify({"ok": False, "error": "volume must be available"}), 409

    access_error = require_instance_access(vmid)
    if access_error:
        return access_error

    job = create_resource_job(
        identity,
        "ec2.volume.attach",
        "ec2.volume",
        volume_id,
        "volume attach queued",
    )
    thread = threading.Thread(
        target=attach_volume_job,
        args=(job["job_id"], identity, volume_id, vmid, device_name),
        daemon=True,
    )
    thread.start()
    record_audit_event(
        "ec2.volume.attach.queued",
        identity=identity,
        resource_type="ec2.volume",
        resource_id=volume_id,
        result="success",
        status=202,
        details={"vmid": vmid, "device_name": device_name},
    )
    return jsonify({"ok": True, "job": job}), 202


@app.post("/volumes/<volume_id>/detach")
def detach_volume_route(volume_id):
    try:
        identity = resolve_console_identity(request.headers)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    record = get_volume(volume_id, identity)
    if not record:
        return jsonify({"ok": False, "error": "volume not found"}), 404
    if not record.get("attached_vmid"):
        return jsonify({"ok": False, "error": "volume is not attached"}), 409

    access_error = require_instance_access(record["attached_vmid"])
    if access_error:
        return access_error

    job = create_resource_job(
        identity,
        "ec2.volume.detach",
        "ec2.volume",
        volume_id,
        "volume detach queued",
    )
    thread = threading.Thread(
        target=detach_volume_job,
        args=(job["job_id"], identity, volume_id),
        daemon=True,
    )
    thread.start()
    record_audit_event(
        "ec2.volume.detach.queued",
        identity=identity,
        resource_type="ec2.volume",
        resource_id=volume_id,
        result="success",
        status=202,
    )
    return jsonify({"ok": True, "job": job}), 202


@app.delete("/volumes/<volume_id>")
def delete_volume_route(volume_id):
    identity = resolve_console_identity(request.headers, required=False)
    record = get_volume(volume_id, identity)
    if not record:
        return jsonify({"ok": False, "error": "volume not found"}), 404
    if record.get("attached_vmid"):
        return jsonify({"ok": False, "error": "volume is attached"}), 409

    if record.get("last_vmid") and record.get("unused_key"):
        result = run_cmd(
            [
                CLOUDCTL,
                "delete-volume-backing",
                "--vmid",
                str(record["last_vmid"]),
                "--unused-key",
                record["unused_key"],
            ]
        )
        if not result["ok"]:
            return jsonify(
                {
                    "ok": False,
                    "error": command_failure_message(result, "cloudctl delete-volume-backing failed"),
                    "cloudctl": result,
                }
            ), 500

    delete_volume_record(volume_id)
    record_audit_event(
        "ec2.delete_volume",
        identity=identity,
        resource_type="ec2.volume",
        resource_id=volume_id,
        result="success",
        status=200,
    )
    return jsonify({"ok": True, "volume_id": volume_id}), 200


@app.get("/snapshots")
def describe_snapshots():
    identity = resolve_console_identity(request.headers, required=False)
    records = list_snapshots(identity, request.args.getlist("snapshot_id"))
    return jsonify({"ok": True, "snapshots": records, "count": len(records)}), 200


@app.post("/snapshots")
def create_snapshot():
    try:
        identity = resolve_console_identity(request.headers)
        body = request.get_json(force=True) or {}
        record = create_snapshot_record(identity, body)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    job = create_resource_job(
        identity,
        "ec2.snapshot.create",
        "ec2.snapshot",
        record["snapshot_id"],
        "snapshot create queued",
    )
    thread = threading.Thread(
        target=create_snapshot_job,
        args=(job["job_id"], identity, record["snapshot_id"]),
        daemon=True,
    )
    thread.start()
    record_audit_event(
        "ec2.create_snapshot",
        identity=identity,
        resource_type="ec2.snapshot",
        resource_id=record["snapshot_id"],
        result="success",
        status=202,
        details={"volume_id": record["volume_id"]},
    )
    return jsonify({"ok": True, "snapshot": record, "job": job}), 202


@app.post("/snapshots/<snapshot_id>/restore")
def restore_snapshot(snapshot_id):
    try:
        identity = resolve_console_identity(request.headers)
        snapshot = get_snapshot(snapshot_id, identity)
        if not snapshot:
            return jsonify({"ok": False, "error": "snapshot not found"}), 404
        body = request.get_json(force=True, silent=True) or {}
        record = create_volume_record(
            identity,
            {
                "size_gib": body.get("size_gib") or snapshot["size_gib"],
                "availability_zone": body.get("availability_zone"),
                "snapshot_id": snapshot_id,
                "name": body.get("name") or f"restore-{snapshot_id}",
            },
        )
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    record_audit_event(
        "ec2.restore_snapshot",
        identity=identity,
        resource_type="ec2.volume",
        resource_id=record["volume_id"],
        result="success",
        status=201,
        details={"snapshot_id": snapshot_id},
    )
    return jsonify({"ok": True, "volume": record}), 201


@app.delete("/snapshots/<snapshot_id>")
def delete_snapshot_route(snapshot_id):
    identity = resolve_console_identity(request.headers, required=False)
    record = get_snapshot(snapshot_id, identity)
    if not record:
        return jsonify({"ok": False, "error": "snapshot not found"}), 404
    delete_snapshot_record(snapshot_id)
    record_audit_event(
        "ec2.delete_snapshot",
        identity=identity,
        resource_type="ec2.snapshot",
        resource_id=snapshot_id,
        result="success",
        status=200,
    )
    return jsonify({"ok": True, "snapshot_id": snapshot_id}), 200


@app.get("/db-instances")
def describe_db_instances():
    identity = resolve_console_identity(request.headers, required=False)
    records = list_db_instances(identity)
    return jsonify({"ok": True, "db_instances": records, "count": len(records)}), 200


@app.post("/db-instances")
def create_db_instance():
    try:
        identity = resolve_console_identity(request.headers)
        body = request.get_json(force=True) or {}
        record = create_db_instance_record(identity, body)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 409

    password = secrets.token_urlsafe(24)
    job = create_resource_job(
        identity,
        "db.create",
        "db.instance",
        record["db_instance_id"],
        "DB instance create queued",
    )
    thread = threading.Thread(
        target=provision_managed_service_job,
        args=(job["job_id"], identity, "db", record["db_instance_id"], password),
        daemon=True,
    )
    thread.start()
    record_audit_event(
        "db.create.queued",
        identity=identity,
        resource_type="db.instance",
        resource_id=record["db_instance_id"],
        result="success",
        status=202,
    )
    return jsonify(
        {
            "ok": True,
            "db_instance": record,
            "job": job,
            "credentials": {
                "username": record["master_username"],
                "password": password,
            },
        }
    ), 202


@app.post("/db-instances/<db_instance_id>/start")
def start_db_instance(db_instance_id):
    return set_managed_service_power("db", db_instance_id, "start")


@app.post("/db-instances/<db_instance_id>/stop")
def stop_db_instance(db_instance_id):
    return set_managed_service_power("db", db_instance_id, "stop")


@app.delete("/db-instances/<db_instance_id>")
def delete_db_instance(db_instance_id):
    return delete_managed_service_route("db", db_instance_id)


@app.get("/cache-instances")
def describe_cache_instances():
    identity = resolve_console_identity(request.headers, required=False)
    records = list_cache_instances(identity)
    return jsonify({"ok": True, "cache_instances": records, "count": len(records)}), 200


@app.post("/cache-instances")
def create_cache_instance():
    try:
        identity = resolve_console_identity(request.headers)
        body = request.get_json(force=True) or {}
        record = create_cache_instance_record(identity, body)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 409

    password = secrets.token_urlsafe(24)
    job = create_resource_job(
        identity,
        "cache.create",
        "cache.instance",
        record["cache_instance_id"],
        "cache instance create queued",
    )
    thread = threading.Thread(
        target=provision_managed_service_job,
        args=(job["job_id"], identity, "cache", record["cache_instance_id"], password),
        daemon=True,
    )
    thread.start()
    record_audit_event(
        "cache.create.queued",
        identity=identity,
        resource_type="cache.instance",
        resource_id=record["cache_instance_id"],
        result="success",
        status=202,
    )
    return jsonify(
        {
            "ok": True,
            "cache_instance": record,
            "job": job,
            "credentials": {
                "username": record["username"],
                "password": password,
            },
        }
    ), 202


@app.post("/cache-instances/<cache_instance_id>/start")
def start_cache_instance(cache_instance_id):
    return set_managed_service_power("cache", cache_instance_id, "start")


@app.post("/cache-instances/<cache_instance_id>/stop")
def stop_cache_instance(cache_instance_id):
    return set_managed_service_power("cache", cache_instance_id, "stop")


@app.delete("/cache-instances/<cache_instance_id>")
def delete_cache_instance(cache_instance_id):
    return delete_managed_service_route("cache", cache_instance_id)


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
        instances = attach_volume_records_to_instances(instances, identity)
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

    key_name = body.get("key_name") or body.get("KeyName")
    if key_name:
        if not get_key_pair(key_name, identity):
            return jsonify({"ok": False, "error": "key pair not found"}), 400
        body["key_name"] = key_name

    security_group_ids = body.get("security_group_ids") or []
    for sg_id in security_group_ids:
        if not get_security_group(sg_id):
            return jsonify({"ok": False, "error": f"security group not found: {sg_id}"}), 400

    instance_type = body.get("instance_type", "t3.small")
    spec = INSTANCE_TYPES.get(instance_type)
    if not spec:
        return jsonify({"ok": False, "error": f"unsupported instance_type: {instance_type}"}), 400
    try:
        assert_quota_available(
            identity,
            {
                "instances": 1,
                "vcpus": spec["cores"],
                "memory_mib": spec["memory"],
            },
        )
    except (RuntimeError, ValueError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 409

    job = create_job(identity, body)
    record_audit_event(
        "ec2.launch.queued",
        identity=identity,
        resource_type="ec2.job",
        resource_id=job["job_id"],
        result="success",
        status=202,
        details={
            "name": name,
            "instance_type": body.get("instance_type", "t3.small"),
            "image_id": body.get("image_id"),
            "template_name": body.get("template_name"),
            "template_vmid": body.get("template_vmid"),
            "key_name": body.get("key_name"),
        },
    )
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
    identity = resolve_console_identity(request.headers, required=False)
    record_audit_event(
        "ec2.start",
        identity=identity,
        resource_type="ec2.instance",
        resource_id=vmid,
        result="success" if result["ok"] else "failure",
        status=200 if result["ok"] else 500,
        message=None if result["ok"] else command_failure_message(result, "start failed"),
    )
    return jsonify(result), 200 if result["ok"] else 500


@app.post("/instances/<int:vmid>/stop")
def stop_instance(vmid):
    access_error = require_instance_access(vmid)
    if access_error:
        return access_error

    result = run_cmd([CLOUDCTL, "stop-instance", "--vmid", str(vmid)])
    identity = resolve_console_identity(request.headers, required=False)
    record_audit_event(
        "ec2.stop",
        identity=identity,
        resource_type="ec2.instance",
        resource_id=vmid,
        result="success" if result["ok"] else "failure",
        status=200 if result["ok"] else 500,
        message=None if result["ok"] else command_failure_message(result, "stop failed"),
    )
    return jsonify(result), 200 if result["ok"] else 500


@app.delete("/instances/<int:vmid>")
def terminate_instance(vmid):
    access_error = require_instance_access(vmid)
    if access_error:
        return access_error

    stop = run_cmd([CLOUDCTL, "stop-instance", "--vmid", str(vmid)])
    delete = run_cmd([CLOUDCTL, "terminate-instance", "--vmid", str(vmid)])

    ok = delete["ok"]
    identity = resolve_console_identity(request.headers, required=False)
    record_audit_event(
        "ec2.terminate",
        identity=identity,
        resource_type="ec2.instance",
        resource_id=vmid,
        result="success" if ok else "failure",
        status=200 if ok else 500,
        message=None if ok else command_failure_message(delete, "terminate failed"),
    )

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
    init_database()
    app.run(host="127.0.0.1", port=8090)
