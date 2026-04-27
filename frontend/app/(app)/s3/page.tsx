import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listBuckets } from "@/lib/aws";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function S3Page() {
  let buckets: Awaited<ReturnType<typeof listBuckets>> = [];
  let error: string | null = null;
  try {
    buckets = await listBuckets();
  } catch (e: any) {
    error = e?.message ?? "failed";
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="S3 Buckets"
        description="Object storage backed by Floci"
      />
      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-sm text-destructive">{error}</div>
          ) : buckets.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No buckets yet. Create one with the AWS CLI:
              <pre className="mx-auto mt-3 inline-block rounded-md bg-muted p-3 text-left text-xs">
{`aws --endpoint-url=http://api.cloud.calpolysoc.org \\
  s3api create-bucket --bucket my-bucket`}
              </pre>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bucket</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buckets.map((b) => (
                  <TableRow key={b.name}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(b.creationDate)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
