# CalPolySOC Private Cloud MVP

This repository/runbook documents the current MVP for the CalPolySOC private AWS-like cloud platform.

The goal is to provide an internal cloud platform where VPN-connected users can deploy AWS-style resources through internal DNS endpoints, backed by:

- **Floci** for AWS-like managed services such as S3, DynamoDB, and SQS.
- **Proxmox VE** for EC2-like virtual machines.
- **Nginx** as the internal reverse proxy.
- **AD DNS** for internal-only name resolution.
- A lightweight **EC2 API wrapper** and `cloudctl` command for Proxmox-backed VM lifecycle operations.

This platform is **not exposed publicly**. Users must be on the VPN/private network and resolve records through the internal DNS infrastructure.

---

## Current Architecture

```text
VPN / Internal User
  -> AD DNS
  -> api.cloud.calpolysoc.org
  -> Nginx on aws VM
      -> /                 -> Floci :4566
      -> /ec2/             -> EC2 API wrapper :8090
          -> cloudctl
          -> Proxmox API
          -> clone/start/stop/delete VMs
```

High-level service layout:

```text
cloud.calpolysoc.org
  Future frontend dashboard

api.cloud.calpolysoc.org
  Internal API endpoint

api.cloud.calpolysoc.org/
  Floci-backed AWS services:
    - S3
    - DynamoDB
    - SQS

api.cloud.calpolysoc.org/ec2/
  Proxmox-backed EC2 MVP:
    - List instances
    - Launch instance
    - Start instance
    - Stop instance
    - Terminate instance
```

---

## Internal DNS Records

The following records were created in the internal `calpolysoc.org` AD DNS zone:

```text
cloud.calpolysoc.org       A   172.21.1.30
api.cloud.calpolysoc.org   A   172.21.1.30
s3.cloud.calpolysoc.org    A   172.21.1.30
auth.cloud.calpolysoc.org  A   172.21.1.30
```

`172.21.1.30` is the internal cloud/API VM running Floci, Nginx, and the EC2 API wrapper.

Users must be on VPN/private routing to reach this host.

---

## Completed Components

### 1. Internal Floci Service Layer

Floci is running in Docker on the `aws` VM.

Current internal endpoint:

```text
http://api.cloud.calpolysoc.org
```

Floci is bound locally and proxied through Nginx:

```text
127.0.0.1:4566
```

The public-facing/internal-facing API hostname is:

```text
api.cloud.calpolysoc.org
```

Current working services:

```text
S3
DynamoDB
SQS
```

Tested resources:

```text
S3 bucket:        mvp-demo-bucket
S3 object:        hello.txt
DynamoDB table:   mvp-demo-table
SQS queue:        mvp-demo-queue
```

SQS was updated to return internal queue URLs instead of `localhost`:

```text
http://api.cloud.calpolysoc.org/000000000000/mvp-demo-queue
```

---

### 2. Floci Persistence

Floci now uses persistent storage under:

```text
/opt/floci/data
```

Important compose settings:

```yaml
FLOCI_BASE_URL: "http://api.cloud.calpolysoc.org"
FLOCI_DEFAULT_REGION: "us-east-1"
FLOCI_DEFAULT_ACCOUNT_ID: "000000000000"

FLOCI_STORAGE_MODE: "persistent"
FLOCI_STORAGE_PERSISTENT_PATH: "/data"

FLOCI_STORAGE_SERVICES_S3_MODE: "persistent"
FLOCI_STORAGE_SERVICES_DYNAMODB_MODE: "persistent"
FLOCI_STORAGE_SERVICES_SQS_MODE: "persistent"
FLOCI_STORAGE_SERVICES_SNS_MODE: "persistent"
```

The S3 permission issue was fixed by mounting a writable host directory:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
  - /opt/floci/data:/data
```

Persistence was verified by restarting the Floci container and confirming that the S3 bucket and object remained.

---

### 3. Nginx Internal Reverse Proxy

Nginx routes requests based on path:

```text
/api.cloud.calpolysoc.org/
  -> Floci on 127.0.0.1:4566

/api.cloud.calpolysoc.org/ec2/
  -> EC2 API wrapper on 127.0.0.1:8090
```

Current Nginx behavior:

```text
location /ec2/
  proxy_pass http://127.0.0.1:8090/

