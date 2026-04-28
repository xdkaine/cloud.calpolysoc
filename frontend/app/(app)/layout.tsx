import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
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
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border/70 bg-background/85 px-4 backdrop-blur-sm supports-[backdrop-filter]:bg-background/75 sm:px-6">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="hidden sm:inline">cloud.calpolysoc.org</span>
            <Badge variant={access.canAccessAdmin ? "secondary" : "outline"}>
              {access.label}
            </Badge>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <ThemeToggle />
            <div className="hidden items-center gap-2 text-sm sm:flex">
              <span className="inline-block h-2 w-2 rounded-full bg-[hsl(var(--success))]" />
              <span className="text-muted-foreground">VPN connected</span>
            </div>
            <UserMenu
              name={session.user.name ?? session.user.email ?? "user"}
              email={session.user.email ?? undefined}
              audienceLabel={access.label}
            />
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
