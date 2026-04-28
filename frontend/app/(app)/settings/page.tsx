import { auth } from "@/auth";
import AccessDenied from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEc2Capabilities } from "@/lib/ec2-capabilities";
import { getConsoleAccess } from "@/lib/console-access";
import { isProxmoxConfigured } from "@/lib/proxmox";
import { CapabilitiesEditor } from "./_components/capabilities-editor";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth();
  const access = getConsoleAccess(session?.user?.roles);
  if (!access.canAccessAdmin) {
    return (
      <AccessDenied
        title="Platform settings"
        description="Image catalogs, template bootstrap commands, and service-level controls live here."
      />
    );
  }

  const capabilities = await getEc2Capabilities();
  const proxmoxConfigured = isProxmoxConfigured();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Platform settings"
        description="Console configuration, live image catalog, and template bootstrap tooling for staff"
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <div className="space-y-6">
          <CapabilitiesEditor initialCapabilities={capabilities} />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Endpoints</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-3 text-sm">
                <Row k="Console" v="https://cloud.calpolysoc.org" />
                <Row k="Internal API" v="http://api.cloud.calpolysoc.org" />
                <Row k="EC2 API" v="http://api.cloud.calpolysoc.org/ec2" />
                <Row k="Capabilities API" v="https://cloud.calpolysoc.org/api/ec2/capabilities" />
                <Row k="SSO Issuer" v="https://auth.calpolysoc.org/realms/calpolysoc" />
                <Row k="Region" v={capabilities.serverProfile.region} />
                <Row k="Active image" v={capabilities.serverProfile.imageId} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Live catalog status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <StatusRow
                label="Catalog source"
                value={capabilities.source === "proxmox" ? "Live Proxmox" : capabilities.source}
              />
              <StatusRow
                label="Proxmox API"
                value={proxmoxConfigured ? "Configured" : "Not configured"}
              />
              <StatusRow
                label="Instance sizes"
                value={String(capabilities.instanceCatalog.length)}
              />
              <StatusRow
                label="Images"
                value={String(capabilities.images.length)}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <dt className="font-medium">{k}</dt>
      <dd className="font-mono text-xs text-muted-foreground">{v}</dd>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="font-medium">{label}</div>
      <div className="text-xs text-muted-foreground">{value}</div>
    </div>
  );
}
