import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function ComingSoon({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-2 p-16 text-center">
          <div className="text-sm font-medium">Coming soon</div>
          <p className="max-w-md text-sm text-muted-foreground">
            This module isn&apos;t wired up to an internal API yet. Track
            progress in the project README under &quot;Things Still Left To Do&quot;.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