location /
  proxy_pass http://127.0.0.1:4566
```

Nginx timeout was increased for `/ec2/` because Proxmox clone/start operations can take longer than the default proxy timeout.

---

### 4. Proxmox Ubuntu Cloud-Init Template

A working Ubuntu 24.04 cloud-init template was created on Proxmox.

Current template:

```text
Template VMID: 9001
Template name: tmpl-ubuntu-2404
Node: kitasanblack
Storage: local-lvm
Bridge: vmbr0
```

Important final template config:

```text
boot: order=scsi0
scsi0: local-lvm:base-9001-disk-0,size=20G
ide2: local-lvm:vm-9001-cloudinit,media=cdrom
ciuser: ubuntu
ipconfig0: ip=dhcp
template: 1
```

The template was successfully cloned into a running VM.

---

### 5. Proxmox API Token

A Proxmox API token was created for automation:

```text
User: cloudbot@pve
Token: mvp-token
```

The API token was tested successfully against the Proxmox API:

```bash
curl -k \
  -H "Authorization: PVEAPIToken=cloudbot@pve!mvp-token=<TOKEN_SECRET>" \
  "https://172.21.1.22:8006/api2/json/nodes"
```

The Proxmox API returned all cluster nodes:

```text
kitasanblack
matikanetannhauser
satonodiamond
```

Security note: the token should be rotated before real users use this platform.

---

### 6. `cloudctl` EC2 MVP CLI

A lightweight `cloudctl` command was created on the `aws` VM.

Path:

```text
/usr/local/bin/cloudctl
/opt/calpoly-cloud/cloudctl
```

Config:

```text
/etc/calpoly-cloud/proxmox.env
```

Current config fields:

```text
PROXMOX_HOST=172.21.1.22
PROXMOX_NODE=kitasanblack
PROXMOX_TOKEN_ID=cloudbot@pve!mvp-token
PROXMOX_TOKEN_SECRET=<secret>
PROXMOX_TEMPLATE_ID=9001
PROXMOX_STORAGE=local-lvm
PROXMOX_BRIDGE=vmbr0
```

Supported instance types:

```text
t3.nano    1 vCPU / 512 MB RAM
t3.micro   1 vCPU / 1 GB RAM
t3.small   1 vCPU / 2 GB RAM
t3.medium  2 vCPU / 4 GB RAM
```

Current commands:

```bash
cloudctl describe-instances

cloudctl run-instance \
  --name test-ec2-01 \
  --instance-type t3.small \
  --password 'ChangeMe123!'

cloudctl stop-instance --vmid <VMID>

cloudctl start-instance --vmid <VMID>

cloudctl terminate-instance --vmid <VMID>
```

This successfully launched a Proxmox VM from template `9001`.

---

### 7. EC2 API Wrapper

A Flask-based EC2 MVP API was created.

Service file:

```text
/etc/systemd/system/calpoly-ec2-api.service
```

Application path:

```text
/opt/calpoly-cloud/ec2-api.py
```

Local bind:

```text
127.0.0.1:8090
```

Nginx path:

```text
http://api.cloud.calpolysoc.org/ec2/
```

Current EC2 API endpoints:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/ec2/health` | Health check |
| `GET` | `/ec2/instances` | List Proxmox-backed instances |
| `GET` | `/ec2/instances?vmid=<VMID>` | Show one instance |
| `POST` | `/ec2/instances` | Launch a new VM |
| `POST` | `/ec2/instances/<VMID>/start` | Start VM |
| `POST` | `/ec2/instances/<VMID>/stop` | Stop VM |
| `DELETE` | `/ec2/instances/<VMID>` | Stop and terminate VM |

Example launch request:

```bash
curl -X POST http://api.cloud.calpolysoc.org/ec2/instances \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ec2-api-test-01",
    "instance_type": "t3.small",
    "password": "ChangeMe123!"
  }'
```

Example list request:

```bash
curl http://api.cloud.calpolysoc.org/ec2/instances
```

---

## Current API Endpoints

### Main Internal API

```text
http://api.cloud.calpolysoc.org
```

### Floci / AWS-Like Service Endpoint

Used for S3, DynamoDB, SQS:

```text
http://api.cloud.calpolysoc.org
```

Example S3:

```bash
aws --endpoint-url=http://api.cloud.calpolysoc.org s3api list-buckets
```

