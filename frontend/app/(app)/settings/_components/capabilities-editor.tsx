"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type Ec2Capabilities,
  type ImageCatalogItem,
  formatInstanceTypeSummary,
} from "@/lib/ec2-catalog";

export function CapabilitiesEditor({
  initialCapabilities,
}: {
  initialCapabilities: Ec2Capabilities;
}) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();

  function refreshCapabilities() {
    startRefresh(() => {
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 border-b border-border/80 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-primary">Live Proxmox catalog</CardTitle>
            <CardDescription>
              Templates are discovered directly from Proxmox.
            </CardDescription>
          </div>
          <Button type="button" variant="outline" onClick={refreshCapabilities} disabled={isRefreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh from Proxmox
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2 xl:grid-cols-4">
          <SummaryStat label="Source" value={initialCapabilities.source === "proxmox" ? "Live Proxmox" : initialCapabilities.source} />
          <SummaryStat label="Templates" value={String(initialCapabilities.images.length)} />
          <SummaryStat label="Default image" value={initialCapabilities.serverProfile.imageId} />
          <SummaryStat label="Node / storage" value={`${initialCapabilities.serverProfile.node} / ${initialCapabilities.serverProfile.storage}`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border/80">
          <CardTitle className="text-primary">Instance sizes</CardTitle>
          <CardDescription>
            Sizes available in the launch form.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-6">
          {initialCapabilities.instanceCatalog.map((item) => (
            <div key={item.value} className="rounded-lg border p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">{item.value}</div>
                <Badge variant="outline">{item.family}</Badge>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {formatInstanceTypeSummary(item)}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{item.description}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border/80">
          <CardTitle className="text-primary">Discovered templates</CardTitle>
          <CardDescription>
            Template VMs returned by Proxmox and exposed to launch.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          {initialCapabilities.images.map((image) => (
            <TemplateCard key={image.id} image={image} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-sm font-medium">{value}</div>
    </div>
  );
}

function TemplateCard({ image }: { image: ImageCatalogItem }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="font-medium">{image.displayName}</div>
          <div className="text-sm text-muted-foreground">
            {image.id} mapped to {image.templateName} ({image.templateVmid})
          </div>
        </div>
        <Badge variant={image.cloudInit ? "success" : "outline"}>
          {image.cloudInit ? "cloud-init ready" : "manual cloud-init check needed"}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <TemplateFact label="Default user" value={image.username} />
        <TemplateFact label="Minimum disk" value={`${image.minimumDiskGiB} GiB`} />
        <TemplateFact label="Template VMID" value={String(image.templateVmid)} />
        <TemplateFact
          label="Bootstrap URL"
          value={image.downloadUrl.trim().length > 0 ? "Known" : "Unknown"}
        />
      </div>
    </div>
  );
}

function TemplateFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
