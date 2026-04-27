import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Console configuration and endpoints"
      />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Endpoints</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 text-sm">
            <Row k="Console" v="https://cloud.calpolysoc.org" />
            <Row k="Internal API" v="http://api.cloud.calpolysoc.org" />
            <Row k="EC2 API" v="http://api.cloud.calpolysoc.org/ec2" />
            <Row k="SSO Issuer" v="https://auth.calpolysoc.org/realms/calpolysoc" />
            <Row k="Region" v="us-east-1" />
            <Row k="Account ID" v="000000000000" />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <dt className="font-medium">{k}</dt>
      <dd className="font-mono text-xs text-muted-foreground">{v}</dd>
    </div>
  );
}
