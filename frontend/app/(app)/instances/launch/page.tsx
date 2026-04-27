import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LaunchForm } from "./_components/launch-form";

export default function LaunchPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Launch instance"
        description="Clone a Proxmox cloud-init template into a new VM"
      />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Configure instance</CardTitle>
          <CardDescription>
            Backed by Proxmox template <code className="rounded bg-muted px-1 py-0.5 text-xs">tmpl-ubuntu-2404</code> (VMID 9001).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LaunchForm />
        </CardContent>
      </Card>
    </div>
  );
}
