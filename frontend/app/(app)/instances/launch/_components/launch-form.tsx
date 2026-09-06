"use client";

import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import type { KeyPair, LaunchInput } from "@/lib/api";
import {
  type Ec2Capabilities,
  formatInstanceTypeLabel,
  formatInstanceTypeSummary,
  getImageCatalog,
  getInstanceTypeCatalog,
} from "@/lib/ec2-catalog";

const selectClassName =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export function LaunchForm({
  capabilities,
  keyPairs,
}: {
  capabilities: Ec2Capabilities;
  keyPairs: KeyPair[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [instanceType, setInstanceType] = useState(capabilities.defaultInstanceType);
  const [imageId, setImageId] = useState(capabilities.serverProfile.imageId);
  const [keyName, setKeyName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const selectedType =
    getInstanceTypeCatalog(capabilities.instanceCatalog, instanceType) ??
    capabilities.instanceCatalog[0];
  const selectedImage =
    getImageCatalog(capabilities.images, imageId) ??
    capabilities.images[0];

  useEffect(() => {
    if (!jobId) return;

    let active = true;

    async function pollJob() {
      try {
        const res = await fetch(`/api/ec2/jobs/${jobId}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error ?? `launch status failed (${res.status})`);
        }
        if (!active) return;

        setResult(data);
        const state = String(data?.state ?? "").toLowerCase();
        if (["succeeded", "warning", "failed"].includes(state)) {
          setSubmitting(false);
          setJobId(null);
          if (state === "failed") {
            setError(formatLaunchError(data));
            return;
          }
          setTimeout(() => router.push("/instances"), 1200);
        }
      } catch (e: any) {
        if (!active) return;
        setJobId(null);
        setSubmitting(false);
        setError(e?.message ?? "launch status failed");
      }
    }

    void pollJob();
    const timer = window.setInterval(() => {
      void pollJob();
    }, 2000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [jobId, router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setJobId(null);
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const payload: LaunchInput = {
        name,
        instance_type: instanceType,
        password,
        image_id: selectedImage.id,
        template_name: selectedImage.templateName,
        template_vmid: selectedImage.templateVmid,
        username: selectedImage.username,
        minimum_disk_gib: selectedImage.minimumDiskGiB,
        key_name: keyName || undefined,
      };
      const res = await fetch("/api/ec2/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `launch failed (${res.status})`);
      setResult(data);
      const state = String(data?.state ?? "").toLowerCase();
      if (data?.job_id && ["pending", "running"].includes(state)) {
        setJobId(data.job_id);
        return;
      }
      setSubmitting(false);
      setTimeout(() => router.push("/instances"), 1200);
    } catch (e: any) {
      setError(e?.message ?? "launch failed");
      setSubmitting(false);
    }
  }

  const resultState = String(result?.state ?? "").toLowerCase();
  const resultTitle =
    resultState === "succeeded"
      ? "Launch complete"
      : resultState === "warning"
        ? "Launch complete with warning"
        : resultState === "failed"
          ? "Launch failed"
          : jobId || resultState === "pending" || resultState === "running"
            ? "Launch in progress"
            : "Launch accepted";
  const resultClassName =
    resultState === "warning"
      ? "rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
      : resultState === "failed"
        ? "rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
        : "rounded-md border border-primary/30 bg-primary/10 p-3 text-sm";
  const resultTitleClassName =
    resultState === "failed"
      ? "font-medium text-destructive"
      : "font-medium text-primary";

  return (
    <form onSubmit={onSubmit} className="space-y-6">
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
          onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          aria-describedby="instance-name-help"
        />
        <p id="instance-name-help" className="text-xs text-muted-foreground">
          Letters, numbers and dashes only.
        </p>
      </div>

      <fieldset className="space-y-4 rounded-lg border border-border/80 bg-muted/25 p-4">
        <legend className="px-1 text-sm font-semibold text-primary">
          Image and size
        </legend>
        <div className="space-y-2">
          <Label htmlFor="image">AMI / image</Label>
          <select
            id="image"
            value={imageId}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setImageId(e.target.value)}
            className={selectClassName}
          >
            {capabilities.images.map((image) => (
              <option key={image.id} value={image.id}>
                {image.id} - {image.displayName}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="type">Instance type</Label>
          <select
            id="type"
            value={instanceType}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              setInstanceType(e.target.value)
            }
            className={selectClassName}
          >
            {capabilities.instanceCatalog.map((typeOption) => (
              <option key={typeOption.value} value={typeOption.value}>
                {formatInstanceTypeLabel(typeOption)}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-lg border border-border/80 bg-background p-4">
          <div className="text-sm font-medium">Selected server profile</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <LaunchFact label="Instance size" value={selectedType.value} />
            <LaunchFact
              label="Compute"
              value={formatInstanceTypeSummary(selectedType)}
            />
            <LaunchFact
              label="Image"
              value={`${selectedImage.id} (${selectedImage.displayName})`}
            />
            <LaunchFact
              label="Template"
              value={`${selectedImage.templateName} (${selectedImage.templateVmid})`}
            />
            <LaunchFact label="Default user" value={selectedImage.username} />
            <LaunchFact
              label="Minimum disk"
              value={`${selectedImage.minimumDiskGiB} GiB`}
            />
            <LaunchFact label="Node" value={capabilities.serverProfile.node} />
            <LaunchFact
              label="Storage"
              value={`${capabilities.serverProfile.storage} via ${capabilities.serverProfile.bridge}`}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border border-border/80 bg-muted/25 p-4">
        <legend className="px-1 text-sm font-semibold text-primary">
          Login
        </legend>
        <div className="space-y-2">
          <Label htmlFor="key-name">SSH key pair</Label>
          <select
            id="key-name"
            value={keyName}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setKeyName(e.target.value)}
            className={selectClassName}
          >
            <option value="">Password only</option>
            {keyPairs.map((keyPair) => (
              <option key={keyPair.key_pair_id} value={keyPair.key_name}>
                {keyPair.key_name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">
            Initial {selectedImage.username} password
          </Label>
          <Input
            id="password"
            type="password"
            required={!keyName}
            minLength={8}
            placeholder={keyName ? "Optional when an SSH key is selected" : "ChangeMe123!"}
            value={password}
            autoComplete="new-password"
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setPassword(e.target.value)
            }
            aria-describedby="password-help"
          />
          <p id="password-help" className="text-xs text-muted-foreground">
            A selected SSH key is injected through cloud-init. Password login is
            optional when a key pair is selected.
          </p>
        </div>
      </fieldset>

      {error ? (
        <div role="alert" className="whitespace-pre-wrap rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className={resultClassName} aria-live="polite">
          <div className={resultTitleClassName}>{resultTitle}</div>
          <p className="mt-2 text-xs text-muted-foreground">
            {result?.message ??
              (jobId
                ? "Provisioning is running in the background. This page will redirect when the job reaches a terminal state."
                : "The launch request was accepted.")}
          </p>
          {Array.isArray(result?.warnings) && result.warnings.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {result.warnings.map((warning: string) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end">
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

function formatLaunchError(data: any) {
  const message = data?.error ?? data?.message ?? "launch failed";
  const stderr = typeof data?.launch?.stderr === "string"
    ? data.launch.stderr.trim()
    : "";
  const stdout = typeof data?.launch?.stdout === "string"
    ? data.launch.stdout.trim()
    : "";
  const detail = stderr || stdout;
  if (!detail || message.includes(detail)) return message;
  return `${message}\n\n${detail}`;
}

function LaunchFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
