import Link from "next/link";
import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ec2, type Instance } from "@/lib/api";
import {
  formatInstanceTypeSummary,
  getInstanceTypeCatalog,
  memoryMiBToBytes,
} from "@/lib/ec2-catalog";
import { getEc2Capabilities } from "@/lib/ec2-capabilities";
import { getConsoleAccess } from "@/lib/console-access";
import {
  isInstanceOwnedByUser,
  visibleInstancesForUser,
} from "@/lib/instance-access";
import { InstanceActions } from "./_components/instance-actions";
import { Rocket } from "lucide-react";

export const dynamic = "force-dynamic";

function formatUptime(seconds?: number) {
  if (!seconds) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function formatMem(bytes?: number) {
  if (!bytes) return "—";
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} GiB`;
  return `${(bytes / 1024 / 1024).toFixed(0)} MiB`;
}

function statusBadge(status: string) {
  const s = status?.toLowerCase();
  if (s === "running")
    return <Badge variant="success">running</Badge>;
  if (s === "stopped")
    return <Badge variant="secondary">stopped</Badge>;
  if (s === "pending")
    return <Badge variant="outline">pending</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function ownerLabel(
  instance: Instance,
  user: Parameters<typeof isInstanceOwnedByUser>[1],
  canAccessAdmin: boolean,
) {
  if (!canAccessAdmin) {
    return isInstanceOwnedByUser(instance, user) ? "you" : "direct access";
  }

  return (
    instance.owner?.principal ??
    instance.owner?.email ??
    instance.owner_principal ??
    instance.owner_email ??
    (instance.acl_entries?.length ? "direct access" : "unassigned")
  );
}

export default async function InstancesPage({
  searchParams,
}: {
  searchParams?: Promise<{ scope?: string }>;
}) {
  const session = await auth();
  const access = getConsoleAccess(session?.user?.roles);
  const params = (await searchParams) ?? {};
  const fleetScope = access.canAccessAdmin && params.scope === "fleet";
  const capabilities = await getEc2Capabilities();
  let instances: Instance[] = [];
  let error: string | null = null;
  try {
    const r = await ec2.list(session?.user);
    const upstreamInstances = Array.isArray(r) ? r : (r as any).instances ?? [];
    instances = visibleInstancesForUser(
      upstreamInstances,
      session?.user,
      fleetScope,
    );
  } catch (e: any) {
    error = e?.message ?? "failed to load instances";
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={fleetScope ? "Fleet instances" : "Your instances"}
        description={
          fleetScope
            ? "Staff view across assigned and unassigned Proxmox-backed instances."
            : "Launch, inspect, start, stop, and terminate your assigned instances."
        }
        actions={
          <>
            {access.canAccessAdmin ? (
              <Button asChild variant="outline">
                <Link href={fleetScope ? "/instances" : "/instances?scope=fleet"}>
                  {fleetScope ? "My instances" : "Fleet view"}
                </Link>
              </Button>
            ) : null}
            <Button asChild>
              <Link href="/instances/launch">
                <Rocket className="mr-2 h-4 w-4" />
                Launch instance
              </Link>
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader className="border-b border-border/80">
          <CardTitle className="text-primary">
            {fleetScope ? "Fleet inventory" : "Instance inventory"}
          </CardTitle>
          <CardDescription>
            Resource sizing is inferred from the live Proxmox configuration and launch catalog.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-sm text-destructive">{error}</div>
          ) : instances.length === 0 ? (
            <div className="p-12 text-center">
              <div className="text-sm text-muted-foreground">
                No instances yet.
              </div>
              <Button asChild className="mt-4">
                <Link href="/instances/launch">
                  <Rocket className="mr-2 h-4 w-4" />
                  Launch your first instance
                </Link>
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/60">
                <TableRow>
                  <TableHead>VMID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>vCPU</TableHead>
                  <TableHead>Memory</TableHead>
                  <TableHead>Uptime</TableHead>
                  <TableHead>Node</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {instances.map((i) => {
                  const typeInfo = getInstanceTypeCatalog(
                    capabilities.instanceCatalog,
                    i.instance_type,
                  );
                  const cpuCount = i.cpus ?? typeInfo?.vcpus;
                  const memory =
                    i.maxmem ??
                    (typeInfo ? memoryMiBToBytes(typeInfo.memoryMiB) : undefined);

                  return (
                    <TableRow key={i.vmid}>
                      <TableCell className="font-mono text-xs">{i.vmid}</TableCell>
                      <TableCell className="font-medium">{i.name}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                        {ownerLabel(i, session?.user, fleetScope)}
                      </TableCell>
                      <TableCell>{statusBadge(i.status)}</TableCell>
                      <TableCell>
                        <div>{i.instance_type ?? "—"}</div>
                        {typeInfo ? (
                          <div className="text-xs text-muted-foreground">
                            {formatInstanceTypeSummary(typeInfo)}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>{cpuCount ?? "—"}</TableCell>
                      <TableCell>{formatMem(memory)}</TableCell>
                      <TableCell>{formatUptime(i.uptime)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {i.node ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <InstanceActions vmid={i.vmid} status={i.status} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
