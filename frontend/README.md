# CalPolySOC Cloud Console

Internal web console for the CalPolySOC private cloud. Built with **Next.js 16
(App Router)**, **Tailwind CSS**, and **shadcn/ui** patterns. Talks to the
internal `api.cloud.calpolysoc.org` endpoints (Floci + EC2 API wrapper) and
discovers launch templates from the Proxmox API.

> No database is required. The console is stateless and proxies everything to
> the internal cloud API, so Prisma is not used.

## Architecture

```text
Browser (on VPN)
  -> http://cloud.calpolysoc.org              (Nginx on aws VM)
     -> 127.0.0.1:3000                         (Next.js standalone server)
  -> server components -> Proxmox API   (live template discovery)
        -> /api/ec2/*    -> http://api.cloud.calpolysoc.org/ec2/*    (EC2 API wrapper)
        -> /api/aws/s3   -> Floci S3
        -> /api/aws/ddb  -> Floci DynamoDB
        -> /api/aws/sqs  -> Floci SQS
```

Server-only fetches mean the Proxmox token, Keycloak credentials, and internal
API hostnames never leave the VPN-resident container.

## Local development

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Then open <http://localhost:3000>. You must be on the VPN for the upstream
endpoints to resolve.

## Production / bare-metal deploy

From the repo root:

```bash
cp frontend/.env.example frontend/.env
docker compose up -d --build
```

This produces a small `node:22-alpine` image using the Next.js standalone
output, listens on `127.0.0.1:3000` on the host, and pins
`api.cloud.calpolysoc.org` to `172.21.1.30` inside the container in case
Docker's resolver doesn't see AD DNS.

Then add the Nginx vhost on the `aws` VM:

```bash
sudo cp deploy/nginx/cloud.calpolysoc.org.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/cloud.calpolysoc.org.conf \
           /etc/nginx/sites-enabled/cloud.calpolysoc.org.conf
sudo nginx -t && sudo systemctl reload nginx
```

DNS already points `cloud.calpolysoc.org -> 172.21.1.30`.

### Live Proxmox catalog

The console now discovers its image catalog directly from the Proxmox API at
request time instead of reading a runtime JSON file.

That live catalog drives:

- Supported instance sizes
- Image/template mappings
- Current node, storage, bridge, and region profile
- Default instance type shown in the launch form

The console queries Proxmox for template VMs, filters them by name prefix
(`tmpl-` by default), and maps known templates like Ubuntu 24.04,
Ubuntu 22.04, Debian 12, Rocky Linux 9, and AlmaLinux 9 onto friendly image
metadata. The `/settings` page is now a live discovery/status view and can
still generate bootstrap commands for templates with a known cloud image URL.

The launch form also sends the selected image id and Proxmox template metadata
alongside `name`, `instance_type`, and `password`, so the EC2 wrapper can be
upgraded to image-aware launches without another frontend change.

