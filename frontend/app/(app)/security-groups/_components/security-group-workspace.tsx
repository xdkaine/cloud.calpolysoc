"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Shield, Trash2 } from "lucide-react";
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
import type { SecurityGroup, Vpc } from "@/lib/api";

export function SecurityGroupWorkspace({
  initialVpcs,
  initialGroups,
}: {
  initialVpcs: Vpc[];
  initialGroups: SecurityGroup[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [vpcId, setVpcId] = useState(initialVpcs[0]?.vpc_id ?? "");
  const [groupName, setGroupName] = useState("web");
  const [description, setDescription] = useState("Application access");
  const [ruleGroupId, setRuleGroupId] = useState(initialGroups[0]?.group_id ?? "");
  const [direction, setDirection] = useState<"ingress" | "egress">("ingress");
  const [protocol, setProtocol] = useState("tcp");
  const [fromPort, setFromPort] = useState("22");
  const [toPort, setToPort] = useState("22");
  const [cidr, setCidr] = useState("172.21.0.0/16");

  useEffect(() => {
    if (!vpcId && initialVpcs[0]?.vpc_id) {
      setVpcId(initialVpcs[0].vpc_id);
    }
  }, [initialVpcs, vpcId]);

  useEffect(() => {
    if (!ruleGroupId && initialGroups[0]?.group_id) {
      setRuleGroupId(initialGroups[0].group_id);
    }
  }, [initialGroups, ruleGroupId]);

  async function refresh() {
    start(() => router.refresh());
  }

  async function submitGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("group");
    try {
      const res = await fetch("/api/ec2/security-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vpc_id: vpcId,
          name: groupName,
          description,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (error: any) {
      alert(error?.message ?? "Failed to create security group");
    } finally {
      setBusy(null);
    }
  }

  async function submitRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("rule");
    try {
      const res = await fetch(`/api/ec2/security-groups/${ruleGroupId}/${direction}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip_protocol: protocol,
          from_port: Number(fromPort),
          to_port: Number(toPort),
          cidr_ip: cidr,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (error: any) {
      alert(error?.message ?? "Failed to add rule");
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
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader className="border-b border-border/80">
          <CardTitle className="text-primary">Security group inventory</CardTitle>
          <CardDescription>
            Rules are persisted as control-plane metadata before firewall enforcement.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {initialGroups.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No security groups have been created.
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/60">
                <TableRow>
                  <TableHead>Group</TableHead>
                  <TableHead>VPC</TableHead>
                  <TableHead>Rules</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialGroups.map((group) => (
                  <TableRow key={group.group_id}>
                    <TableCell>
                      <div className="font-medium">{group.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {group.group_id}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {group.description}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{group.vpc_id}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-2">
                        {(group.ingress_rules ?? []).map((rule) => (
                          <div key={rule.rule_id} className="flex items-center gap-2">
                            <Badge variant="secondary">in</Badge>
                            <Badge variant="outline">{rule.ip_protocol}</Badge>
                            <span className="font-mono text-xs">
                              {rule.from_port ?? "all"}-{rule.to_port ?? "all"}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {rule.cidr_ip}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={working}
                              onClick={() =>
                                remove(
                                  `/api/ec2/security-groups/${group.group_id}/ingress/${rule.rule_id}`,
                                  rule.rule_id,
                                )
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                        {(group.ingress_rules ?? []).length === 0 ? (
                          <span className="text-xs text-muted-foreground">no ingress</span>
                        ) : null}
                        {(group.egress_rules ?? []).map((rule) => (
                          <div key={rule.rule_id} className="flex items-center gap-2">
                            <Badge variant="secondary">out</Badge>
                            <Badge variant="outline">{rule.ip_protocol}</Badge>
                            <span className="font-mono text-xs">
                              {rule.from_port ?? "all"}-{rule.to_port ?? "all"}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {rule.cidr_ip}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={working}
                              onClick={() =>
                                remove(
                                  `/api/ec2/security-groups/${group.group_id}/egress/${rule.rule_id}`,
                                  rule.rule_id,
                                )
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                        {(group.egress_rules ?? []).length === 0 ? (
                          <span className="text-xs text-muted-foreground">no egress</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={working}
                        onClick={() =>
                          remove(`/api/ec2/security-groups/${group.group_id}`, group.group_id)
                        }
                      >
                        {busy === `/api/ec2/security-groups/${group.group_id}` ? (
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
              <Shield className="h-4 w-4" />
              Create group
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={submitGroup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sg-vpc">VPC</Label>
                <select
                  id="sg-vpc"
                  value={vpcId}
                  onChange={(event) => setVpcId(event.target.value)}
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
                <Label htmlFor="sg-name">Name</Label>
                <Input id="sg-name" value={groupName} onChange={(event) => setGroupName(event.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sg-description">Description</Label>
                <Input id="sg-description" value={description} onChange={(event) => setDescription(event.target.value)} />
              </div>
              <Button type="submit" disabled={working || initialVpcs.length === 0} className="w-full">
                {busy === "group" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                <span className="ml-2">Create group</span>
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/80">
            <CardTitle className="text-base">Add firewall rule</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={submitRule} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="rule-direction">Direction</Label>
                <select
                  id="rule-direction"
                  value={direction}
                  onChange={(event) => setDirection(event.target.value as "ingress" | "egress")}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                >
                  <option value="ingress">ingress</option>
                  <option value="egress">egress</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rule-group">Group</Label>
                <select
                  id="rule-group"
                  value={ruleGroupId}
                  onChange={(event) => setRuleGroupId(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                >
                  {initialGroups.map((group) => (
                    <option key={group.group_id} value={group.group_id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="rule-protocol">Protocol</Label>
                  <Input id="rule-protocol" value={protocol} onChange={(event) => setProtocol(event.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rule-from">From</Label>
                  <Input id="rule-from" value={fromPort} onChange={(event) => setFromPort(event.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rule-to">To</Label>
                  <Input id="rule-to" value={toPort} onChange={(event) => setToPort(event.target.value)} required />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rule-cidr">CIDR</Label>
                <Input id="rule-cidr" value={cidr} onChange={(event) => setCidr(event.target.value)} required />
              </div>
              <Button type="submit" disabled={working || initialGroups.length === 0} className="w-full">
                {busy === "rule" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                <span className="ml-2">Add rule</span>
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
