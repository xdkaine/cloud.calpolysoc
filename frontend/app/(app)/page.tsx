import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { ec2 } from "@/lib/api";
import { listBuckets, listQueues, listTables } from "@/lib/aws";
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
  const [instances, buckets, tables, queues, health] = await Promise.all([
    safe(async () => {
      const r = await ec2.list();
      return Array.isArray(r) ? r : (r as any).instances ?? [];
    }, [] as any[]),
    safe(listBuckets, [] as Array<{ name: string }>),
    safe(listTables, [] as Array<{ name: string }>),
    safe(listQueues, [] as Array<{ name: string }>),
    safe(ec2.health, { status: "unknown" } as { status: string }),
  ]);

  const tiles = [
    { label: "EC2 Instances", count: instances.data.length, icon: Server, href: "/instances", err: instances.error },
    { label: "S3 Buckets", count: buckets.data.length, icon: HardDrive, href: "/s3", err: buckets.error },
    { label: "DynamoDB Tables", count: tables.data.length, icon: Database, href: "/dynamodb", err: tables.error },
    { label: "SQS Queues", count: queues.data.length, icon: Inbox, href: "/sqs", err: queues.error },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Internal CalPolySOC private cloud overview"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Link key={t.label} href={t.href}>
              <Card className="transition-colors hover:border-primary/50">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {t.label}
                  </CardTitle>
                  <Icon className="h-4 w-4 text-muted-foreground" />
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
                  <div className="mt-2 flex items-center text-xs text-muted-foreground">
                    view <ArrowRight className="ml-1 h-3 w-3" />
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
            <CardTitle>Service status</CardTitle>
            <CardDescription>Live health of internal endpoints</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="EC2 API" status={health.error ? "down" : "ok"} note="api.cloud.calpolysoc.org/ec2" />
            <Row label="Floci (S3 / DDB / SQS)" status={buckets.error && tables.error && queues.error ? "down" : "ok"} note="api.cloud.calpolysoc.org" />
            <Row label="Console" status="ok" note="cloud.calpolysoc.org" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick links</CardTitle>
            <CardDescription>Common actions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Link className="block rounded-md border p-3 hover:border-primary/50" href="/instances/launch">
              Launch a new EC2 instance
            </Link>
            <Link className="block rounded-md border p-3 hover:border-primary/50" href="/instances">
              Manage running instances
            </Link>
            <Link className="block rounded-md border p-3 hover:border-primary/50" href="/s3">
              Browse S3 buckets
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, status, note }: { label: string; status: "ok" | "down"; note: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{note}</div>
      </div>
      <span
        className={
          status === "ok"
            ? "inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-600"
            : "inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive"
        }
      >
        <span
          className={
            "h-1.5 w-1.5 rounded-full " +
            (status === "ok" ? "bg-emerald-500" : "bg-destructive")
          }
        />
        {status === "ok" ? "operational" : "unreachable"}
      </span>
    </div>
  );
}
