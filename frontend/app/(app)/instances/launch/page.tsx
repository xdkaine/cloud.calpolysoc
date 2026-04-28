import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LaunchForm } from "./_components/launch-form";
import {
  formatInstanceTypeSummary,
  getImageCatalog,
} from "@/lib/ec2-catalog";
import { getEc2Capabilities } from "@/lib/ec2-capabilities";

export const dynamic = "force-dynamic";

function sourceBadgeLabel(source: "defaults" | "env" | "proxmox") {
  if (source === "proxmox") return "Live Proxmox";
  if (source === "env") return "Environment";
  return "Defaults";
}

export default async function LaunchPage() {
  const capabilities = await getEc2Capabilities();
  const selectedImage =
    getImageCatalog(capabilities.images, capabilities.serverProfile.imageId) ??
    capabilities.images[0];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Launch instance"
        description="Launch against the live Proxmox template catalog and the active EC2 size profile"
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Configure instance</CardTitle>
            <CardDescription>
              Backed by the active Proxmox cloud-init templates and the console's launch-size catalog.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LaunchForm capabilities={capabilities} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>Current server profile</CardTitle>
                <Badge variant="secondary">{sourceBadgeLabel(capabilities.source)}</Badge>
              </div>
              <CardDescription>
                These values are read at request time, so newly discovered templates appear without rebuilding the console.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <ProfileRow label="Image" value={`${selectedImage.id} (${selectedImage.displayName})`} />
              <ProfileRow label="Template" value={`${selectedImage.templateName} (${selectedImage.templateVmid})`} />
              <ProfileRow label="Node" value={capabilities.serverProfile.node} />
              <ProfileRow label="Storage" value={capabilities.serverProfile.storage} />
              <ProfileRow label="Bridge" value={capabilities.serverProfile.bridge} />
              <ProfileRow label="Default user" value={selectedImage.username} />
              <ProfileRow label="Region" value={capabilities.serverProfile.region} />
              <ProfileRow label="Launch fields" value={capabilities.serverProfile.launchFields.join(", ")} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Supported sizes</CardTitle>
              <CardDescription>
                Instance sizes are defined in the console while images are discovered live from Proxmox.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {capabilities.instanceCatalog.map((item) => (
                <div key={item.value} className="rounded-lg border p-3">
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
        </div>
      </div>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
