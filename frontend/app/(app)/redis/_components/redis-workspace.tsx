"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Database, Loader2, Play, Plus, Square, Trash2 } from "lucide-react";
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
import type { CacheInstance, SecurityGroup } from "@/lib/api";

type CreatedCredentials = {
  id: string;
  username: string;
  password: string;
};

export function RedisWorkspace({
  initialInstances,
  initialSecurityGroups,
}: {
  initialInstances: CacheInstance[];
  initialSecurityGroups: SecurityGroup[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("app-redis");
  const [instanceClass, setInstanceClass] = useState("cache.t3.small");
  const [storageGiB, setStorageGiB] = useState("10");
  const [securityGroupId, setSecurityGroupId] = useState(initialSecurityGroups[0]?.group_id ?? "");
  const [created, setCreated] = useState<CreatedCredentials | null>(null);

  async function refresh() {
    start(() => router.refresh());
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    try {
      const res = await fetch("/api/ec2/cache-instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          engine: "redis",
          instance_class: instanceClass,
          allocated_storage_gib: Number(storageGiB),
          security_group_ids: securityGroupId ? [securityGroupId] : [],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const payload = await res.json();
      setCreated({
        id: payload.cache_instance.cache_instance_id,
        username: payload.credentials.username,
        password: payload.credentials.password,
      });
      await refresh();
    } catch (error: any) {
      alert(error?.message ?? "Failed to create Redis cache");
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
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader className="border-b border-border/80">
          <CardTitle className="text-primary">Cache instances</CardTitle>
          <CardDescription>
            Redis caches use VM isolation and security group firewall rules.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {initialInstances.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No Redis caches have been created.
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/60">
                <TableRow>
                  <TableHead>Cache</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>VMID</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialInstances.map((instance) => (
                  <TableRow key={instance.cache_instance_id}>
                    <TableCell>
                      <div className="font-medium">{instance.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {instance.cache_instance_id}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={instance.state === "available" ? "success" : "outline"}>
                        {instance.state}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div>{instance.instance_class}</div>
                      <div className="text-xs text-muted-foreground">
                        {instance.allocated_storage_gib} GiB
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {instance.endpoint_address ? `${instance.endpoint_address}:${instance.endpoint_port}` : "pending"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{instance.vmid ?? "pending"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={working || !instance.vmid}
                          onClick={() => action(`/api/ec2/cache-instances/${instance.cache_instance_id}/start`, "POST", instance.cache_instance_id)}
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={working || !instance.vmid}
                          onClick={() => action(`/api/ec2/cache-instances/${instance.cache_instance_id}/stop`, "POST", instance.cache_instance_id)}
                        >
                          <Square className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={working}
                          onClick={() => action(`/api/ec2/cache-instances/${instance.cache_instance_id}`, "DELETE", instance.cache_instance_id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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
        {created ? (
          <Card>
            <CardHeader className="border-b border-border/80">
              <CardTitle className="text-base">New credentials</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-6 text-sm">
              <Credential label="Cache" value={created.id} />
              <Credential label="Username" value={created.username} />
              <Credential label="Password" value={created.password} />
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="border-b border-border/80">
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4" />
              Create Redis
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={create} className="space-y-4">
              <Field id="redis-name" label="Name" value={name} setValue={setName} />
              <div className="space-y-2">
                <Label htmlFor="redis-class">Class</Label>
                <select
                  id="redis-class"
                  value={instanceClass}
                  onChange={(event) => setInstanceClass(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="cache.t3.small">cache.t3.small</option>
                  <option value="cache.t3.medium">cache.t3.medium</option>
                </select>
              </div>
              <Field id="redis-storage" label="Storage GiB" value={storageGiB} setValue={setStorageGiB} type="number" />
              <div className="space-y-2">
                <Label htmlFor="redis-sg">Security group</Label>
                <select
                  id="redis-sg"
                  value={securityGroupId}
                  onChange={(event) => setSecurityGroupId(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">default deny</option>
                  {initialSecurityGroups.map((group) => (
                    <option key={group.group_id} value={group.group_id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={working} className="w-full">
                {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                <span className="ml-2">Create Redis</span>
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  setValue,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  setValue: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(event) => setValue(event.target.value)} required />
    </div>
  );
}

function Credential({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-medium">{label}</div>
      <div className="mt-1 break-all rounded-md border bg-muted/40 p-3 font-mono text-xs">
        {value}
      </div>
    </div>
  );
}
