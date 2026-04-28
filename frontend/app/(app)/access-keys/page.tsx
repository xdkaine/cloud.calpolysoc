import { auth } from "@/auth";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getConsoleAccess } from "@/lib/console-access";
import { getEc2Capabilities } from "@/lib/ec2-capabilities";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await auth();
  const access = getConsoleAccess(session?.user?.roles);
  const capabilities = await getEc2Capabilities();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Access Keys"
        description={
          access.canAccessAdmin
            ? "Current API access model, customer automation bootstrap, and issuance constraints"
            : "Current workspace automation model and AWS-compatible endpoint bootstrap"
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Current access model</CardTitle>
              <CardDescription>
                Console identity is handled through Keycloak; service automation currently targets the private Floci-compatible endpoint.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <InfoRow label="Console audience" value={access.label} />
              <InfoRow
                label="Account"
                value={session?.user?.email ?? session?.user?.name ?? "Unavailable"}
              />
              <InfoRow label="Region" value={capabilities.serverProfile.region} />
              <InfoRow label="S3 / DynamoDB / SQS endpoint" value="http://api.cloud.calpolysoc.org" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>CLI bootstrap</CardTitle>
              <CardDescription>
                Use these exports when scripting against the private cloud services over VPN.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Snippet
                title="Base environment"
                code={`export AWS_ENDPOINT_URL=http://api.cloud.calpolysoc.org
export AWS_DEFAULT_REGION=${capabilities.serverProfile.region}
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test`}
              />
              <Snippet
                title="S3"
                code={`aws s3api list-buckets --endpoint-url "$AWS_ENDPOINT_URL"
aws s3 ls s3://mvp-demo-bucket/ --endpoint-url "$AWS_ENDPOINT_URL"`}
              />
              <Snippet
                title="DynamoDB"
                code={`aws dynamodb list-tables --endpoint-url "$AWS_ENDPOINT_URL"
aws dynamodb scan --table-name mvp-demo-table --endpoint-url "$AWS_ENDPOINT_URL"`}
              />
              <Snippet
                title="SQS"
                code={`aws sqs list-queues --endpoint-url "$AWS_ENDPOINT_URL"
aws sqs receive-message --queue-url http://api.cloud.calpolysoc.org/000000000000/mvp-demo-queue --endpoint-url "$AWS_ENDPOINT_URL"`}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Credential status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2">
                  <div className="font-medium text-foreground">Console login</div>
                  <Badge variant="success">Keycloak</Badge>
                </div>
                <p className="mt-2">
                  Browser access is authenticated with the real SSO platform and role-gated inside the console.
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2">
                  <div className="font-medium text-foreground">Service credentials</div>
                  <Badge variant="secondary">Shared test keys</Badge>
                </div>
                <p className="mt-2">
                  Floci currently accepts the internal test credential pair for AWS-compatible CLI access. Per-customer key issuance still needs backend support.
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <div className="font-medium text-foreground">Related workspaces</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href="/s3">Open S3</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/dynamodb">Open DynamoDB</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/sqs">Open SQS</Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="font-medium">{label}</div>
      <div className="max-w-[18rem] truncate text-right font-mono text-xs text-muted-foreground">
        {value}
      </div>
    </div>
  );
}

function Snippet({ title, code }: { title: string; code: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="font-medium">{title}</div>
      <pre className="mt-3 overflow-x-auto rounded-md bg-muted/40 p-3 text-xs leading-6 text-muted-foreground">
        {code}
      </pre>
    </div>
  );
}
