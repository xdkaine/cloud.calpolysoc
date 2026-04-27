import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { InstanceActions } from "./_components/instance-actions";

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

export default async function InstancesPage() {
  let instances: Instance[] = [];
  let error: string | null = null;
  try {
    const r = await ec2.list();
    instances = Array.isArray(r) ? r : (r as any).instances ?? [];
  } catch (e: any) {
    error = e?.message ?? "failed to load instances";
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="EC2 Instances"
        description="Proxmox-backed virtual machines"
        actions={
          <Button asChild>
            <Link href="/instances/launch">Launch instance</Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-sm text-destructive">{error}</div>
          ) : instances.length === 0 ? (
            <div className="p-12 text-center">
              <div className="text-sm text-muted-foreground">
                No instances yet.
              </div>
              <Button asChild className="mt-4">
                <Link href="/instances/launch">Launch your first instance</Link>
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>VMID</TableHead>
                  <TableHead>Name</TableHead>
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
                {instances.map((i) => (
                  <TableRow key={i.vmid}>
                    <TableCell className="font-mono text-xs">{i.vmid}</TableCell>
                    <TableCell className="font-medium">{i.name}</TableCell>
                    <TableCell>{statusBadge(i.status)}</TableCell>
                    <TableCell>{i.instance_type ?? "—"}</TableCell>
                    <TableCell>{i.cpus ?? "—"}</TableCell>
                    <TableCell>{formatMem(i.maxmem)}</TableCell>
                    <TableCell>{formatUptime(i.uptime)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {i.node ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <InstanceActions vmid={i.vmid} status={i.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
