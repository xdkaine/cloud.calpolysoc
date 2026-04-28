import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getConsoleAccess } from "@/lib/console-access";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await auth();
  const access = getConsoleAccess(session?.user?.roles);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Access Keys"
        description="Programmatic credentials remain disabled while browser access is scoped through SSO."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-primary">Programmatic access is disabled</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              The console no longer publishes shared AWS-compatible credentials.
              Service access needs per-user or per-project keys before it can be
              safely exposed outside the authenticated browser session.
            </p>
            <p>
              Browser workflows for S3, DynamoDB, and SQS are scoped through the
              console API using your authenticated identity.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-primary">Current session</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <InfoRow label="Audience" value={access.label} />
            <InfoRow
              label="Account"
              value={session?.user?.email ?? session?.user?.name ?? "Unavailable"}
            />
            <InfoRow label="Subject" value={session?.user?.id ?? "Unavailable"} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-xs">{value}</div>
    </div>
  );
}
