import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { ec2 } from "@/lib/api";
import { AccessKeyWorkspace } from "./_components/access-key-workspace";

export const dynamic = "force-dynamic";

export default async function AccessKeysPage() {
  const session = await auth();
  const result = await ec2.listAccessKeys(session?.user);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Access Keys"
        description="Create and revoke programmatic credentials for cloud APIs."
      />
      <AccessKeyWorkspace initialKeys={result.access_keys ?? []} />
    </div>
  );
}
