"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, MessageSquare, RefreshCw, Send, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type QueueSummary = {
  name: string;
  displayName?: string;
  url: string;
  messages: number;
  inFlight: number;
  delayed: number;
};

type QueueMessage = {
  messageId: string;
  receiptHandle: string;
  body: string;
  attributes: Record<string, string>;
};

type FlashMessage = {
  tone: "success" | "error";
  text: string;
};

export function SqsWorkspace() {
  const [queues, setQueues] = useState<QueueSummary[]>([]);
  const [messages, setMessages] = useState<QueueMessage[]>([]);
  const [selectedQueueUrl, setSelectedQueueUrl] = useState<string | null>(null);
  const [namespacePrefix, setNamespacePrefix] = useState("");
  const [newQueueName, setNewQueueName] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [loadingQueues, setLoadingQueues] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [flashMessage, setFlashMessage] = useState<FlashMessage | null>(null);

  const selectedQueue = queues.find((queue) => queue.url === selectedQueueUrl) ?? null;

  useEffect(() => {
    void loadQueues();
  }, []);

  useEffect(() => {
    if (!selectedQueueUrl) {
      setMessages([]);
      return;
    }

    void loadMessages(selectedQueueUrl);
  }, [selectedQueueUrl]);

  async function loadQueues(preferredQueueUrl?: string | null) {
    setLoadingQueues(true);

    try {
      const response = await fetch("/api/aws/sqs", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to load queues");
      }

      const nextQueues = (data.queues ?? []) as QueueSummary[];
      setNamespacePrefix(data.namespace?.prefix ?? "");
      setQueues(nextQueues);
      setSelectedQueueUrl((current) => {
        const candidates = [preferredQueueUrl, current, nextQueues[0]?.url].filter(
          Boolean,
        ) as string[];
        return (
          candidates.find((candidate) =>
            nextQueues.some((queue) => queue.url === candidate),
          ) ?? null
        );
      });
    } catch (error: any) {
      setQueues([]);
      setSelectedQueueUrl(null);
      setNamespacePrefix("");
      setFlashMessage({
        tone: "error",
        text: error?.message ?? "Failed to load SQS queues",
      });
    } finally {
      setLoadingQueues(false);
    }
  }

  async function loadMessages(queueUrl: string) {
    setLoadingMessages(true);

    try {
      const response = await fetch(
        `/api/aws/sqs?queueUrl=${encodeURIComponent(queueUrl)}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to load messages");
      }

      setMessages((data.messages ?? []) as QueueMessage[]);
    } catch (error: any) {
      setMessages([]);
      setFlashMessage({
        tone: "error",
        text: error?.message ?? "Failed to load queue messages",
      });
    } finally {
      setLoadingMessages(false);
    }
  }

  async function createNewQueue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const queueName = newQueueName.trim();
    if (!queueName) return;

    setBusyAction("create-queue");
    setFlashMessage(null);
    try {
      const response = await fetch("/api/aws/sqs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-queue", queueName }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to create queue");
      }

      setNewQueueName("");
      setFlashMessage({ tone: "success", text: `Created queue ${queueName}.` });
      await loadQueues(data?.queueUrl ?? null);
    } catch (error: any) {
      setFlashMessage({
        tone: "error",
        text: error?.message ?? "Failed to create queue",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedQueue || !messageBody.trim()) return;

    setBusyAction("send-message");
    setFlashMessage(null);
    try {
      const response = await fetch("/api/aws/sqs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send-message",
          queueUrl: selectedQueue.url,
          body: messageBody,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to send message");
      }

      setFlashMessage({
        tone: "success",
        text: `Sent message${data?.messageId ? ` ${data.messageId}` : ""} to ${selectedQueue.name}.`,
      });
      await Promise.all([loadQueues(selectedQueue.url), loadMessages(selectedQueue.url)]);
    } catch (error: any) {
      setFlashMessage({
        tone: "error",
        text: error?.message ?? "Failed to send message",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function removeQueue(queue: QueueSummary) {
    if (!confirm(`Delete queue ${queue.name}?`)) {
      return;
    }

    setBusyAction(`delete-queue:${queue.url}`);
    setFlashMessage(null);
    try {
      const response = await fetch("/api/aws/sqs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-queue", queueUrl: queue.url }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to delete queue");
      }

      setFlashMessage({ tone: "success", text: `Deleted queue ${queue.name}.` });
      await loadQueues(selectedQueueUrl === queue.url ? null : selectedQueueUrl);
    } catch (error: any) {
      setFlashMessage({
        tone: "error",
        text: error?.message ?? `Failed to delete queue ${queue.name}`,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function purgeSelectedQueue() {
    if (!selectedQueue) return;
    if (!confirm(`Purge all available messages from ${selectedQueue.name}?`)) {
      return;
    }

    setBusyAction(`purge-queue:${selectedQueue.url}`);
    setFlashMessage(null);
    try {
      const response = await fetch("/api/aws/sqs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "purge-queue", queueUrl: selectedQueue.url }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to purge queue");
      }

      setFlashMessage({ tone: "success", text: `Purged ${selectedQueue.name}.` });
      await Promise.all([loadQueues(selectedQueue.url), loadMessages(selectedQueue.url)]);
    } catch (error: any) {
      setFlashMessage({
        tone: "error",
        text: error?.message ?? `Failed to purge ${selectedQueue.name}`,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteMessage(receiptHandle: string, messageId: string) {
    if (!selectedQueue) return;

    setBusyAction(`delete-message:${messageId}`);
    setFlashMessage(null);
    try {
      const response = await fetch("/api/aws/sqs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete-message",
          queueUrl: selectedQueue.url,
          receiptHandle,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to delete message");
      }

      setFlashMessage({
        tone: "success",
        text: `Deleted message ${messageId} from ${selectedQueue.name}.`,
      });
      await Promise.all([loadQueues(selectedQueue.url), loadMessages(selectedQueue.url)]);
    } catch (error: any) {
      setFlashMessage({
        tone: "error",
        text: error?.message ?? `Failed to delete message ${messageId}`,
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.95fr)_minmax(0,1.45fr)]">
      <div className="space-y-6">
        <Card>
          <CardHeader className="border-b border-border/80">
            <CardTitle className="text-primary">Queue registry</CardTitle>
            <CardDescription>
              Create and manage account-scoped queues.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {namespacePrefix ? (
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                New queues are created inside your account namespace{" "}
                <code>{namespacePrefix}</code>.
              </div>
            ) : null}
            <form className="space-y-3" onSubmit={createNewQueue}>
              <label className="text-sm font-medium" htmlFor="queue-name">
                New queue
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  id="queue-name"
                  value={newQueueName}
                  onChange={(event) => setNewQueueName(event.target.value)}
                  placeholder="events"
                />
                <Button
                  type="submit"
                  disabled={busyAction === "create-queue" || !newQueueName.trim()}
                >
                  {busyAction === "create-queue" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Create queue
                </Button>
              </div>
            </form>

            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Current queues</div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFlashMessage(null);
                  void loadQueues(selectedQueueUrl);
                }}
                disabled={loadingQueues}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${loadingQueues ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

            {loadingQueues ? (
              <StateBlock text="Loading queues..." />
            ) : queues.length === 0 ? (
              <StateBlock text="No queues yet. Create one to start moving events through the platform." />
            ) : (
              <div className="space-y-3">
                {queues.map((queue) => {
                  const isSelected = queue.url === selectedQueueUrl;
                  const isDeleting = busyAction === `delete-queue:${queue.url}`;
                  return (
                    <div
                      key={queue.url}
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
                          onClick={() => setSelectedQueueUrl(queue.url)}
                        >
                          <div className="truncate font-medium">
                            {queue.displayName ?? queue.name}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>{queue.messages} visible</span>
                            <span>{queue.inFlight} in flight</span>
                            <span>{queue.delayed} delayed</span>
                          </div>
                          <div className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
                            {queue.url}
                          </div>
                        </button>
                        <div className="flex items-center gap-2">
                          {isSelected ? <Badge variant="secondary">Selected</Badge> : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={isDeleting}
                            title={`Delete ${queue.name}`}
                            onClick={() => void removeQueue(queue)}
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
            <CardTitle className="text-primary">Message workspace</CardTitle>
            <CardDescription>
              {selectedQueue
                ? `Send, poll, and acknowledge messages for ${selectedQueue.displayName ?? selectedQueue.name}.`
                : "Select a queue to manage messages."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {flashMessage ? <FlashBanner flashMessage={flashMessage} /> : null}

            <form className="grid gap-3 rounded-lg border border-border/80 bg-muted/25 p-4" onSubmit={sendMessage}>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="message-body">
                  Message body
                </label>
                <textarea
                  id="message-body"
                  className="min-h-[180px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={messageBody}
                  onChange={(event) => setMessageBody(event.target.value)}
                  placeholder="Message body"
                  spellCheck={false}
                  disabled={!selectedQueue}
                />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-muted-foreground">
                  Messages are sent exactly as entered.
                </div>
                <Button
                  type="submit"
                  disabled={!selectedQueue || busyAction === "send-message" || !messageBody.trim()}
                >
                  {busyAction === "send-message" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Send message
                </Button>
              </div>
            </form>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-medium">
                {selectedQueue
                  ? `${selectedQueue.displayName ?? selectedQueue.name} messages`
                  : "Messages"}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void purgeSelectedQueue()}
                  disabled={!selectedQueue || busyAction === `purge-queue:${selectedQueue?.url}`}
                >
                  {busyAction === `purge-queue:${selectedQueue?.url}` ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Purge queue
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (!selectedQueue) return;
                    setFlashMessage(null);
                    void loadMessages(selectedQueue.url);
                  }}
                  disabled={!selectedQueue || loadingMessages}
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${loadingMessages ? "animate-spin" : ""}`} />
                  Poll
                </Button>
              </div>
            </div>

            {!selectedQueue ? (
              <StateBlock text="Select a queue to poll messages." />
            ) : loadingMessages ? (
              <StateBlock text="Polling queue..." />
            ) : messages.length === 0 ? (
              <StateBlock text="No visible messages right now. Send one or poll again after producers write to the queue." />
            ) : (
              <div className="space-y-3">
                {messages.map((message) => {
                  const isDeleting = busyAction === `delete-message:${message.messageId}`;
                  return (
                    <div key={message.messageId} className="rounded-lg border p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <MessageSquare className="h-4 w-4 text-muted-foreground" />
                            <div className="truncate font-medium">{message.messageId}</div>
                            <Badge variant="secondary">
                              {message.attributes.ApproximateReceiveCount
                                ? `receive ${message.attributes.ApproximateReceiveCount}`
                                : "visible"}
                            </Badge>
                          </div>
                          <pre className="mt-3 overflow-x-auto rounded-md bg-muted/40 p-3 text-xs leading-6 text-muted-foreground">
                            {message.body}
                          </pre>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isDeleting}
                          title={`Delete ${message.messageId}`}
                          onClick={() => void deleteMessage(message.receiptHandle, message.messageId)}
                        >
                          {isDeleting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FlashBanner({ flashMessage }: { flashMessage: FlashMessage }) {
  return (
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
  );
}

function StateBlock({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-primary/25 bg-muted/35 p-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
