import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { MobileNav, Sidebar } from "@/components/sidebar";
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
    <div className="flex min-h-screen bg-muted/40">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>
      <Sidebar roles={session.user.roles} />
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-border/70 bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/90">
          <div className="flex min-h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3 text-sm">
              <div className="hidden h-6 w-1 rounded-full bg-secondary sm:block" />
              <div className="min-w-0">
                <div className="truncate font-semibold text-primary">
                  cloud.calpolysoc.org
                </div>
                <div className="hidden text-xs text-muted-foreground sm:block">
                  CPP-aligned private cloud console
                </div>
              </div>
              <Badge variant={access.canAccessAdmin ? "secondary" : "outline"}>
                {access.label}
              </Badge>
            </div>
            <div className="flex items-center gap-3 sm:gap-4">
              <ThemeToggle />
              <UserMenu
                name={session.user.name ?? session.user.email ?? "user"}
                email={session.user.email ?? undefined}
                audienceLabel={access.label}
              />
            </div>
          </div>
          <MobileNav roles={session.user.roles} />
        </header>
        <main id="main-content" className="flex-1 p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
