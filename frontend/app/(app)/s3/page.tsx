import { PageHeader } from "@/components/page-header";
import { S3Workspace } from "./_components/s3-workspace";

export const dynamic = "force-dynamic";

export default async function S3Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="S3 Buckets"
        description="Create account-scoped buckets, upload objects, and manage stored files."
      />
      <S3Workspace />
    </div>
  );
}
