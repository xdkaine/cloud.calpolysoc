"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
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
import type { Snapshot, Volume } from "@/lib/api";

export function SnapshotWorkspace({
  initialSnapshots,
  initialVolumes,
}: {
  initialSnapshots: Snapshot[];
  initialVolumes: Volume[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [volumeId, setVolumeId] = useState(initialVolumes[0]?.volume_id ?? "");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!volumeId && initialVolumes[0]?.volume_id) setVolumeId(initialVolumes[0].volume_id);
  }, [initialVolumes, volumeId]);

  async function refresh() {
    start(() => router.refresh());
  }

  async function createSnapshot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    try {
      const res = await fetch("/api/ec2/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ volume_id: volumeId, name: description || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      setDescription("");
      await refresh();
    } catch (error: any) {
      alert(error?.message ?? "Failed to create snapshot");
    } finally {
      setBusy(null);
    }
  }

  async function action(path: string, method: "POST" | "DELETE", label: string) {
    if (method === "DELETE" && !confirm(`Delete ${label}?`)) return;
    setBusy(path);
    try {
      const res = await fetch(path, { method });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (error: any) {
      alert(error?.message ?? "Action failed");
    } finally {
      setBusy(null);
    }
  }

  const working = pending || busy !== null;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader className="border-b border-border/80">
          <CardTitle className="text-primary">Snapshot inventory</CardTitle>
          <CardDescription>
            Completed snapshots can be restored to new detached volumes.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {initialSnapshots.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No snapshots have been created.
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/60">
                <TableRow>
                  <TableHead>Snapshot</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialSnapshots.map((snapshot) => (
                  <TableRow key={snapshot.snapshot_id}>
                    <TableCell>
                      <div className="font-medium">{snapshot.name || snapshot.snapshot_id}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {snapshot.snapshot_id}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{snapshot.volume_id}</TableCell>
                    <TableCell>
                      <Badge variant={snapshot.state === "completed" ? "success" : "outline"}>
                        {snapshot.state}
                      </Badge>
                    </TableCell>
                    <TableCell>{snapshot.size_gib} GiB</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={working || snapshot.state !== "completed"}
                          onClick={() => action(`/api/ec2/snapshots/${snapshot.snapshot_id}/restore`, "POST", snapshot.snapshot_id)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={working}
                          onClick={() => action(`/api/ec2/snapshots/${snapshot.snapshot_id}`, "DELETE", snapshot.snapshot_id)}
                        >
                          {busy === `/api/ec2/snapshots/${snapshot.snapshot_id}` ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border/80">
          <CardTitle className="flex items-center gap-2 text-base">
            <Archive className="h-4 w-4" />
            Create snapshot
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={createSnapshot} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="snapshot-volume">Volume</Label>
              <select
                id="snapshot-volume"
                value={volumeId}
                onChange={(event) => setVolumeId(event.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              >
                {initialVolumes.map((volume) => (
                  <option key={volume.volume_id} value={volume.volume_id}>
                    {volume.name || volume.volume_id}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="snapshot-description">Description</Label>
              <Input id="snapshot-description" value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
            <Button type="submit" disabled={working || !volumeId} className="w-full">
              {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              <span className="ml-2">Create snapshot</span>
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
