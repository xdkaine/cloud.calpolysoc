import Link from "next/link";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { ec2 } from "@/lib/api";
import { listBuckets, listQueues, listTables } from "@/lib/aws";
import { getConsoleAccess } from "@/lib/console-access";
import { visibleInstancesForUser } from "@/lib/instance-access";
import { getTenantIdentity, isTenantResourceName } from "@/lib/tenant";
import { Server, HardDrive, Database, Inbox, ArrowRight, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<{ data: T; error?: string }> {
  try {
    return { data: await fn() };
  } catch (e: any) {
    return { data: fallback, error: e?.message ?? "request failed" };
  }
}

export default async function DashboardPage() {
  const session = await auth();
  const access = getConsoleAccess(session?.user?.roles);
  const identity = session?.user ? getTenantIdentity(session.user) : null;
  const [instances, buckets, tables, queues, health] = await Promise.all([
    safe(async () => {
      const r = await ec2.list(session?.user);
      const upstreamInstances = Array.isArray(r) ? r : (r as any).instances ?? [];
      return visibleInstancesForUser(
        upstreamInstances,
        session?.user,
        false,
      );
    }, [] as any[]),
    safe(async () => {
      const data = await listBuckets();
      return identity
        ? data.filter((item) => isTenantResourceName(item.name, identity))
        : [];
    }, [] as Array<{ name: string }>),
    safe(async () => {
      const data = await listTables();
      return identity
        ? data.filter((item) => isTenantResourceName(item.name, identity))
        : [];
    }, [] as Array<{ name: string }>),
    safe(async () => {
      const data = await listQueues();
      return identity
        ? data.filter((item) => isTenantResourceName(item.name, identity))
        : [];
    }, [] as Array<{ name: string }>),
    safe(ec2.health, { status: "unknown" } as { status: string }),
  ]);

  const tiles = [
    { label: "Your instances", count: instances.data.length, icon: Server, href: "/instances", err: instances.error },
    { label: "Your S3 buckets", count: buckets.data.length, icon: HardDrive, href: "/s3", err: buckets.error },
    { label: "Your DynamoDB tables", count: tables.data.length, icon: Database, href: "/dynamodb", err: tables.error },
    { label: "Your SQS queues", count: queues.data.length, icon: Inbox, href: "/sqs", err: queues.error },
  ];

  const quickLinks = access.canAccessAdmin
    ? [
        { href: "/instances/launch", label: "Provision a new instance" },
        { href: "/instances?scope=fleet", label: "Open fleet instance view" },
        { href: "/settings", label: "Review platform configuration" },
        { href: "/audit", label: "Review audit events" },
      ]
    : [
        { href: "/instances/launch", label: "Launch a new instance" },
        { href: "/instances", label: "Manage your running instances" },
        { href: "/s3", label: "Browse your S3 buckets" },
      ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="A scoped view of your CalPolySOC compute and cloud resources."
        actions={<Badge variant={access.canAccessAdmin ? "secondary" : "outline"}>{access.label}</Badge>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Link key={t.label} href={t.href} className="group">
              <Card className="h-full transition-colors hover:border-primary/50 hover:bg-muted/35">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {t.label}
                  </CardTitle>
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                </CardHeader>
                <CardContent>
                  {t.err ? (
                    <div className="flex items-center gap-2 text-sm text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                      unavailable
                    </div>
                  ) : (
                    <div className="text-3xl font-bold">{t.count}</div>
                  )}
                  <div className="mt-3 flex items-center text-xs font-medium text-primary">
                    Open workspace <ArrowRight className="ml-1 h-3 w-3" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-primary">Service status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="EC2 API" status={health.error ? "down" : "ok"} note="api.cloud.calpolysoc.org/ec2" />
            <Row label="Floci (S3 / DDB / SQS)" status={buckets.error && tables.error && queues.error ? "down" : "ok"} note="api.cloud.calpolysoc.org" />
            <Row label="Console" status="ok" note="cloud.calpolysoc.org" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-primary">{access.canAccessAdmin ? "Control plane" : "Quick links"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {quickLinks.map((item) => (
              <Link
                key={item.href}
                className="flex min-h-11 items-center justify-between rounded-md border border-border/80 px-3 py-2 font-medium hover:border-primary/50 hover:bg-muted/35"
                href={item.href}
              >
                <span>{item.label}</span>
                <ArrowRight className="h-4 w-4 text-primary" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, status, note }: { label: string; status: "ok" | "down"; note: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/80 bg-background p-3">
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{note}</div>
      </div>
      <span
        className={
          status === "ok"
            ? "inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
            : "inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive"
        }
      >
        <span
          className={
            "h-1.5 w-1.5 rounded-full " +
            (status === "ok" ? "bg-primary" : "bg-destructive")
          }
        />
        {status === "ok" ? "operational" : "unreachable"}
      </span>
    </div>
  );
}
