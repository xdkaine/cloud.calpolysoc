import { auth } from "@/auth";
import AccessDenied from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { readAuditEvents } from "@/lib/audit";
import { getConsoleAccess } from "@/lib/console-access";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await auth();
  const access = getConsoleAccess(session?.user?.roles);
  if (!access.canViewAudit) {
    return (
      <AccessDenied
        title="Audit events"
        description="Platform activity is available to staff and administrators."
      />
    );
  }

  const events = await readAuditEvents(100);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit Events"
        description="Review recent platform actions and their actor, resource, and result context."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-primary">Current actor</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-3">
          <InfoRow
            label="Account"
            value={session?.user?.email ?? session?.user?.name ?? "Unavailable"}
          />
          <InfoRow label="Subject" value={session?.user?.id ?? "Unavailable"} />
          <InfoRow label="Audience" value={access.label} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-primary">Recent events</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {events.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No audit events recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Actor</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">Resource</th>
                    <th className="px-4 py-3 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id} className="border-b last:border-b-0">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {new Date(event.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">
                          {event.actor.email ?? event.actor.name ?? "Unknown"}
                        </div>
                        <div className="max-w-[18rem] truncate font-mono text-xs text-muted-foreground">
                          {event.actor.subject}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                        {event.action}
                      </td>
                      <td className="px-4 py-3">
                        <div>{event.resourceType}</div>
                        {event.resourceId ? (
                          <div className="max-w-[22rem] truncate font-mono text-xs text-muted-foreground">
                            {event.resourceId}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={event.result === "success" ? "success" : "destructive"}
                        >
                          {event.status ? `${event.result} ${event.status}` : event.result}
                        </Badge>
                        {event.message ? (
                          <div className="mt-2 max-w-[24rem] truncate text-xs text-muted-foreground">
                            {event.message}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-xs">{value}</div>
    </div>
  );
}
