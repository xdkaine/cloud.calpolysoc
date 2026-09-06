import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { ec2 } from "@/lib/api";
import { PostgresWorkspace } from "./_components/postgres-workspace";

export const dynamic = "force-dynamic";

export default async function PostgresPage() {
  const session = await auth();
  const [dbResult, groupsResult] = await Promise.all([
    ec2.listDbInstances(session?.user),
    ec2.listSecurityGroups(session?.user),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Postgres"
        description="Provision VM-backed managed Postgres instances."
      />
      <PostgresWorkspace
        initialInstances={dbResult.db_instances ?? []}
        initialSecurityGroups={groupsResult.security_groups ?? []}
      />
    </div>
  );
}
