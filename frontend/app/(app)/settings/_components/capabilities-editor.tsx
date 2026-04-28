"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type Ec2Capabilities,
  type ImageCatalogItem,
  formatInstanceTypeSummary,
} from "@/lib/ec2-catalog";
import {
  buildProxmoxBootstrapPrelude,
  buildProxmoxTemplateCommands,
} from "@/lib/proxmox-template-commands";

export function CapabilitiesEditor({
  initialCapabilities,
}: {
  initialCapabilities: Ec2Capabilities;
}) {
  const router = useRouter();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isRefreshing, startRefresh] = useTransition();

  async function copyCommand(command: string, key: string) {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      setCopiedKey(null);
    }
  }

  function refreshCapabilities() {
    startRefresh(() => {
      router.refresh();
    });
  }

  const commandReadyImages = initialCapabilities.images.filter(
    (image) => image.downloadUrl.trim().length > 0,
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Live Proxmox catalog</CardTitle>
            <CardDescription>
              Templates are discovered directly from Proxmox on each request. The runtime JSON catalog and save flow are gone.
            </CardDescription>
          </div>
          <Button type="button" variant="outline" onClick={refreshCapabilities} disabled={isRefreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh from Proxmox
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryStat label="Source" value={initialCapabilities.source === "proxmox" ? "Live Proxmox" : initialCapabilities.source} />
          <SummaryStat label="Templates" value={String(initialCapabilities.images.length)} />
          <SummaryStat label="Default image" value={initialCapabilities.serverProfile.imageId} />
          <SummaryStat label="Node / storage" value={`${initialCapabilities.serverProfile.node} / ${initialCapabilities.serverProfile.storage}`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Instance sizes</CardTitle>
          <CardDescription>
            Launch sizes still come from the console defaults. Image and template mappings now come from Proxmox.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
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
        <CardHeader>
          <CardTitle>Discovered templates</CardTitle>
          <CardDescription>
            Only template VMs returned by Proxmox are exposed to the launch flow.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {initialCapabilities.images.map((image) => (
            <TemplateCard key={image.id} image={image} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bootstrap commands</CardTitle>
          <CardDescription>
            Known cloud-image URLs are inferred for standard distributions. Custom templates still appear above even when a bootstrap URL cannot be reconstructed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CommandBlock
            title="Node preparation"
            description="Run once on the Proxmox node before importing cloud images."
            command={buildProxmoxBootstrapPrelude(initialCapabilities.serverProfile)}
            copied={copiedKey === "prelude"}
            onCopy={() =>
              copyCommand(
                buildProxmoxBootstrapPrelude(initialCapabilities.serverProfile),
                "prelude",
              )
            }
          />

          {commandReadyImages.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No bootstrap commands are available because none of the discovered templates matched a known cloud image URL.
            </div>
          ) : (
            commandReadyImages.map((image) => {
              const command = buildProxmoxTemplateCommands(
                image,
                initialCapabilities.serverProfile,
              );
              return (
                <CommandBlock
                  key={image.id}
                  title={`${image.displayName} (${image.id})`}
                  description={`Template ${image.templateName} / VMID ${image.templateVmid}`}
                  command={command}
                  copied={copiedKey === image.id}
                  onCopy={() => copyCommand(command, image.id)}
                />
              );
            })
          )}
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

function CommandBlock({
  title,
  description,
  command,
  copied,
  onCopy,
}: {
  title: string;
  description: string;
  command: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="font-medium">{title}</div>
          <div className="text-sm text-muted-foreground">{description}</div>
        </div>
        <Button type="button" variant="outline" onClick={onCopy}>
          <Copy className="mr-2 h-4 w-4" />
          {copied ? "Copied" : "Copy commands"}
        </Button>
      </div>
      <pre className="mt-4 overflow-x-auto rounded-md border bg-muted/30 p-4 text-xs leading-6">
        {command}
      </pre>
    </div>
  );
}