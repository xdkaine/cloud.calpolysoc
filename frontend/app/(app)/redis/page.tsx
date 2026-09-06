import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { ec2 } from "@/lib/api";
import { RedisWorkspace } from "./_components/redis-workspace";

export const dynamic = "force-dynamic";

export default async function RedisPage() {
  const session = await auth();
  const [cacheResult, groupsResult] = await Promise.all([
    ec2.listCacheInstances(session?.user),
    ec2.listSecurityGroups(session?.user),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Redis"
        description="Provision VM-backed managed Redis caches."
      />
      <RedisWorkspace
        initialInstances={cacheResult.cache_instances ?? []}
        initialSecurityGroups={groupsResult.security_groups ?? []}
      />
    </div>
  );
}
