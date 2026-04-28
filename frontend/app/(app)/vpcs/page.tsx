import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ec2, type Instance } from "@/lib/api";
import { getEc2Capabilities } from "@/lib/ec2-capabilities";
import { getConsoleAccess } from "@/lib/console-access";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await auth();
  const access = getConsoleAccess(session?.user?.roles);
  const capabilities = await getEc2Capabilities();

  let instances: Instance[] = [];
  let error: string | null = null;
  try {
    const response = await ec2.list();
    instances = Array.isArray(response) ? response : response.instances ?? [];
  } catch (err: any) {
    error = err?.message ?? "Failed to load instance attachments";
  }

  const runningInstances = instances.filter((instance) => instance.status === "running");
  const attachedNodes = [...new Set(instances.map((instance) => instance.node).filter(Boolean))];
  const fabricId = `vpc-${capabilities.serverProfile.region}-${capabilities.serverProfile.bridge}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="VPCs"
        description={`Shared network fabrics mapped to the live Proxmox bridge profile for the ${access.label.toLowerCase()}.`}
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <SummaryCard
          title="Primary fabric"
          value={fabricId}
          description={`Bridge ${capabilities.serverProfile.bridge} on node ${capabilities.serverProfile.node}`}
          tone="primary"
        />
        <SummaryCard
          title="Attached workloads"
          value={String(instances.length)}
          description={`${runningInstances.length} running across ${attachedNodes.length || 1} nodes`}
        />
        <SummaryCard
          title="Exposure model"
          value="VPN-only"
          description="Console and API entrypoints stay inside the CalPolySOC private network boundary."
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Workload attachments</CardTitle>
            <CardDescription>
              Current instances sharing the primary bridge-backed fabric.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {error ? (
              <div className="p-6 text-sm text-destructive">{error}</div>
            ) : instances.length === 0 ? (
              <EmptyState text="No instances are attached yet. Launch compute to populate the network fabric view." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Node</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Fabric</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instances.map((instance) => (
                    <TableRow key={instance.vmid}>
                      <TableCell className="font-medium">{instance.name}</TableCell>
                      <TableCell>{statusBadge(instance.status)}</TableCell>
                      <TableCell>{instance.node ?? capabilities.serverProfile.node}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {instance.ip ?? "Pending"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {capabilities.serverProfile.bridge}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Fabric profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <InfoRow label="Region" value={capabilities.serverProfile.region} />
              <InfoRow label="Bridge" value={capabilities.serverProfile.bridge} />
              <InfoRow label="Node" value={capabilities.serverProfile.node} />
              <InfoRow label="Storage" value={capabilities.serverProfile.storage} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Connectivity lanes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <LaneCard
                title="North-south ingress"
                body="cloud.calpolysoc.org terminates the user-facing console through Nginx on the aws VM."
              />
              <LaneCard
                title="Service plane"
                body="api.cloud.calpolysoc.org carries EC2 wrapper and Floci traffic for instances, storage, and queues."
              />
              <LaneCard
                title="Hypervisor control"
                body="The live image catalog and compute profile are discovered from Proxmox on the configured private node."
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  description,
  tone,
}: {
  title: string;
  value: string;
  description: string;
  tone?: "primary";
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className={tone === "primary" ? "text-primary" : undefined}>
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{description}</CardContent>
    </Card>
  );
}

function LaneCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="font-medium text-foreground">{title}</div>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="font-medium">{label}</div>
      <div className="font-mono text-xs text-muted-foreground">{value}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="p-12 text-center text-sm text-muted-foreground">{text}</div>
  );
}

function statusBadge(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "running") return <Badge variant="success">running</Badge>;
  if (normalized === "stopped") return <Badge variant="secondary">stopped</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}
