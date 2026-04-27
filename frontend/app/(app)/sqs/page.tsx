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
import { listQueues } from "@/lib/aws";

export const dynamic = "force-dynamic";

export default async function SqsPage() {
  let queues: Awaited<ReturnType<typeof listQueues>> = [];
  let error: string | null = null;
  try {
    queues = await listQueues();
  } catch (e: any) {
    error = e?.message ?? "failed";
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="SQS Queues" description="Messaging backed by Floci" />
      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-sm text-destructive">{error}</div>
          ) : queues.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No queues yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Queue</TableHead>
                  <TableHead className="text-right">Messages</TableHead>
                  <TableHead className="text-right">In flight</TableHead>
                  <TableHead>URL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queues.map((q) => (
                  <TableRow key={q.url}>
                    <TableCell className="font-medium">{q.name}</TableCell>
                    <TableCell className="text-right font-mono">
                      {q.messages}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {q.inFlight}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {q.url}
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
