"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Loader2, Plus, Trash2, Upload } from "lucide-react";
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
import type { KeyPair } from "@/lib/api";

const textareaClassName =
  "flex min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function KeyPairWorkspace({
  initialKeyPairs,
}: {
  initialKeyPairs: KeyPair[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("workstation");
  const [publicKey, setPublicKey] = useState("");
  const [created, setCreated] = useState<KeyPair | null>(null);

  async function refresh() {
    start(() => router.refresh());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    try {
      const res = await fetch("/api/ec2/key-pairs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key_name: name,
          public_key: publicKey.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const payload = await res.json();
      setCreated(payload.key_pair);
      setPublicKey("");
      await refresh();
    } catch (error: any) {
      alert(error?.message ?? "Failed to save key pair");
    } finally {
      setBusy(null);
    }
  }

  async function remove(keyName: string) {
    if (!confirm(`Delete key pair ${keyName}?`)) return;
    setBusy(keyName);
    try {
      const res = await fetch(`/api/ec2/key-pairs/${encodeURIComponent(keyName)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (error: any) {
      alert(error?.message ?? "Failed to delete key pair");
    } finally {
      setBusy(null);
    }
  }

  async function copySecret(value: string) {
    await navigator.clipboard.writeText(value);
  }

  const working = pending || busy !== null;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card>
        <CardHeader className="border-b border-border/80">
          <CardTitle className="text-primary">Key pair inventory</CardTitle>
          <CardDescription>
            Key names can be used with EC2-compatible `RunInstances` requests.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {initialKeyPairs.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No SSH key pairs have been created.
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/60">
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Fingerprint</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialKeyPairs.map((keyPair) => (
                  <TableRow key={keyPair.key_pair_id}>
                    <TableCell>
                      <div className="font-medium">{keyPair.key_name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {keyPair.key_pair_id}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono">
                        {keyPair.fingerprint}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {keyPair.created_at ?? "unknown"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={working}
                        onClick={() => remove(keyPair.key_name)}
                      >
                        {busy === keyPair.key_name ? (
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
        {created?.private_key ? (
          <Card>
            <CardHeader className="border-b border-border/80">
              <CardTitle className="text-base">Generated private key</CardTitle>
              <CardDescription>
                This private key is shown once and is not stored by the control plane.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              <div className="rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
                {created.private_key}
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => copySecret(created.private_key ?? "")}
              >
                <Copy className="h-4 w-4" />
                <span className="ml-2">Copy private key</span>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="border-b border-border/80">
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" />
              Save key pair
            </CardTitle>
            <CardDescription>
              Paste a public key or leave it empty to generate an ED25519 pair.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="key-pair-name">Name</Label>
                <Input
                  id="key-pair-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="public-key">Public key</Label>
                <textarea
                  id="public-key"
                  className={textareaClassName}
                  placeholder="ssh-ed25519 AAAA..."
                  value={publicKey}
                  onChange={(event) => setPublicKey(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={working} className="w-full">
                {busy === "create" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : publicKey.trim() ? (
                  <Upload className="h-4 w-4" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                <span className="ml-2">
                  {publicKey.trim() ? "Import key pair" : "Generate key pair"}
                </span>
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
