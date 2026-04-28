# AWS VM Context Capture

Run these commands on the CalPolySOC `aws` VM to capture the deployment and
control-plane context that is still missing from this repo.

Use this when we need to implement against the real host state instead of
guessing from the frontend code alone.

## Redaction

- Do not paste raw secret values back into chat.
- The commands below only print non-secret env values and whether required
  secrets are present.
- The Proxmox API checks use env vars in the shell, but they do not print the
  token secret.
- If you are already logged in as `root`, run the privileged commands as-is.
  If you are using a non-root admin shell, prefix the host-level commands with
  `sudo`.
- If Bash prints errors like `$'\r': command not found`, the block was pasted
  with Windows CRLF line endings. Re-paste from this file on the Linux host or
  strip carriage returns before running.

## 1. Console deploy state

Run from the repo clone on the AWS VM.

```bash
cd /opt/cloud.calpolysoc

echo "## repo"
pwd
ls -la
ls -la frontend

echo
echo "## compose"
docker compose ps
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'

echo
echo "## console env (non-secret)"
grep -E '^(CLOUD_API_BASE_URL|FLOCI_ENDPOINT_URL|AWS_DEFAULT_REGION|AUTH_URL|AUTH_TRUST_HOST|AUTH_KEYCLOAK_ID|AUTH_KEYCLOAK_ISSUER|PROXMOX_HOST|PROXMOX_PORT|PROXMOX_PROTOCOL|PROXMOX_NODE|PROXMOX_STORAGE|PROXMOX_BRIDGE|PROXMOX_REGION|PROXMOX_ALLOW_INSECURE_TLS|PROXMOX_TEMPLATE_NAME_PREFIX|PROXMOX_API_BASE_URL|PROXMOX_DEFAULT_IMAGE_ID)=' frontend/.env | sort

echo
echo "## required secret presence"
for k in AUTH_SECRET AUTH_KEYCLOAK_SECRET PROXMOX_TOKEN_ID PROXMOX_TOKEN_SECRET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
  if grep -q "^${k}=" frontend/.env; then
    echo "${k}=set"
  else
    echo "${k}=missing"
  fi
done

echo
echo "## console logs"
docker logs --tail=120 cloud-console
```

## 2. Host reverse proxy and listeners

This confirms how the console, Floci, and the EC2 wrapper are actually exposed
on the VM.

```bash
echo "## nginx status"
systemctl status nginx --no-pager --lines=40

echo
echo "## nginx config test"
nginx -t

echo
echo "## vhost locations"
grep -R -n "server_name .*calpolysoc.org" /etc/nginx/sites-available /etc/nginx/sites-enabled

echo
echo "## listeners"
ss -ltnp | grep -E ':(80|443|3000|4566|8090|8006)\b'
```

## 3. Console reachability from host and container

This tells us whether the console container can reach Keycloak and the internal
API the same way the code expects.

```bash
echo "## host -> console"
curl -ksSI https://cloud.calpolysoc.org | sed -n '1,20p'
curl -sS http://127.0.0.1:3000/ | head -c 400; echo

echo
echo "## container -> internal api"
docker exec cloud-console wget -qO- http://api.cloud.calpolysoc.org/ec2/health; echo

echo
echo "## container -> keycloak discovery"
docker exec cloud-console wget -S -O- https://auth.calpolysoc.org/realms/calpolysoc/.well-known/openid-configuration 2>&1 | sed -n '1,30p'
```

## 4. Internal API, Floci, and EC2 wrapper checks

This gives the runtime behavior of the services the frontend is trying to talk
to right now.

```bash
echo "## proxied ec2 health"
curl -sS http://api.cloud.calpolysoc.org/ec2/health; echo

echo
echo "## local ec2 wrapper health"
curl -sS http://127.0.0.1:8090/health; echo

echo
echo "## current ec2 instances (if exposed without user auth)"
curl -sS http://api.cloud.calpolysoc.org/ec2/instances | head -c 3000; echo
```

If AWS CLI is installed on the VM, this is also useful for Floci state:

```bash
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 \
aws --endpoint-url http://api.cloud.calpolysoc.org s3api list-buckets

AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 \
aws --endpoint-url http://api.cloud.calpolysoc.org dynamodb list-tables

AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 \
aws --endpoint-url http://api.cloud.calpolysoc.org sqs list-queues
```

## 5. Proxmox discovery context

This is the highest-value missing context for the live catalog and future
project-aware compute work.

