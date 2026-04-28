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
    error = err?.message ?? "Failed to load workload exposure data";
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Security Groups"
        description={`Current ingress and egress guardrails for the ${access.label.toLowerCase()} network model.`}
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <PolicyCard
          title="Console ingress"
          badge="TLS"
          body="User traffic enters through Nginx on cloud.calpolysoc.org and stays inside the private/VPN boundary."
        />
        <PolicyCard
          title="Service access"
          badge={capabilities.serverProfile.bridge}
          body="Workloads reach EC2 wrapper and Floci services over the shared internal bridge and regional service plane."
        />
        <PolicyCard
          title="Operator control"
          badge={access.canAccessAdmin ? "Admin" : "Client"}
          body="Privileged surfaces such as settings and audit remain role-gated through Keycloak-derived console access."
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Workload exposure summary</CardTitle>
            <CardDescription>
              Current compute instances sharing the platform firewall posture.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {error ? (
              <div className="p-6 text-sm text-destructive">{error}</div>
            ) : instances.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                No instances are currently present, so only the platform guardrails apply.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Instance</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Node</TableHead>
                    <TableHead>Default posture</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instances.map((instance) => (
                    <TableRow key={instance.vmid}>
                      <TableCell className="font-medium">{instance.name}</TableCell>
                      <TableCell>{statusBadge(instance.status)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {instance.ip ?? "Pending"}
                      </TableCell>
                      <TableCell>{instance.node ?? capabilities.serverProfile.node}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        SSH and service ports should remain VPN-scoped unless explicitly published through the control plane.
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Current policy model</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <RuleCard
              title="Default workload rule"
              body="Instances attach to the shared bridge and inherit the platform default: private east-west traffic is allowed, but public exposure should be deliberate and proxied."
            />
            <RuleCard
              title="Control-plane rule"
              body="cloud.calpolysoc.org and api.cloud.calpolysoc.org remain the intended ingress points for console and service access."
            />
            <RuleCard
              title="Future direction"
              body="Per-project security groups still need backend ownership and firewall primitives; this page now exposes the live posture instead of a placeholder." 
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PolicyCard({
  title,
  badge,
  body,
}: {
  title: string;
  badge: string;
  body: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <div className="pt-1">
          <Badge variant="secondary">{badge}</Badge>
        </div>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{body}</CardContent>
    </Card>
  );
}

function RuleCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="font-medium text-foreground">{title}</div>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function statusBadge(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "running") return <Badge variant="success">running</Badge>;
  if (normalized === "stopped") return <Badge variant="secondary">stopped</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}
