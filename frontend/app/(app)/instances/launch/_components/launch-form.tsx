"use client";

import { type ChangeEvent, type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import type { LaunchInput } from "@/lib/api";
import {
  type Ec2Capabilities,
  formatInstanceTypeLabel,
  formatInstanceTypeSummary,
  getImageCatalog,
  getInstanceTypeCatalog,
} from "@/lib/ec2-catalog";

export function LaunchForm({ capabilities }: { capabilities: Ec2Capabilities }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [instanceType, setInstanceType] = useState(capabilities.defaultInstanceType);
  const [imageId, setImageId] = useState(capabilities.serverProfile.imageId);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const selectedType =
    getInstanceTypeCatalog(capabilities.instanceCatalog, instanceType) ??
    capabilities.instanceCatalog[0];
  const selectedImage =
    getImageCatalog(capabilities.images, imageId) ??
    capabilities.images[0];

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
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
      };
      const res = await fetch("/api/ec2/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
          onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Letters, numbers and dashes only.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="image">AMI / image</Label>
        <select
          id="image"
          value={imageId}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setImageId(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {capabilities.images.map((image) => (
            <option key={image.id} value={image.id}>
              {image.id} - {image.displayName}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Launch requests include the selected AMI id and live Proxmox template metadata so the EC2 wrapper can become image-aware without another frontend change.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="type">Instance type</Label>
        <select
          id="type"
          value={instanceType}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            setInstanceType(e.target.value)
          }
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {capabilities.instanceCatalog.map((typeOption) => (
            <option key={typeOption.value} value={typeOption.value}>
              {formatInstanceTypeLabel(typeOption)}
            </option>
          ))}
        </select>
        <div className="rounded-lg border bg-muted/30 p-4">
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
          <p className="mt-3 text-xs text-muted-foreground">
            Current launches always send
            {" "}<code className="rounded bg-background px-1 py-0.5 text-xs">name</code>,
            {" "}<code className="rounded bg-background px-1 py-0.5 text-xs">instance_type</code>, and
            {" "}<code className="rounded bg-background px-1 py-0.5 text-xs">password</code>
            plus image metadata fields such as
            {" "}<code className="rounded bg-background px-1 py-0.5 text-xs">image_id</code> and
            {" "}<code className="rounded bg-background px-1 py-0.5 text-xs">template_vmid</code>.
            The current wrapper can ignore those extras until it is updated to launch from the selected template.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">
          Initial {selectedImage.username} password
        </Label>
        <Input
          id="password"
          type="password"
          required
          minLength={8}
          placeholder="ChangeMe123!"
          value={password}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setPassword(e.target.value)
          }
        />
        <p className="text-xs text-muted-foreground">
          Set on the <code className="rounded bg-muted px-1 py-0.5 text-xs">{selectedImage.username}</code> user via cloud-init.
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
