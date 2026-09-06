import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { ec2 } from "@/lib/api";
import { VpcWorkspace } from "./_components/vpc-workspace";

export const dynamic = "force-dynamic";

export default async function VpcsPage() {
  const session = await auth();
  const [vpcsResult, subnetsResult] = await Promise.all([
    ec2.listVpcs(session?.user),
    ec2.listSubnets(session?.user),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="VPCs"
        description="Create private network records for Proxmox-backed workloads."
      />
      <VpcWorkspace
        initialVpcs={vpcsResult.vpcs ?? []}
        initialSubnets={subnetsResult.subnets ?? []}
      />
    </div>
  );
}
