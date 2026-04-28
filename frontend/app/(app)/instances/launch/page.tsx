import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
        description="Choose an approved image and size, then provision a Proxmox-backed server in your account scope."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <Card>
          <CardHeader className="border-b border-border/80">
            <CardTitle className="text-primary">Configure instance</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <LaunchForm capabilities={capabilities} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="border-b border-border/80">
              <div className="flex items-center gap-2">
                <CardTitle className="text-primary">Server profile</CardTitle>
                <Badge variant="secondary">{sourceBadgeLabel(capabilities.source)}</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 xl:grid-cols-1">
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
            <CardHeader className="border-b border-border/80">
              <CardTitle className="text-primary">Supported sizes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-6">
              {capabilities.instanceCatalog.map((item) => (
                <div key={item.value} className="rounded-lg border border-border/80 bg-background p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{item.value}</div>
                    <Badge variant="outline">{item.family}</Badge>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {formatInstanceTypeSummary(item)}
                  </div>
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
