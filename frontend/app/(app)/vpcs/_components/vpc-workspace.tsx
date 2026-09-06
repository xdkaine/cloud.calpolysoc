"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Network, Plus, Trash2 } from "lucide-react";
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
import type { Subnet, Vpc } from "@/lib/api";

export function VpcWorkspace({
  initialVpcs,
  initialSubnets,
}: {
  initialVpcs: Vpc[];
  initialSubnets: Subnet[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [vpcName, setVpcName] = useState("");
  const [vpcCidr, setVpcCidr] = useState("10.10.0.0/16");
  const [subnetVpcId, setSubnetVpcId] = useState(initialVpcs[0]?.vpc_id ?? "");
  const [subnetCidr, setSubnetCidr] = useState("10.10.1.0/24");

  const subnetsByVpc = useMemo(() => {
    return initialSubnets.reduce<Record<string, Subnet[]>>((acc, subnet) => {
      acc[subnet.vpc_id] = [...(acc[subnet.vpc_id] ?? []), subnet];
      return acc;
    }, {});
  }, [initialSubnets]);

  useEffect(() => {
    if (!subnetVpcId && initialVpcs[0]?.vpc_id) {
      setSubnetVpcId(initialVpcs[0].vpc_id);
    }
  }, [initialVpcs, subnetVpcId]);

  async function refresh() {
    start(() => router.refresh());
  }

  async function submitVpc(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("vpc");
    try {
      const res = await fetch("/api/ec2/vpcs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: vpcName || undefined, cidr_block: vpcCidr }),
      });
      if (!res.ok) throw new Error(await res.text());
      setVpcName("");
      await refresh();
    } catch (error: any) {
      alert(error?.message ?? "Failed to create VPC");
    } finally {
      setBusy(null);
    }
  }

  async function submitSubnet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("subnet");
    try {
      const res = await fetch("/api/ec2/subnets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vpc_id: subnetVpcId, cidr_block: subnetCidr }),
      });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (error: any) {
      alert(error?.message ?? "Failed to create subnet");
    } finally {
      setBusy(null);
    }
  }

  async function remove(path: string, label: string) {
    if (!confirm(`Delete ${label}?`)) return;
    setBusy(path);
    try {
      const res = await fetch(path, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (error: any) {
      alert(error?.message ?? "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  const working = pending || busy !== null;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader className="border-b border-border/80">
          <CardTitle className="text-primary">Network inventory</CardTitle>
          <CardDescription>
            VPC and subnet records are persisted in the cloud control plane.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {initialVpcs.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No VPCs have been created.
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/60">
                <TableRow>
                  <TableHead>VPC</TableHead>
                  <TableHead>CIDR</TableHead>
                  <TableHead>Subnets</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialVpcs.map((vpc) => (
                  <TableRow key={vpc.vpc_id}>
                    <TableCell>
                      <div className="font-medium">{vpc.name || vpc.vpc_id}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {vpc.vpc_id}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{vpc.cidr_block}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {(subnetsByVpc[vpc.vpc_id] ?? []).map((subnet) => (
                          <span key={subnet.subnet_id} className="font-mono text-xs">
                            {subnet.cidr_block}
                          </span>
                        ))}
                        {(subnetsByVpc[vpc.vpc_id] ?? []).length === 0 ? (
                          <span className="text-xs text-muted-foreground">none</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="success">{vpc.state}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={working}
                        onClick={() => remove(`/api/ec2/vpcs/${vpc.vpc_id}`, vpc.vpc_id)}
                      >
                        {busy === `/api/ec2/vpcs/${vpc.vpc_id}` ? (
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
        <Card>
          <CardHeader className="border-b border-border/80">
            <CardTitle className="flex items-center gap-2 text-base">
              <Network className="h-4 w-4" />
              Create VPC
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={submitVpc} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="vpc-name">Name</Label>
                <Input id="vpc-name" value={vpcName} onChange={(event) => setVpcName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vpc-cidr">CIDR block</Label>
                <Input id="vpc-cidr" value={vpcCidr} onChange={(event) => setVpcCidr(event.target.value)} required />
              </div>
              <Button type="submit" disabled={working} className="w-full">
                {busy === "vpc" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                <span className="ml-2">Create VPC</span>
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/80">
            <CardTitle className="text-base">Create subnet</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={submitSubnet} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="subnet-vpc">VPC</Label>
                <select
                  id="subnet-vpc"
                  value={subnetVpcId}
                  onChange={(event) => setSubnetVpcId(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                >
                  {initialVpcs.map((vpc) => (
                    <option key={vpc.vpc_id} value={vpc.vpc_id}>
                      {vpc.name || vpc.vpc_id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="subnet-cidr">CIDR block</Label>
                <Input id="subnet-cidr" value={subnetCidr} onChange={(event) => setSubnetCidr(event.target.value)} required />
              </div>
              <Button type="submit" disabled={working || initialVpcs.length === 0} className="w-full">
                {busy === "subnet" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                <span className="ml-2">Create subnet</span>
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
