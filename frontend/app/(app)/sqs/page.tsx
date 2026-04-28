import { PageHeader } from "@/components/page-header";
import { SqsWorkspace } from "./_components/sqs-workspace";

export const dynamic = "force-dynamic";

export default async function SqsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="SQS Queues"
        description="Create queues, send messages, poll visible messages, and purge test traffic."
      />
      <SqsWorkspace />
    </div>
  );
}
