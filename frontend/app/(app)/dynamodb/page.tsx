import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listTables } from "@/lib/aws";
import { formatBytes } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DynamoPage() {
  let tables: Awaited<ReturnType<typeof listTables>> = [];
  let error: string | null = null;
  try {
    tables = await listTables();
  } catch (e: any) {
    error = e?.message ?? "failed";
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="DynamoDB Tables"
        description="Key-value tables backed by Floci"
      />
      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-sm text-destructive">{error}</div>
          ) : tables.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No tables yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tables.map((t) => (
                  <TableRow key={t.name}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant={t.status === "ACTIVE" ? "success" : "secondary"}
                      >
                        {t.status.toLowerCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {t.itemCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatBytes(t.sizeBytes)}
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