```bash
cd /opt/cloud.calpolysoc

if grep -q $'\r' ./frontend/.env; then
  echo "frontend/.env has CRLF line endings; stripping carriage returns for this shell session"
fi

set -a
source <(tr -d '\r' < ./frontend/.env)
set +a

PROXMOX_BASE="${PROXMOX_API_BASE_URL:-${PROXMOX_PROTOCOL}://${PROXMOX_HOST}:${PROXMOX_PORT}}"

echo "## proxmox target"
echo "base=${PROXMOX_BASE}"
echo "node=${PROXMOX_NODE}"
echo "template_prefix=${PROXMOX_TEMPLATE_NAME_PREFIX}"

echo
echo "## proxmox nodes"
curl -sk -H "Authorization: PVEAPIToken=${PROXMOX_TOKEN_ID}=${PROXMOX_TOKEN_SECRET}" \
  "${PROXMOX_BASE}/api2/json/nodes" | head -c 2000; echo

echo
echo "## proxmox qemu list on configured node"
curl -sk -H "Authorization: PVEAPIToken=${PROXMOX_TOKEN_ID}=${PROXMOX_TOKEN_SECRET}" \
  "${PROXMOX_BASE}/api2/json/nodes/${PROXMOX_NODE}/qemu" | head -c 5000; echo
```

## 6. Host service ownership

This helps determine where the EC2 wrapper and any off-repo control-plane code
actually live.

```bash
echo "## systemd units"
systemctl list-units --type=service --all | grep -Ei 'nginx|cloud|ec2|floci'

echo
echo "## matching processes"
ps -ef | grep -Ei 'cloudctl|ec2|floci|next-server|next start|8090' | grep -v grep
```

## 7. EC2 identity and Proxmox ACL checks

Use this after launching a VM from the site when the instance appears but the
expected Proxmox permissions do not.

### 7a. Check whether the off-repo wrapper contains any ACL logic

These searches should show whether the EC2 wrapper or `cloudctl` currently read
the console identity headers and whether they write Proxmox ACLs at all.

```bash
echo "## wrapper identity / acl hooks"
grep -nEi 'X-Console-User|request\.headers|access/acl|pvesh set /access/acl|pveum acl|permission|owner|role' \
  /opt/calpoly-cloud/ec2-api.py /opt/calpoly-cloud/cloudctl
```

If this returns nothing relevant, the launch path is probably creating VMs
without applying per-user Proxmox ownership or ACLs.

### 7b. Inspect the ACL on a launched VM

Set `TARGET_VMID` to a VM created from the console and fetch the full Proxmox
ACL list, then filter it locally for that VM path. The GET endpoint does not
accept `path` as a query filter.

```bash
cd /opt/cloud.calpolysoc

if grep -q $'\r' ./frontend/.env; then
  echo "frontend/.env has CRLF line endings; stripping carriage returns for this shell session"
fi

set -a
source <(tr -d '\r' < ./frontend/.env)
set +a

PROXMOX_BASE="${PROXMOX_API_BASE_URL:-${PROXMOX_PROTOCOL}://${PROXMOX_HOST}:${PROXMOX_PORT}}"
TARGET_VMID=REPLACE_WITH_NEW_VMID

echo "## current acl for vm ${TARGET_VMID}"
curl -sk \
  -H "Authorization: PVEAPIToken=${PROXMOX_TOKEN_ID}=${PROXMOX_TOKEN_SECRET}" \
  "${PROXMOX_BASE}/api2/json/access/acl"
echo

echo "## filtered acl rows for vm ${TARGET_VMID}"
curl -sk \
  -H "Authorization: PVEAPIToken=${PROXMOX_TOKEN_ID}=${PROXMOX_TOKEN_SECRET}" \
  "${PROXMOX_BASE}/api2/json/access/acl" \
  | python3 -c 'import json, sys; vm_path = sys.argv[1]; payload = json.load(sys.stdin); rows = [row for row in payload.get("data", []) if row.get("path") == vm_path]; print(json.dumps(rows, indent=2))' "/vms/${TARGET_VMID}"
echo
```

If `python3` is unavailable but `jq` is installed, this equivalent filter also
works:

```bash
curl -sk \
  -H "Authorization: PVEAPIToken=${PROXMOX_TOKEN_ID}=${PROXMOX_TOKEN_SECRET}" \
  "${PROXMOX_BASE}/api2/json/access/acl" \
  | jq --arg vm_path "/vms/${TARGET_VMID}" '.data[] | select(.path == $vm_path)'
```

