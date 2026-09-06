import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { ec2 } from "@/lib/api";
import { KeyPairWorkspace } from "./_components/key-pair-workspace";

export const dynamic = "force-dynamic";

export default async function KeyPairsPage() {
  const session = await auth();
  const result = await ec2.listKeyPairs(session?.user);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Key Pairs"
        description="Manage SSH keys used by EC2-compatible instance launches."
      />
      <KeyPairWorkspace initialKeyPairs={result.key_pairs ?? []} />
    </div>
  );
}
