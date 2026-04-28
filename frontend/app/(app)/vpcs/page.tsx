import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="VPCs"
        description="Network segmentation is not enabled for this private cloud console yet."
      />
      <Card>
        <CardContent className="p-8 text-sm text-muted-foreground">
          VPC management is not enabled in this console.
        </CardContent>
      </Card>
    </div>
  );
}
