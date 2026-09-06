import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { ec2 } from "@/lib/api";
import { SecurityGroupWorkspace } from "./_components/security-group-workspace";

export const dynamic = "force-dynamic";

export default async function SecurityGroupsPage() {
  const session = await auth();
  const [vpcsResult, groupsResult] = await Promise.all([
    ec2.listVpcs(session?.user),
    ec2.listSecurityGroups(session?.user),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Security Groups"
        description="Manage ingress rule metadata for private cloud workloads."
      />
      <SecurityGroupWorkspace
        initialVpcs={vpcsResult.vpcs ?? []}
        initialGroups={groupsResult.security_groups ?? []}
      />
    </div>
  );
}
