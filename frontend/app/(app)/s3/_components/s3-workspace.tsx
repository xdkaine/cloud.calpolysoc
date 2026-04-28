"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Download, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatBytes, formatDate } from "@/lib/utils";

type BucketSummary = {
  name: string;
  displayName?: string;
  creationDate?: string;
  ownedByCurrentUser?: boolean;
};

type ObjectSummary = {
  key: string;
  size: number;
  lastModified?: string;
};

type FlashMessage = {
  tone: "success" | "error";
  text: string;
};

export function S3Workspace() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [buckets, setBuckets] = useState<BucketSummary[]>([]);
  const [objects, setObjects] = useState<ObjectSummary[]>([]);
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [namespacePrefix, setNamespacePrefix] = useState("");
  const [newBucketName, setNewBucketName] = useState("");
  const [objectKey, setObjectKey] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loadingBuckets, setLoadingBuckets] = useState(true);
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [flashMessage, setFlashMessage] = useState<FlashMessage | null>(null);

  useEffect(() => {
    void loadBuckets();
  }, []);

  useEffect(() => {
    if (!selectedBucket) {
      setObjects([]);
      return;
    }

    void loadObjects(selectedBucket);
  }, [selectedBucket]);

  async function loadBuckets(preferredBucket?: string | null) {
    setLoadingBuckets(true);

    try {
      const response = await fetch("/api/aws/s3", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to load buckets");
      }

      const nextBuckets = (data.buckets ?? []) as BucketSummary[];
      setNamespacePrefix(data.namespace?.prefix ?? "");
      setBuckets(nextBuckets);
      setSelectedBucket((current) => {
        const candidates = [preferredBucket, current, nextBuckets[0]?.name].filter(
          Boolean,
        ) as string[];
        return (
          candidates.find((candidate) =>
            nextBuckets.some((bucket) => bucket.name === candidate),
          ) ?? null
        );
      });
    } catch (error: any) {
      setBuckets([]);
      setSelectedBucket(null);
      setNamespacePrefix("");
      setFlashMessage({
        tone: "error",
        text: error?.message ?? "Failed to load S3 buckets",
      });
    } finally {
      setLoadingBuckets(false);
    }
  }

  async function loadObjects(bucket: string) {
    setLoadingObjects(true);

    try {
      const response = await fetch(
        `/api/aws/s3?bucket=${encodeURIComponent(bucket)}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to load objects");
      }

      setObjects((data.objects ?? []) as ObjectSummary[]);
    } catch (error: any) {
      setObjects([]);
      setFlashMessage({
        tone: "error",
        text: error?.message ?? `Failed to load objects for ${bucket}`,
      });
    } finally {
      setLoadingObjects(false);
    }
  }

  async function createNewBucket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const bucketName = newBucketName.trim();
    if (!bucketName) return;

    setBusyAction("create-bucket");
    setFlashMessage(null);
    try {
      const response = await fetch("/api/aws/s3", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-bucket", bucket: bucketName }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to create bucket");
      }

      setNewBucketName("");
      setFlashMessage({ tone: "success", text: `Created bucket ${bucketName}.` });
      await loadBuckets(data?.bucket ?? bucketName);
    } catch (error: any) {
      setFlashMessage({
        tone: "error",
        text: error?.message ?? "Failed to create bucket",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function uploadObject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBucket || !selectedFile) return;

    const key = objectKey.trim() || selectedFile.name;
    const payload = new FormData();
    payload.set("bucket", selectedBucket);
    payload.set("key", key);
    payload.set("file", selectedFile);

    setBusyAction("upload-object");
    setFlashMessage(null);
    try {
      const response = await fetch("/api/aws/s3", {
        method: "POST",
        body: payload,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to upload object");
      }

      setObjectKey("");
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setFlashMessage({
        tone: "success",
        text: `Uploaded ${key} to ${selectedBucket}.`,
      });
      await loadObjects(selectedBucket);
    } catch (error: any) {
      setFlashMessage({
        tone: "error",
        text: error?.message ?? "Failed to upload object",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function removeBucket(bucket: string) {
    if (!confirm(`Delete bucket ${bucket}? The bucket must already be empty.`)) {
      return;
    }

    setBusyAction(`delete-bucket:${bucket}`);
    setFlashMessage(null);
    try {
      const response = await fetch("/api/aws/s3", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-bucket", bucket }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to delete bucket");
      }

      setFlashMessage({ tone: "success", text: `Deleted bucket ${bucket}.` });
      await loadBuckets(selectedBucket === bucket ? null : selectedBucket);
    } catch (error: any) {
      setFlashMessage({
        tone: "error",
        text: error?.message ?? `Failed to delete bucket ${bucket}`,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function removeObject(key: string) {
    if (!selectedBucket) return;
    if (!confirm(`Delete ${key} from ${selectedBucket}?`)) {
      return;
    }

    setBusyAction(`delete-object:${key}`);
    setFlashMessage(null);
    try {
      const response = await fetch("/api/aws/s3", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete-object",
          bucket: selectedBucket,
          key,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to delete object");
      }

      setFlashMessage({
        tone: "success",
        text: `Deleted ${key} from ${selectedBucket}.`,
      });
      await loadObjects(selectedBucket);
    } catch (error: any) {
      setFlashMessage({
        tone: "error",
        text: error?.message ?? `Failed to delete ${key}`,
      });
    } finally {
      setBusyAction(null);
    }
  }

  const selectedBucketSummary =
    buckets.find((bucket) => bucket.name === selectedBucket) ?? null;
  const selectedBucketLabel =
    selectedBucketSummary?.displayName ?? selectedBucketSummary?.name ?? selectedBucket;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(300px,0.95fr)_minmax(0,1.45fr)]">
      <div className="space-y-6">
        <Card>
          <CardHeader className="border-b border-border/80">
            <CardTitle className="text-primary">Buckets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {namespacePrefix ? (
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                New buckets are created inside your account namespace{" "}
                <code>{namespacePrefix}</code>.
              </div>
            ) : null}
            <form className="space-y-3" onSubmit={createNewBucket}>
              <label className="text-sm font-medium" htmlFor="bucket-name">
                New bucket
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  id="bucket-name"
                  value={newBucketName}
                  onChange={(event) => setNewBucketName(event.target.value)}
                  placeholder="artifacts"
                  pattern="^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$"
                />
                <Button
                  type="submit"
                  disabled={busyAction === "create-bucket" || !newBucketName.trim()}
                >
                  {busyAction === "create-bucket" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Create bucket
                </Button>
              </div>
            </form>

            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Active buckets</div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFlashMessage(null);
                  void loadBuckets(selectedBucket);
                }}
                disabled={loadingBuckets}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${loadingBuckets ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

            {loadingBuckets ? (
              <StateBlock text="Loading buckets..." />
            ) : buckets.length === 0 ? (
              <StateBlock text="No buckets yet. Create one to start storing objects." />
            ) : (
              <div className="space-y-3">
                {buckets.map((bucket) => {
                  const isSelected = bucket.name === selectedBucket;
                  const isDeleting = busyAction === `delete-bucket:${bucket.name}`;
                  return (
                    <div
                      key={bucket.name}
                      className={`rounded-lg border p-4 transition-colors ${
                        isSelected
                          ? "border-primary/50 bg-primary/5"
                          : "border-border/80 bg-card/70"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          className="min-h-11 min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          onClick={() => setSelectedBucket(bucket.name)}
                        >
                          <div className="truncate font-medium">
                            {bucket.displayName ?? bucket.name}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Created {formatDate(bucket.creationDate)}
                          </div>
                          {bucket.displayName ? (
                            <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                              {bucket.name}
                            </div>
                          ) : null}
                        </button>
                        <div className="flex items-center gap-2">
                          {isSelected ? <Badge variant="secondary">Selected</Badge> : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={isDeleting}
                            title={`Delete ${bucket.name}`}
                            onClick={() => void removeBucket(bucket.name)}
                          >
                            {isDeleting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader className="border-b border-border/80">
            <CardTitle className="text-primary">Objects</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {flashMessage ? (
              <div
                role={flashMessage.tone === "error" ? "alert" : "status"}
                className={`rounded-md border p-3 text-sm ${
                  flashMessage.tone === "success"
                    ? "border-primary/25 bg-primary/10 text-foreground"
                    : "border-destructive/40 bg-destructive/10 text-destructive"
                }`}
              >
                {flashMessage.text}
              </div>
            ) : null}

            <form className="grid gap-3 rounded-lg border border-border/80 bg-muted/25 p-4" onSubmit={uploadObject}>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="object-key">
                    Object key
                  </label>
                  <Input
                    id="object-key"
                    value={objectKey}
                    onChange={(event) => setObjectKey(event.target.value)}
                    placeholder={selectedFile?.name ?? "artifacts/build.tar.gz"}
                    disabled={!selectedBucket}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="object-file">
                    File
                  </label>
                  <Input
                    id="object-file"
                    ref={fileInputRef}
                    type="file"
                    disabled={!selectedBucket}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setSelectedFile(event.target.files?.[0] ?? null)
                    }
                  />
                </div>
              </div>

              <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                <Button
                  type="submit"
                  disabled={!selectedBucket || !selectedFile || busyAction === "upload-object"}
                >
                  {busyAction === "upload-object" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  Upload object
                </Button>
              </div>
            </form>

            {!selectedBucket ? (
              <StateBlock text="Select a bucket to view objects and upload files." />
            ) : loadingObjects ? (
              <StateBlock text={`Loading objects for ${selectedBucketLabel}...`} />
            ) : objects.length === 0 ? (
              <StateBlock text={`No objects yet in ${selectedBucketLabel}.`} />
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Object</th>
                      <th className="px-4 py-3 font-medium">Modified</th>
                      <th className="px-4 py-3 font-medium">Size</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {objects.map((object) => {
                      const isDeleting = busyAction === `delete-object:${object.key}`;
                      return (
                        <tr key={object.key} className="border-t border-border/70">
                          <td className="px-4 py-3 font-medium">{object.key}</td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {formatDate(object.lastModified)}
                          </td>
                          <td className="px-4 py-3 font-mono text-muted-foreground">
                            {formatBytes(object.size)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-1">
                              <Button asChild type="button" variant="ghost" size="sm">
                                <a
                                  href={`/api/aws/s3?bucket=${encodeURIComponent(
                                    selectedBucket,
                                  )}&key=${encodeURIComponent(object.key)}`}
                                >
                                  <Download className="mr-2 h-4 w-4" />
                                  Download
                                </a>
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={isDeleting}
                                onClick={() => void removeObject(object.key)}
                              >
                                {isDeleting ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="mr-2 h-4 w-4" />
                                )}
                                Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StateBlock({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-primary/25 bg-muted/35 p-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
