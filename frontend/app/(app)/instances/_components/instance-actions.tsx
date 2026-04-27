"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Play, Square, Trash2, Loader2 } from "lucide-react";

export function InstanceActions({
  vmid,
  status,
}: {
  vmid: number;
  status: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  async function call(action: "start" | "stop" | "terminate") {
    setBusy(action);
    try {
      const url =
        action === "terminate"
          ? `/api/ec2/instances/${vmid}`
          : `/api/ec2/instances/${vmid}/${action}`;
      const res = await fetch(url, {
        method: action === "terminate" ? "DELETE" : "POST",
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `${action} failed`);
      }
      start(() => router.refresh());
    } catch (e: any) {
      alert(e?.message ?? `${action} failed`);
    } finally {
      setBusy(null);
    }
  }

  const isRunning = status?.toLowerCase() === "running";
  const working = pending || busy !== null;

  return (
    <div className="inline-flex items-center gap-1">
      {isRunning ? (
        <Button
          variant="outline"
          size="sm"
          disabled={working}
          onClick={() => call("stop")}
        >
          {busy === "stop" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
          <span className="ml-1">Stop</span>
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={working}
          onClick={() => call("start")}
        >
          {busy === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          <span className="ml-1">Start</span>
        </Button>
      )}
      <Button
        variant="destructive"
        size="sm"
        disabled={working}
        onClick={() => {
          if (confirm(`Terminate VM ${vmid}? This cannot be undone.`)) {
            call("terminate");
          }
        }}
      >
        {busy === "terminate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
