"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AccessKey } from "@/lib/api";

export function AccessKeyWorkspace({
  initialKeys,
}: {
  initialKeys: AccessKey[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("default");
  const [created, setCreated] = useState<AccessKey | null>(null);

  async function refresh() {
    start(() => router.refresh());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    try {
      const res = await fetch("/api/ec2/access-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(await res.text());
      const payload = await res.json();
      setCreated(payload.access_key);
      await refresh();
    } catch (error: any) {
      alert(error?.message ?? "Failed to create access key");
    } finally {
      setBusy(null);
    }
  }

  async function remove(accessKeyId: string) {
    if (!confirm(`Delete access key ${accessKeyId}?`)) return;
    setBusy(accessKeyId);
    try {
      const res = await fetch(`/api/ec2/access-keys/${accessKeyId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (error: any) {
      alert(error?.message ?? "Failed to delete access key");
    } finally {
      setBusy(null);
    }
  }

  const working = pending || busy !== null;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader className="border-b border-border/80">
          <CardTitle className="text-primary">Access keys</CardTitle>
          <CardDescription>
            Keys are scoped to your cloud identity and can be revoked here.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {initialKeys.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No access keys have been created.
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/60">
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Access key ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialKeys.map((key) => (
                  <TableRow key={key.access_key_id}>
                    <TableCell className="font-medium">{key.name || "default"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {key.access_key_id}
                    </TableCell>
                    <TableCell>
                      <Badge variant={key.status === "active" ? "success" : "secondary"}>
                        {key.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {key.created_at ?? "unknown"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={working}
                        onClick={() => remove(key.access_key_id)}
                      >
                        {busy === key.access_key_id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-6">
        {created ? (
          <Card>
            <CardHeader className="border-b border-border/80">
              <CardTitle className="text-base">New key secret</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-2">
                <Label>Access key ID</Label>
                <div className="rounded-md border bg-muted/40 p-3 font-mono text-xs">
                  {created.access_key_id}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Secret access key</Label>
                <div className="break-all rounded-md border bg-muted/40 p-3 font-mono text-xs">
                  {created.secret_access_key}
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="border-b border-border/80">
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" />
              Create key
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="key-name">Name</Label>
                <Input id="key-name" value={name} onChange={(event) => setName(event.target.value)} required />
              </div>
              <Button type="submit" disabled={working} className="w-full">
                {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                <span className="ml-2">Create key</span>
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
