import { PageHeader } from "@/components/page-header";
import { DynamoDbWorkspace } from "./_components/dynamodb-workspace";

export const dynamic = "force-dynamic";

export default async function DynamoPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="DynamoDB Tables"
        description="Create scoped tables, inspect records, and write JSON items."
      />
      <DynamoDbWorkspace />
    </div>
  );
}
