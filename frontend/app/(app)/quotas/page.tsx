import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ec2, type CapacitySummary, type QuotaSummary } from "@/lib/api";

export const dynamic = "force-dynamic";

const quotaLabels: Record<string, string> = {
  instances: "Instances",
  vcpus: "vCPU",
  memory_mib: "Memory MiB",
  volume_gib: "Volume GiB",
  db_instances: "Postgres DBs",
  cache_instances: "Redis caches",
};

export default async function QuotasPage() {
  const session = await auth();
  let quotas: QuotaSummary | null = null;
  let capacity: CapacitySummary | null = null;
  let error: string | null = null;

  try {
    quotas = await ec2.quotas(session?.user);
  } catch (exc: any) {
    error = exc?.message ?? "Failed to load quotas";
  }

  try {
    const result = await ec2.capacity();
    capacity = result.capacity;
  } catch {
    capacity = null;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Quotas"
        description="Current control-plane usage and live Proxmox capacity."
      />

      {error ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
        <Card>
          <CardHeader className="border-b border-border/80">
            <CardTitle className="text-primary">Quota usage</CardTitle>
            <CardDescription>
              Limits are configured by environment and apply per principal.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 p-6 sm:grid-cols-2">
            {Object.keys(quotaLabels).map((key) => {
              const used = quotas?.usage?.[key] ?? 0;
              const limit = quotas?.limits?.[key];
              return (
                <div key={key} className="rounded-md border p-4">
                  <div className="text-sm font-medium">{quotaLabels[key]}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="font-mono text-lg">
                      {String(used)}
                      <span className="text-sm text-muted-foreground">
                        {" / "}
                        {limit ? String(limit) : "unlimited"}
                      </span>
                    </div>
                    <Badge variant={limit && Number(used) >= limit ? "destructive" : "outline"}>
                      {limit ? `${Math.round((Number(used) / limit) * 100)}%` : "open"}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/80">
            <CardTitle className="text-primary">Proxmox capacity</CardTitle>
            <CardDescription>
              Snapshot from the configured Proxmox node and storage pool.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-6 text-sm">
            <Row label="Node" value={capacity?.node ?? "unavailable"} />
            <Row
              label="CPU load"
              value={
                typeof capacity?.status?.cpu === "number"
                  ? `${Math.round(capacity.status.cpu * 100)}%`
                  : "unavailable"
              }
            />
            <Row
              label="Memory"
              value={formatBytes(
                capacity?.status?.memory?.used,
                capacity?.status?.memory?.total,
              )}
            />
            <div className="rounded-md border p-3">
              <div className="font-medium">Storage</div>
              <div className="mt-3 space-y-2">
                {(capacity?.storage ?? []).map((storage) => (
                  <div key={storage.storage} className="flex items-center justify-between gap-4">
                    <span className="font-mono text-xs">{storage.storage}</span>
                    <span className="text-right text-xs text-muted-foreground">
                      {formatBytes(storage.used, storage.total)}
                    </span>
                  </div>
                ))}
                {(capacity?.storage ?? []).length === 0 ? (
                  <div className="text-xs text-muted-foreground">unavailable</div>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border p-3">
      <div className="font-medium">{label}</div>
      <div className="max-w-[16rem] truncate text-right font-mono text-xs text-muted-foreground">
        {value}
      </div>
    </div>
  );
}

function formatBytes(used?: number, total?: number) {
  if (!used || !total) return "unavailable";
  return `${toGiB(used)} / ${toGiB(total)}`;
}

function toGiB(value: number) {
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GiB`;
}