Example DynamoDB:

```bash
aws --endpoint-url=http://api.cloud.calpolysoc.org dynamodb list-tables
```

Example SQS:

```bash
aws --endpoint-url=http://api.cloud.calpolysoc.org sqs list-queues
```

### EC2 MVP API

```text
http://api.cloud.calpolysoc.org/ec2
```

Example:

```bash
curl http://api.cloud.calpolysoc.org/ec2/health
curl http://api.cloud.calpolysoc.org/ec2/instances
```

---

## Current Working MVP Flow

### Managed Services

```text
User on VPN
  -> api.cloud.calpolysoc.org
  -> Nginx
  -> Floci
  -> S3 / DynamoDB / SQS
```

### EC2-Like Compute

```text
User on VPN
  -> api.cloud.calpolysoc.org/ec2/instances
  -> Nginx
  -> EC2 Flask API
  -> cloudctl
  -> Proxmox API
  -> clone template 9001
  -> start VM
```

---

## Things Still Left To Do

### 1. Frontend Console

Build the user-facing web console at:

```text
http://cloud.calpolysoc.org
```

Recommended frontend pages:

```text
Dashboard
Instances
Launch Instance
Images / AMIs
S3 Buckets
DynamoDB Tables
SQS Queues
VPCs
Subnets
Security Groups
Access Keys
Audit Logs
Admin Settings
```

Initial frontend should call:

```text
GET    /ec2/health
GET    /ec2/instances
POST   /ec2/instances
POST   /ec2/instances/<VMID>/start
POST   /ec2/instances/<VMID>/stop
DELETE /ec2/instances/<VMID>
```

---

### 2. Async EC2 Jobs

Current `POST /ec2/instances` waits for Proxmox clone/start to finish. This can cause Nginx 504 timeouts.

Recommended next version:

```text
POST /ec2/instances
  -> immediately returns:
     {
       "job_id": "job-...",
       "instance_id": "i-...",
       "state": "pending"
     }

GET /ec2/jobs/<job_id>
  -> returns job status

GET /ec2/instances
  -> returns current instance state
```

This requires:

```text
SQLite or Postgres state DB
Background worker
Job table
Instance table
```

---

### 3. State Database

Right now, instance state is inferred from Proxmox.

Add a real control-plane database:

```text
PostgreSQL preferred
SQLite acceptable for MVP
```

Suggested tables:

```text
accounts
users
access_keys
instances
images
vpcs
subnets
security_groups
security_group_rules
jobs
audit_logs
```

---

### 4. Authentication and Authorization

Currently, the EC2 API is internal-only but does not yet enforce proper user-level auth.

Needed:

```text
Keycloak/OIDC for frontend users
API keys or tokens for programmatic access
Role-based access control
Per-user or per-project quotas
Audit logs
```

Recommended roles:

```text
cloud-admin
cloud-user
cloud-readonly
project-admin
```

---

### 5. Token Rotation

The Proxmox API token was exposed during setup/testing and should be rotated.

On Proxmox:

```bash
pveum user token remove cloudbot@pve mvp-token
pveum user token add cloudbot@pve mvp-token --privsep 0
```

Then update:

```text
/etc/calpoly-cloud/proxmox.env
```

Restart EC2 API:

```bash
systemctl restart calpoly-ec2-api
```

---

### 6. VPC / Subnet / Security Group MVP

Currently, VM networking uses:

```text
bridge=vmbr0
ipconfig0=ip=dhcp
```

Next MVP layer should add metadata for:

```text
VPCs
Subnets
Security groups
Routes
```

Initial implementation can be metadata-only:

```text
CreateVpc
CreateSubnet
CreateSecurityGroup
AuthorizeSecurityGroupIngress
Describe*
```

Then later map these to:

```text
Proxmox SDN
VLANs
VXLAN/EVPN
pfSense/FRR routes
nftables or Proxmox firewall rules
```

---

### 7. Security Group Enforcement

Currently, security groups are not enforced.

Possible enforcement layers:

```text
Proxmox firewall
nftables on Proxmox hosts
pfSense aliases/rules
Open vSwitch ACLs
```

MVP rule set:

```text
Allow SSH from VPN/user subnet
Allow ICMP from VPN/user subnet
Allow all egress
Deny all other ingress
```

---

### 8. Better Images / AMIs

