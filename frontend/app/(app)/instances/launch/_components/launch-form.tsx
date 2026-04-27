"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

const INSTANCE_TYPES = [
  { value: "t3.nano", label: "t3.nano — 1 vCPU / 512 MiB" },
  { value: "t3.micro", label: "t3.micro — 1 vCPU / 1 GiB" },
  { value: "t3.small", label: "t3.small — 1 vCPU / 2 GiB" },
  { value: "t3.medium", label: "t3.medium — 2 vCPU / 4 GiB" },
];

export function LaunchForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [instanceType, setInstanceType] = useState("t3.small");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/ec2/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          instance_type: instanceType,
          password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `launch failed (${res.status})`);
      setResult(data);
      setTimeout(() => router.push("/instances"), 1200);
    } catch (e: any) {
      setError(e?.message ?? "launch failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="name">Instance name</Label>
        <Input
          id="name"
          required
          minLength={2}
          maxLength={48}
          pattern="[a-zA-Z0-9-]+"
          placeholder="my-app-server-01"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Letters, numbers and dashes only.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="type">Instance type</Label>
        <select
          id="type"
          value={instanceType}
          onChange={(e) => setInstanceType(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {INSTANCE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Initial ubuntu password</Label>
        <Input
          id="password"
          type="password"
          required
          minLength={8}
          placeholder="ChangeMe123!"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Set on the <code className="rounded bg-muted px-1 py-0.5 text-xs">ubuntu</code> user via cloud-init.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="rounded-md border border-emerald-500/50 bg-emerald-500/10 p-3 text-sm">
          <div className="font-medium text-emerald-700 dark:text-emerald-400">
            Launch accepted
          </div>
          <pre className="mt-2 overflow-x-auto text-xs">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      ) : null}

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Launching…
            </>
          ) : (
            "Launch instance"
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/instances")}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
