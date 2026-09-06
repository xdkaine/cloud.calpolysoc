import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AccessDenied({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={description} />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-primary">Privileged access required</CardTitle>
          <CardDescription>
            This module is reserved for CalPolySOC staff and administrators.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Your current workspace view is scoped for customer self-service.
            If you should have staff access, ask an administrator to add your
            AD group to <strong>CLOUD_STAFF_GROUPS</strong> or{" "}
            <strong>CLOUD_ADMIN_GROUPS</strong>.
          </p>
          <Button asChild>
            <Link href="/">Return to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