Current image mapping:

```text
ami-ubuntu-2404 -> Proxmox template 9001
```

Add image registry:

```text
ami-ubuntu-2404
ami-debian-12
ami-rocky-9
ami-windows-2022
```

Each image should track:

```text
AMI ID
Display name
Proxmox template VMID
Default username
Cloud-init support
Minimum disk size
Node/storage availability
```

---

### 9. Multi-Node Scheduling

Current EC2 MVP launches only on:

```text
Node: kitasanblack
Storage: local-lvm
Template: 9001
```

Need scheduler logic for:

```text
Node selection
Available CPU/RAM
Storage availability
Template availability
Failure domains / availability zones
```

Short-term options:

```text
Copy template 9001 to every node
Use only kitasanblack for MVP
Use shared storage later
```

Long-term:

```text
Ceph or other shared storage
Proxmox SDN
Availability-zone abstraction
```

---

### 10. Storage Safety

Proxmox reported thin-pool overprovisioning warnings:

```text
Sum of all thin volume sizes exceeds the size of thin pool pve/data
```

Before deploying many instances:

```bash
pvesm status
lvs
qm list
```

Cleanup old test VMs and disks:

```bash
qm destroy <VMID> --purge 1 --destroy-unreferenced-disks 1
```

Consider:

```text
Larger VM storage
Shared storage
Ceph
Storage quotas
Instance disk limits
```

---

### 11. HTTPS

Current MVP uses HTTP internally.

Recommended long-term:

```text
https://cloud.calpolysoc.org
https://api.cloud.calpolysoc.org
```

Certificate options:

```text
Internal AD CS certificate
Public certificate using DNS-01 validation
```

DNS can remain internal-only while using DNS-01 for a valid public certificate.

---

### 12. AWS/Terraform Compatibility

Current EC2 API is custom REST, not full AWS Query API-compatible.

Eventually add:

```text
RunInstances
DescribeInstances
StartInstances
StopInstances
TerminateInstances
CreateVpc
CreateSubnet
CreateSecurityGroup
```

Possible paths:

```text
Build AWS Query API compatibility
Build Terraform provider for CalPolySOC Cloud
Build adapter/shim from AWS API calls to internal API
```

Recommended order:

1. Build frontend and stable internal APIs.
2. Add database/state/async jobs.
3. Add Terraform compatibility later.

---

## Useful Commands

### Check Floci

```bash
docker ps | grep floci
docker logs -f floci
```

### Test Floci through internal API

```bash
aws --endpoint-url=http://api.cloud.calpolysoc.org s3api list-buckets
aws --endpoint-url=http://api.cloud.calpolysoc.org dynamodb list-tables
aws --endpoint-url=http://api.cloud.calpolysoc.org sqs list-queues
```

### Check EC2 API

```bash
systemctl status calpoly-ec2-api --no-pager
journalctl -u calpoly-ec2-api -f
curl http://127.0.0.1:8090/health
curl http://api.cloud.calpolysoc.org/ec2/health
```

### Check Nginx

```bash
nginx -t
systemctl reload nginx
systemctl status nginx --no-pager
```

### Check Proxmox API from `aws`

```bash
curl -k \
  -H "Authorization: PVEAPIToken=cloudbot@pve!mvp-token=<TOKEN_SECRET>" \
  "https://172.21.1.22:8006/api2/json/nodes"
```

### Check Instances

```bash
cloudctl describe-instances
curl http://api.cloud.calpolysoc.org/ec2/instances
```

### Launch Instance

```bash
cloudctl run-instance \
  --name test-ec2-01 \
  --instance-type t3.small \
  --password 'ChangeMe123!'
```

Or through HTTP API:

```bash
curl -X POST http://api.cloud.calpolysoc.org/ec2/instances \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ec2-api-test-01",
    "instance_type": "t3.small",
    "password": "ChangeMe123!"
  }'
```

---

## Current MVP Summary

The MVP successfully proves that CalPolySOC can run an internal AWS-like cloud platform:

```text
S3/DynamoDB/SQS
  -> Floci

EC2-like VM launch
  -> Proxmox template clone

Internal API routing
  -> api.cloud.calpolysoc.org

Future web console
  -> cloud.calpolysoc.org
```

The next major milestone is building the frontend dashboard and adding a persistent control-plane database with async job handling.
