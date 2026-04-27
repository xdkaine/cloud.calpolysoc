# CalPolySOC Cloud Console

Internal web console for the CalPolySOC private cloud. Built with **Next.js 16
(App Router)**, **Tailwind CSS**, and **shadcn/ui** patterns. Talks to the
internal `api.cloud.calpolysoc.org` endpoints (Floci + EC2 API wrapper).

> No database is required. The console is stateless and proxies everything to
> the internal cloud API, so Prisma is not used.

## Architecture

```text
Browser (on VPN)
  -> http://cloud.calpolysoc.org              (Nginx on aws VM)
     -> 127.0.0.1:3000                         (Next.js standalone server)
        -> /api/ec2/*    -> http://api.cloud.calpolysoc.org/ec2/*    (EC2 API wrapper)
        -> /api/aws/s3   -> Floci S3
        -> /api/aws/ddb  -> Floci DynamoDB
        -> /api/aws/sqs  -> Floci SQS
```

Server-only API routes mean credentials and the internal API hostname never
leave the VPN-resident container.

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

Every page is gated by [middleware.ts](middleware.ts); unauthenticated
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

## Pages

- `/` Dashboard — service health and resource counts
- `/instances` EC2-style VM list with start / stop / terminate
- `/instances/launch` Launch a new VM from the Proxmox cloud-init template
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
