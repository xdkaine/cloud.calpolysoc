"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Database, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatBytes } from "@/lib/utils";

type DynamoAttributeType = "S" | "N" | "B";

type TableSummary = {
  name: string;
  status: string;
  itemCount: number;
  sizeBytes: number;
  partitionKey?: string;
  partitionKeyType?: DynamoAttributeType;
  sortKey?: string;
  sortKeyType?: DynamoAttributeType;
};

type FlashMessage = {
  tone: "success" | "error";
  text: string;
};

const selectClassName =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function DynamoDbWorkspace() {
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [selectedTableName, setSelectedTableName] = useState<string | null>(null);
  const [newTableName, setNewTableName] = useState("");
  const [partitionKeyName, setPartitionKeyName] = useState("pk");
  const [partitionKeyType, setPartitionKeyType] = useState<DynamoAttributeType>("S");
  const [sortKeyName, setSortKeyName] = useState("");
  const [sortKeyType, setSortKeyType] = useState<DynamoAttributeType>("S");
  const [itemDraft, setItemDraft] = useState('{\n  "pk": "tenant#example"\n}');
  const [loadingTables, setLoadingTables] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [flashMessage, setFlashMessage] = useState<FlashMessage | null>(null);

  const selectedTable = tables.find((table) => table.name === selectedTableName) ?? null;

  useEffect(() => {
    void loadTables();
  }, []);

  useEffect(() => {
    if (!selectedTableName) {
      setItems([]);
      return;
    }

    void loadItems(selectedTableName);
  }, [selectedTableName]);

  useEffect(() => {
    if (!selectedTable) return;
    setItemDraft(buildSampleItem(selectedTable));
  }, [selectedTable?.name]);

  async function loadTables(preferredTable?: string | null) {
    setLoadingTables(true);

    try {
      const response = await fetch("/api/aws/dynamodb", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to load tables");
      }

      const nextTables = (data.tables ?? []) as TableSummary[];
      setTables(nextTables);
      setSelectedTableName((current) => {
        const candidates = [preferredTable, current, nextTables[0]?.name].filter(
          Boolean,
        ) as string[];
        return (
          candidates.find((candidate) =>
            nextTables.some((table) => table.name === candidate),
          ) ?? null
        );
      });
    } catch (error: any) {
      setTables([]);
      setSelectedTableName(null);
      setFlashMessage({
        tone: "error",
        text: error?.message ?? "Failed to load DynamoDB tables",
      });
    } finally {
      setLoadingTables(false);
    }
  }

  async function loadItems(tableName: string) {
    setLoadingItems(true);

    try {
      const response = await fetch(
        `/api/aws/dynamodb?table=${encodeURIComponent(tableName)}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to load items");
      }

      setItems((data.items ?? []) as Array<Record<string, unknown>>);
    } catch (error: any) {
      setItems([]);
      setFlashMessage({
        tone: "error",
        text: error?.message ?? `Failed to load items for ${tableName}`,
      });
    } finally {
      setLoadingItems(false);
    }
  }

  async function createNewTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tableName = newTableName.trim();
    const pkName = partitionKeyName.trim();
    const skName = sortKeyName.trim();
    if (!tableName || !pkName) return;

    setBusyAction("create-table");
    setFlashMessage(null);
    try {
      const response = await fetch("/api/aws/dynamodb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-table",
          tableName,
          partitionKeyName: pkName,
          partitionKeyType,
          sortKeyName: skName,
          sortKeyType,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to create table");
      }

      setNewTableName("");
      setFlashMessage({ tone: "success", text: `Created table ${tableName}.` });
      await loadTables(tableName);
    } catch (error: any) {
      setFlashMessage({
        tone: "error",
        text: error?.message ?? "Failed to create table",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTable) return;

    setBusyAction("put-item");
    setFlashMessage(null);
    try {
      const item = parseJsonObject(itemDraft, "item payload");
      assertTableKeys(item, selectedTable);

      const response = await fetch("/api/aws/dynamodb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "put-item",
          tableName: selectedTable.name,
          item,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to write item");
      }

      setFlashMessage({
        tone: "success",
        text: `Saved item to ${selectedTable.name}.`,
      });
      await loadItems(selectedTable.name);
    } catch (error: any) {
      setFlashMessage({
        tone: "error",
        text: error?.message ?? "Failed to save item",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function removeTable(tableName: string) {
    if (!confirm(`Delete table ${tableName}? This cannot be undone.`)) {
      return;
    }

    setBusyAction(`delete-table:${tableName}`);
    setFlashMessage(null);
    try {
      const response = await fetch("/api/aws/dynamodb", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-table", tableName }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to delete table");
      }

      setFlashMessage({ tone: "success", text: `Deleted table ${tableName}.` });
      await loadTables(selectedTableName === tableName ? null : selectedTableName);
    } catch (error: any) {
      setFlashMessage({
        tone: "error",
        text: error?.message ?? `Failed to delete table ${tableName}`,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function removeItem(item: Record<string, unknown>, index: number) {
    if (!selectedTable) return;

    const key = buildItemKey(item, selectedTable);
    if (!key) {
      setFlashMessage({
        tone: "error",
        text: `Item ${index + 1} is missing the table key fields and cannot be deleted from the UI.`,
      });
      return;
    }

    if (!confirm(`Delete ${describeItemKey(key)} from ${selectedTable.name}?`)) {
      return;
    }

    setBusyAction(`delete-item:${index}`);
    setFlashMessage(null);
    try {
      const response = await fetch("/api/aws/dynamodb", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete-item",
          tableName: selectedTable.name,
          key,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to delete item");
      }

      setFlashMessage({
        tone: "success",
        text: `Deleted ${describeItemKey(key)} from ${selectedTable.name}.`,
      });
      await loadItems(selectedTable.name);
    } catch (error: any) {
      setFlashMessage({
        tone: "error",
        text: error?.message ?? "Failed to delete item",
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.95fr)_minmax(0,1.45fr)]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Table registry</CardTitle>
            <CardDescription>
              Provision Floci-backed tables through the authenticated console facade with explicit key schema metadata.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="space-y-3" onSubmit={createNewTable}>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="table-name">
                  New table
                </label>
                <Input
                  id="table-name"
                  value={newTableName}
                  onChange={(event) => setNewTableName(event.target.value)}
                  placeholder="tenant-projects"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="partition-key-name">
                    Partition key
                  </label>
                  <Input
                    id="partition-key-name"
                    value={partitionKeyName}
                    onChange={(event) => setPartitionKeyName(event.target.value)}
                    placeholder="pk"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="partition-key-type">
                    Type
                  </label>
                  <select
                    id="partition-key-type"
                    className={selectClassName}
                    value={partitionKeyType}
                    onChange={(event) => setPartitionKeyType(event.target.value as DynamoAttributeType)}
                  >
                    <option value="S">String</option>
                    <option value="N">Number</option>
                    <option value="B">Binary</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="sort-key-name">
                    Sort key (optional)
                  </label>
                  <Input
                    id="sort-key-name"
                    value={sortKeyName}
                    onChange={(event) => setSortKeyName(event.target.value)}
                    placeholder="sk"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="sort-key-type">
                    Type
                  </label>
                  <select
                    id="sort-key-type"
                    className={selectClassName}
                    value={sortKeyType}
                    onChange={(event) => setSortKeyType(event.target.value as DynamoAttributeType)}
                    disabled={!sortKeyName.trim()}
                  >
                    <option value="S">String</option>
                    <option value="N">Number</option>
                    <option value="B">Binary</option>
                  </select>
                </div>
              </div>

              <Button
                type="submit"
                disabled={busyAction === "create-table" || !newTableName.trim() || !partitionKeyName.trim()}
              >
                {busyAction === "create-table" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Create table
              </Button>
            </form>

            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Current tables</div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFlashMessage(null);
                  void loadTables(selectedTableName);
                }}
                disabled={loadingTables}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${loadingTables ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

            {loadingTables ? (
              <StateBlock text="Loading tables..." />
            ) : tables.length === 0 ? (
              <StateBlock text="No tables yet. Create one to start storing keyed records." />
            ) : (
              <div className="space-y-3">
                {tables.map((table) => {
                  const isSelected = table.name === selectedTableName;
                  const isDeleting = busyAction === `delete-table:${table.name}`;
                  return (
                    <div
                      key={table.name}
                      className={`rounded-lg border p-4 transition-colors ${
                        isSelected
                          ? "border-primary/50 bg-primary/5"
                          : "border-border/80 bg-card/70"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => setSelectedTableName(table.name)}
                        >
                          <div className="flex items-center gap-2">
                            <div className="truncate font-medium">{table.name}</div>
                            <Badge
                              variant={table.status === "ACTIVE" ? "success" : "secondary"}
                            >
                              {table.status.toLowerCase()}
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>{table.itemCount.toLocaleString()} items</span>
                            <span>{formatBytes(table.sizeBytes)}</span>
                            {table.partitionKey ? (
                              <span>
                                pk: {table.partitionKey} ({table.partitionKeyType ?? "S"})
                              </span>
                            ) : null}
                            {table.sortKey ? (
                              <span>
                                sk: {table.sortKey} ({table.sortKeyType ?? "S"})
                              </span>
                            ) : null}
                          </div>
                        </button>
                        <div className="flex items-center gap-2">
                          {isSelected ? <Badge variant="secondary">Selected</Badge> : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={isDeleting}
                            title={`Delete ${table.name}`}
                            onClick={() => void removeTable(table.name)}
                          >
                            {isDeleting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>CLI parity</CardTitle>
            <CardDescription>
              The console writes the same core resources you would manage through DynamoDB CLI commands against the internal endpoint.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md border bg-muted/40 p-4 text-xs leading-6 text-muted-foreground">
{`export AWS_ENDPOINT_URL=http://api.cloud.calpolysoc.org
export AWS_DEFAULT_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test

aws dynamodb list-tables --endpoint-url "$AWS_ENDPOINT_URL"
aws dynamodb describe-table --table-name ${selectedTable?.name ?? "tenant-projects"} --endpoint-url "$AWS_ENDPOINT_URL"
aws dynamodb scan --table-name ${selectedTable?.name ?? "tenant-projects"} --endpoint-url "$AWS_ENDPOINT_URL"`}
            </pre>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Item workspace</CardTitle>
            <CardDescription>
              {selectedTable
                ? `Insert and inspect records for ${selectedTable.name}.`
                : "Select a table to browse records and write new items."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {flashMessage ? (
              <FlashBanner flashMessage={flashMessage} />
            ) : null}

            <form className="grid gap-3 rounded-lg border p-4" onSubmit={saveItem}>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="item-draft">
                  Item JSON
                </label>
                <textarea
                  id="item-draft"
                  className="min-h-[220px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={itemDraft}
                  onChange={(event) => setItemDraft(event.target.value)}
                  spellCheck={false}
                  disabled={!selectedTable}
                />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-muted-foreground">
                  {selectedTable
                    ? `Required keys: ${selectedTable.partitionKey ?? "pk"}${selectedTable.sortKey ? `, ${selectedTable.sortKey}` : ""}`
                    : "Choose a table to load a sample item payload."}
                </div>
                <Button
                  type="submit"
                  disabled={!selectedTable || busyAction === "put-item"}
                >
                  {busyAction === "put-item" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Save item
                </Button>
              </div>
            </form>

            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">
                {selectedTable ? `${selectedTable.name} records` : "Records"}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (!selectedTable) return;
                  setFlashMessage(null);
                  void loadItems(selectedTable.name);
                }}
                disabled={!selectedTable || loadingItems}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${loadingItems ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

            {!selectedTable ? (
              <StateBlock text="Select a table from the registry to inspect records." />
            ) : loadingItems ? (
              <StateBlock text="Loading records..." />
            ) : items.length === 0 ? (
              <StateBlock text="No records yet. Save a JSON item to seed this table." />
            ) : (
              <div className="space-y-3">
                {items.map((item, index) => {
                  const key = buildItemKey(item, selectedTable);
                  const isDeleting = busyAction === `delete-item:${index}`;

                  return (
                    <div key={buildItemKeyLabel(item, selectedTable, index)} className="rounded-lg border p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Database className="h-4 w-4 text-muted-foreground" />
                            <div className="truncate font-medium">
                              {key ? describeItemKey(key) : `Item ${index + 1}`}
                            </div>
                          </div>
                          <pre className="mt-3 overflow-x-auto rounded-md bg-muted/40 p-3 text-xs leading-6 text-muted-foreground">
                            {JSON.stringify(item, null, 2)}
                          </pre>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isDeleting || !key}
                          title={key ? `Delete ${describeItemKey(key)}` : "Missing table keys"}
                          onClick={() => void removeItem(item, index)}
                        >
                          {isDeleting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function buildSampleItem(table: TableSummary) {
  const sample: Record<string, unknown> = {
    [table.partitionKey ?? "pk"]: "tenant#example",
  };

  if (table.sortKey) {
    sample[table.sortKey] = "resource#001";
  }

  sample.displayName = "Example record";
  sample.updatedAt = new Date().toISOString();

  return JSON.stringify(sample, null, 2);
}

function parseJsonObject(raw: string, label: string) {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch (error: any) {
    throw new Error(error?.message ?? `Invalid ${label}`);
  }
}

function assertTableKeys(item: Record<string, unknown>, table: TableSummary) {
  if (table.partitionKey && !(table.partitionKey in item)) {
    throw new Error(`Item must include the partition key ${table.partitionKey}`);
  }
  if (table.sortKey && !(table.sortKey in item)) {
    throw new Error(`Item must include the sort key ${table.sortKey}`);
  }
}

function buildItemKey(item: Record<string, unknown>, table: TableSummary) {
  if (!table.partitionKey) return null;
  if (!(table.partitionKey in item)) return null;

  const key: Record<string, unknown> = {
    [table.partitionKey]: item[table.partitionKey],
  };

  if (table.sortKey) {
    if (!(table.sortKey in item)) return null;
    key[table.sortKey] = item[table.sortKey];
  }

  return key;
}

function describeItemKey(key: Record<string, unknown>) {
  return Object.entries(key)
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(" • ");
}

function buildItemKeyLabel(item: Record<string, unknown>, table: TableSummary, index: number) {
  const key = buildItemKey(item, table);
  return key ? `${describeItemKey(key)}-${index}` : `item-${index}`;
}

function FlashBanner({ flashMessage }: { flashMessage: FlashMessage }) {
  return (
    <div
      className={`rounded-md border p-3 text-sm ${
        flashMessage.tone === "success"
          ? "border-primary/25 bg-primary/10 text-foreground"
          : "border-destructive/40 bg-destructive/10 text-destructive"
      }`}
    >
      {flashMessage.text}
    </div>
  );
}

function StateBlock({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}