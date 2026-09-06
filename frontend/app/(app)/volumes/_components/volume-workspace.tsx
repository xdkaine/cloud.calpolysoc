"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HardDrive, Link2, Loader2, Plus, Trash2, Unlink } from "lucide-react";
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
import type { Instance, Volume } from "@/lib/api";

export function VolumeWorkspace({
  initialVolumes,
  initialInstances,
}: {
  initialVolumes: Volume[];
  initialInstances: Instance[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sizeGiB, setSizeGiB] = useState("10");
  const [volumeId, setVolumeId] = useState(initialVolumes.find((v) => v.state === "available")?.volume_id ?? "");
  const [vmid, setVmid] = useState(initialInstances[0]?.vmid?.toString() ?? "");

  useEffect(() => {
    const available = initialVolumes.find((volume) => volume.state === "available");
    if (!volumeId && available) setVolumeId(available.volume_id);
  }, [initialVolumes, volumeId]);

  useEffect(() => {
    if (!vmid && initialInstances[0]?.vmid) setVmid(String(initialInstances[0].vmid));
  }, [initialInstances, vmid]);

  async function refresh() {
    start(() => router.refresh());
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    try {
      const res = await fetch("/api/ec2/volumes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || undefined, size_gib: Number(sizeGiB) }),
      });
      if (!res.ok) throw new Error(await res.text());
      setName("");
      await refresh();
    } catch (error: any) {
      alert(error?.message ?? "Failed to create volume");
    } finally {
      setBusy(null);
    }
  }

  async function attach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("attach");
    try {
      const res = await fetch(`/api/ec2/volumes/${volumeId}/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vmid: Number(vmid) }),
      });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (error: any) {
      alert(error?.message ?? "Failed to attach volume");
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
  const availableVolumes = initialVolumes.filter((volume) => volume.state === "available");

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader className="border-b border-border/80">
          <CardTitle className="text-primary">Volume inventory</CardTitle>
          <CardDescription>
            Detached volumes keep their Proxmox backing disk until deleted.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {initialVolumes.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No volumes have been created.
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/60">
                <TableRow>
                  <TableHead>Volume</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Attached</TableHead>
                  <TableHead>Backing</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialVolumes.map((volume) => (
                  <TableRow key={volume.volume_id}>
                    <TableCell>
                      <div className="font-medium">{volume.name || volume.volume_id}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {volume.volume_id}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={volume.state === "in-use" ? "success" : "outline"}>
                        {volume.state}
                      </Badge>
                    </TableCell>
                    <TableCell>{volume.size_gib} GiB</TableCell>
                    <TableCell className="font-mono text-xs">
                      {volume.attached_vmid ? `${volume.attached_vmid} ${volume.device_name ?? ""}` : "detached"}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate font-mono text-xs text-muted-foreground">
                      {volume.proxmox_volume ?? volume.unused_key ?? "not allocated"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {volume.attached_vmid ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={working}
                            onClick={() => action(`/api/ec2/volumes/${volume.volume_id}/detach`, "POST", volume.volume_id)}
                          >
                            <Unlink className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={working || Boolean(volume.attached_vmid)}
                          onClick={() => action(`/api/ec2/volumes/${volume.volume_id}`, "DELETE", volume.volume_id)}
                        >
                          {busy === `/api/ec2/volumes/${volume.volume_id}` ? (
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

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader className="border-b border-border/80">
            <CardTitle className="flex items-center gap-2 text-base">
              <HardDrive className="h-4 w-4" />
              Create volume
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={submitCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="volume-name">Name</Label>
                <Input id="volume-name" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="volume-size">Size GiB</Label>
                <Input id="volume-size" type="number" min="1" value={sizeGiB} onChange={(event) => setSizeGiB(event.target.value)} required />
              </div>
              <Button type="submit" disabled={working} className="w-full">
                {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                <span className="ml-2">Create volume</span>
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/80">
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-4 w-4" />
              Attach volume
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={attach} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="attach-volume">Volume</Label>
                <select
                  id="attach-volume"
                  value={volumeId}
                  onChange={(event) => setVolumeId(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                >
                  {availableVolumes.map((volume) => (
                    <option key={volume.volume_id} value={volume.volume_id}>
                      {volume.name || volume.volume_id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="attach-instance">Instance</Label>
                <select
                  id="attach-instance"
                  value={vmid}
                  onChange={(event) => setVmid(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                >
                  {initialInstances.map((instance) => (
                    <option key={instance.vmid} value={instance.vmid}>
                      {instance.name} ({instance.vmid})
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={working || !volumeId || !vmid} className="w-full">
                {busy === "attach" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                <span className="ml-2">Attach</span>
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
