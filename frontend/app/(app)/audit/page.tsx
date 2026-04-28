import { auth } from "@/auth";
import AccessDenied from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ec2 } from "@/lib/api";
import { getConsoleAccess } from "@/lib/console-access";
import { getEc2Capabilities } from "@/lib/ec2-capabilities";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await auth();
  const access = getConsoleAccess(session?.user?.roles);
  if (!access.canViewAudit) {
    return (
      <AccessDenied
        title="Audit logs"
        description="Platform-wide activity, customer actions, and control-plane traces are staff-only views."
      />
    );
  }

  const capabilities = await getEc2Capabilities();
  const roles = session?.user?.roles ?? [];

  let ec2Health = "unknown";
  let ec2Error: string | null = null;
  try {
    const result = await ec2.health();
    ec2Health = result.status;
  } catch (err: any) {
    ec2Health = "degraded";
    ec2Error = err?.message ?? "Health check failed";
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit Logs"
        description="Operational audit readiness, current actor context, and control-plane status for staff"
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Actor context</CardTitle>
              <CardDescription>
                The currently authenticated operator and the role mapping that unlocked this surface.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <InfoRow
                label="Account"
                value={session?.user?.email ?? session?.user?.name ?? "Unavailable"}
              />
              <InfoRow label="Subject" value={session?.user?.id ?? "Unavailable"} />
              <InfoRow label="Audience" value={access.label} />
              <div className="rounded-md border p-3">
                <div className="font-medium">Roles</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {roles.length ? (
                    roles.map((role) => (
                      <Badge key={role} variant="outline" className="font-mono">
                        {role}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      No roles were extracted from the current session.
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Observable control-plane signals</CardTitle>
              <CardDescription>
                What the console can currently verify live without a dedicated audit event store.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <SignalCard
                title="EC2 wrapper health"
                badge={ec2Health}
                tone={ec2Health === "healthy" ? "success" : "secondary"}
                body={ec2Error ?? "The EC2 control plane responded to the live health probe."}
              />
              <SignalCard
                title="Catalog source"
                badge={capabilities.source === "proxmox" ? "Live Proxmox" : capabilities.source}
                tone={capabilities.source === "proxmox" ? "success" : "secondary"}
                body={`Region ${capabilities.serverProfile.region}, node ${capabilities.serverProfile.node}, bridge ${capabilities.serverProfile.bridge}.`}
              />
              <SignalCard
                title="Current gap"
                badge="No persistent feed"
                tone="secondary"
                body="Upstream services are not yet emitting a centralized audit stream, so this page focuses on live actor and control-plane observability instead of historical logs."
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Coverage map</CardTitle>
            <CardDescription>
              Which actions are currently observable through the console surface.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <CoverageRow
              title="Compute lifecycle"
              body="Instance launch, start, stop, and terminate flows go through the EC2 wrapper and are visible to operator health checks."
            />
            <CoverageRow
              title="Storage and messaging"
              body="S3, DynamoDB, and SQS mutations now run through authenticated console routes instead of static read-only pages."
            />
            <CoverageRow
              title="Access surfaces"
              body="Console audience and admin/staff gates are derived from live Keycloak roles resolved into the current session."
            />
            <CoverageRow
              title="Remaining backend work"
              body="Historical operator/customer event retention and per-resource ownership trails still need upstream implementation."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="font-medium">{label}</div>
      <div className="max-w-[16rem] truncate text-right text-xs text-muted-foreground">
        {value}
      </div>
    </div>
  );
}

function SignalCard({
  title,
  badge,
  tone,
  body,
}: {
  title: string;
  badge: string;
  tone: "success" | "secondary";
  body: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <div className="font-medium text-foreground">{title}</div>
        <Badge variant={tone === "success" ? "success" : "secondary"}>{badge}</Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function CoverageRow({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="font-medium text-foreground">{title}</div>
      <p className="mt-2">{body}</p>
    </div>
  );
}
