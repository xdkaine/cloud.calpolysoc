import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { UserMenu } from "@/components/user-menu";
import { Badge } from "@/components/ui/badge";
import { auth } from "@/auth";
import { getConsoleAccess } from "@/lib/console-access";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/auth/signin");
  const access = getConsoleAccess(session.user.roles);

  return (
    <div className="flex min-h-screen">
      <Sidebar roles={session.user.roles} />
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b bg-card px-6">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>cloud.calpolysoc.org</span>
            <Badge variant={access.canAccessAdmin ? "secondary" : "outline"}>
              {access.label}
            </Badge>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-muted-foreground">VPN connected</span>
            </div>
            <UserMenu
              name={session.user.name ?? session.user.email ?? "user"}
              email={session.user.email ?? undefined}
              roles={session.user.roles}
              audienceLabel={access.label}
            />
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