Refresh the page and the console re-queries Proxmox; no image rebuild or JSON
edit is required.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `CLOUD_API_BASE_URL` | `http://api.cloud.calpolysoc.org` | EC2 API + Floci base |
| `FLOCI_ENDPOINT_URL` | falls back to `CLOUD_API_BASE_URL` | AWS SDK endpoint override |
| `AWS_ACCESS_KEY_ID` | `test` | required by AWS SDK; Floci ignores value |
| `AWS_SECRET_ACCESS_KEY` | `test` | same |
| `AWS_DEFAULT_REGION` | `us-east-1` | matches `FLOCI_DEFAULT_REGION` |
| `AUTH_SECRET` | _required_ | JWT signing secret (`openssl rand -base64 32`) |
| `AUTH_URL` | `https://cloud.calpolysoc.org` | public URL the browser uses |
| `AUTH_TRUST_HOST` | `true` | trust `X-Forwarded-*` from Nginx |
| `AUTH_KEYCLOAK_ID` | `cloud-console` | Keycloak `client_id` |
| `AUTH_KEYCLOAK_SECRET` | _required_ | Keycloak `client_secret` |
| `AUTH_KEYCLOAK_ISSUER` | `https://auth.calpolysoc.org/realms/calpolysoc` | OIDC issuer |
| `PROXMOX_HOST` | _required_ unless `PROXMOX_API_BASE_URL` is set | Proxmox API host |
| `PROXMOX_PORT` | `8006` | Proxmox API port |
| `PROXMOX_PROTOCOL` | `https` | Proxmox API scheme |
| `PROXMOX_TOKEN_ID` | _required_ | Proxmox API token id |
| `PROXMOX_TOKEN_SECRET` | _required_ | Proxmox API token secret |
| `PROXMOX_NODE` | `kitasanblack` | launch/profile node label shown in the UI |
| `PROXMOX_STORAGE` | `local-lvm` | storage target shown in launch/bootstrap views |
| `PROXMOX_BRIDGE` | `vmbr0` | network bridge shown in launch/bootstrap views |
| `PROXMOX_REGION` | falls back to `AWS_DEFAULT_REGION` | region label used by the console |
| `PROXMOX_ALLOW_INSECURE_TLS` | `true` | allow self-signed internal Proxmox certs |
| `PROXMOX_TEMPLATE_NAME_PREFIX` | `tmpl-` | only expose templates whose names start with this prefix |
| `PROXMOX_API_BASE_URL` | unset | full override for the Proxmox API base URL |
| `PROXMOX_DEFAULT_IMAGE_ID` | unset | preferred default image when multiple templates are present |

## Authentication

The console uses **Auth.js v5** with the Keycloak provider against the
internal SSO realm:

```text
Browser
  -> https://cloud.calpolysoc.org
  -> redirect to https://auth.calpolysoc.org/realms/calpolysoc
  -> login (Keycloak / LDAP / 2FA)
  -> callback to /api/auth/callback/keycloak
  -> session cookie set, access + refresh tokens stored in JWT
```

Every page is gated by `proxy.ts`; unauthenticated
requests are redirected to `/auth/signin`. Server-side proxy routes
(`/api/ec2/*`, `/api/aws/*`) verify the session and forward the user's
Keycloak access token as `Authorization: Bearer <token>` to the upstream
API, so per-user RBAC can be enforced inside the EC2 API wrapper / Floci.

### Keycloak client setup

In the `calpolysoc` realm, create a **Confidential client**:

| Field | Value |
|---|---|
| Client ID | `cloud-console` |
| Client authentication | On |
| Standard flow | On |
| Direct access grants | Off |
| Valid redirect URIs | `https://cloud.calpolysoc.org/api/auth/callback/keycloak` |
| Valid post-logout redirect URIs | `https://cloud.calpolysoc.org/auth/signin` |
| Web origins | `https://cloud.calpolysoc.org` |

Copy the generated client secret into `AUTH_KEYCLOAK_SECRET`. Realm roles
assigned to users land in `session.user.roles` and can be used for
authorization checks in server components.

The console now adapts its experience by role:

- Default users get the **client workspace** with self-service navigation and workspace-scoped copy.
- Any Keycloak role containing `staff` unlocks the **staff console**.
- Any Keycloak role containing `admin` unlocks the **admin console**.

The privileged console gates `/settings`, `/audit`, and the live EC2 catalog
editor / template bootstrap tooling. The customer-facing shell remains focused
on instances, storage, queues, and other day-to-day workload actions.

## Pages

- `/` Dashboard — service health and resource counts
- `/instances` EC2-style VM list with start / stop / terminate
- `/instances/launch` Launch a new VM from the Proxmox cloud-init template
- `/api/ec2/capabilities` Authenticated live view of the active Proxmox-backed EC2 catalog
- `/s3` Bucket list (Floci S3)
- `/dynamodb` Table list (Floci DynamoDB)
- `/sqs` Queue list (Floci SQS)
- `/vpcs`, `/security-groups`, `/access-keys`, `/audit`, `/settings`
  Placeholders mapped to roadmap items in the repo README.

## Updating

```bash
git pull
docker compose up -d --build
```

The container is healthchecked on `GET /` and restarted automatically by
Docker if it stops responding.