If there is no ACL entry for the launched VM path or only unrelated principals
are present, the per-user assignment step is missing.

If this returns a row like `{"path":"/vms/<vmid>","type":"user","roleid":"PVEVMUser","ugid":"<principal>"}`
after a manual ACL write, that confirms the Proxmox principal is valid and the
missing behavior is in the launch wrapper rather than in Proxmox itself.

### 7c. Validate the principal you plan to assign

The console forwards identity like `tphao@calpolysoc`, but Proxmox ACLs can
only be written against a real Proxmox user, group, or token principal. That
means the wrapper must either:

- map `X-Console-User-Email` to an existing Proxmox user such as `tphao@pam`
- or map the caller to a Proxmox group and assign the ACL to that group

Do not assume the Keycloak email string is itself a valid Proxmox principal
unless your Proxmox realm is actually configured that way.

### 7d. Manual ACL fix example

If you already know the correct Proxmox user or group for the launched VM, this
manual API call proves whether the missing piece is simply the wrapper not
writing the ACL.

User example:

```bash
TARGET_VMID=REPLACE_WITH_NEW_VMID
TARGET_PROXMOX_USER=REPLACE_WITH_REAL_PROXMOX_USER

curl -sk -X PUT \
  -H "Authorization: PVEAPIToken=${PROXMOX_TOKEN_ID}=${PROXMOX_TOKEN_SECRET}" \
  --data-urlencode "path=/vms/${TARGET_VMID}" \
  --data-urlencode "users=${TARGET_PROXMOX_USER}" \
  --data-urlencode "roles=PVEVMUser" \
  --data-urlencode "propagate=0" \
  "${PROXMOX_BASE}/api2/json/access/acl"
echo
```

Group example:

```bash
TARGET_VMID=REPLACE_WITH_NEW_VMID
TARGET_PROXMOX_GROUP=REPLACE_WITH_REAL_PROXMOX_GROUP

curl -sk -X PUT \
  -H "Authorization: PVEAPIToken=${PROXMOX_TOKEN_ID}=${PROXMOX_TOKEN_SECRET}" \
  --data-urlencode "path=/vms/${TARGET_VMID}" \
  --data-urlencode "groups=${TARGET_PROXMOX_GROUP}" \
  --data-urlencode "roles=PVEVMUser" \
  --data-urlencode "propagate=0" \
  "${PROXMOX_BASE}/api2/json/access/acl"
echo
```

If the user should be able to reconfigure the VM rather than only use it, swap
`PVEVMUser` for the correct higher-privilege role such as `PVEVMAdmin`.

For this endpoint, a response body of `{"data":null}` indicates the ACL write
was accepted successfully.

### 7e. What the wrapper should do

The current console forwards these trusted headers on `/api/ec2/*` requests:

- `X-Console-User-Id`
- `X-Console-User-Email`
- `X-Console-User-Name`
- `X-Console-User-Roles`
- `X-Console-Auth-Source`

The off-repo EC2 wrapper should read those headers during `POST /instances`,
return a pending job immediately, map the caller to a real Proxmox principal,
create the VM in the background, and then call `PUT /access/acl` for
`/vms/<vmid>` with the intended role.

If the site reports a timeout but Proxmox still clones the VM, that usually
means the host is still running the old synchronous wrapper. After redeploying,
verify the new behavior with:

```bash
echo "## wrapper health"
curl -sS http://127.0.0.1:8090/health; echo

echo
echo "## wrapper async markers"
grep -nE 'JOBS =|@app.get\("/jobs/<job_id>"\)|threading.Thread|state="pending"' /opt/calpoly-cloud/ec2-api.py

echo
echo "## wrapper launch logs"
journalctl -u calpoly-ec2-api --since '10 minutes ago' --no-pager | tail -n 80
```

Expected runtime shape:

- the initial browser `POST /api/ec2/instances` returns quickly with `202`
- journald shows `[launch]` and either `[launch-acl]` or `[launch-warning]`
- `GET /api/ec2/jobs/<job_id>` transitions through `pending` or `running` to
  `succeeded`, `warning`, or `failed`

## Paste-back guidance

The most useful sections to paste first are:

1. `console env (non-secret)`
2. `required secret presence`
3. `listeners`
4. `container -> internal api`
5. `container -> keycloak discovery`
6. `proxied ec2 health`
7. `local ec2 wrapper health`
8. `proxmox qemu list on configured node`
9. `systemd units`
10. `matching processes`

That is enough to remove most of the remaining deployment guesswork for the
next implementation pass.