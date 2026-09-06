import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { ec2 } from "@/lib/api";
import { VolumeWorkspace } from "./_components/volume-workspace";

export const dynamic = "force-dynamic";

export default async function VolumesPage() {
  const session = await auth();
  const [volumesResult, instancesResult] = await Promise.all([
    ec2.listVolumes(session?.user),
    ec2.list(session?.user),
  ]);
  const instances = Array.isArray(instancesResult)
    ? instancesResult
    : instancesResult.instances ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Volumes"
        description="Create, attach, detach, and delete persistent VM disks."
      />
      <VolumeWorkspace
        initialVolumes={volumesResult.volumes ?? []}
        initialInstances={instances}
      />
    </div>
  );
}
