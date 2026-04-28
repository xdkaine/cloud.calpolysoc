import { PageHeader } from "@/components/page-header";
import { S3Workspace } from "./_components/s3-workspace";

export const dynamic = "force-dynamic";

export default async function S3Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="S3 Buckets"
        description="Object storage backed by Floci and managed through authenticated console workflows"
      />
      <S3Workspace />
    </div>
  );
}
