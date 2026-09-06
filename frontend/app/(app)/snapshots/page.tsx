import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { ec2 } from "@/lib/api";
import { SnapshotWorkspace } from "./_components/snapshot-workspace";

export const dynamic = "force-dynamic";

export default async function SnapshotsPage() {
  const session = await auth();
  const [snapshotsResult, volumesResult] = await Promise.all([
    ec2.listSnapshots(session?.user),
    ec2.listVolumes(session?.user),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Snapshots"
        description="Capture volume restore points and restore them as detached volumes."
      />
      <SnapshotWorkspace
        initialSnapshots={snapshotsResult.snapshots ?? []}
        initialVolumes={volumesResult.volumes ?? []}
      />
    </div>
  );
}
