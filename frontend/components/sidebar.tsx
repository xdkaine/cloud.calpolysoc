"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Cloud,
  Server,
  Database,
  HardDrive,
  Archive,
  Gauge,
  Inbox,
  LayoutDashboard,
  KeyRound,
  ScrollText,
  Settings,
  Rocket,
} from "lucide-react";
import { getConsoleAccess, hasAudience, type ConsoleAudience } from "@/lib/console-access";
import { cn } from "@/lib/utils";

type Item = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  group: string;
  minAudience?: ConsoleAudience;
};

const items: Item[] = [
  { group: "Overview", label: "Dashboard", href: "/", icon: LayoutDashboard },
  { group: "Compute", label: "Instances", href: "/instances", icon: Server },
  { group: "Compute", label: "Launch", href: "/instances/launch", icon: Rocket },
  { group: "Compute", label: "Key Pairs", href: "/key-pairs", icon: KeyRound },
  { group: "Storage", label: "S3 Buckets", href: "/s3", icon: HardDrive },
  { group: "Storage", label: "Volumes", href: "/volumes", icon: HardDrive },
  { group: "Storage", label: "Snapshots", href: "/snapshots", icon: Archive },
  { group: "Database", label: "DynamoDB", href: "/dynamodb", icon: Database },
  { group: "Database", label: "Postgres", href: "/postgres", icon: Database },
  { group: "Database", label: "Redis", href: "/redis", icon: Database },
  { group: "Messaging", label: "SQS Queues", href: "/sqs", icon: Inbox },
  { group: "Operations", label: "Quotas", href: "/quotas", icon: Gauge },
  { group: "Operations", label: "Audit Logs", href: "/audit", icon: ScrollText, minAudience: "staff" },
  { group: "Operations", label: "Settings", href: "/settings", icon: Settings, minAudience: "staff" },
];

function isActiveItem(pathname: string | null, href: string) {
  return href === "/" ? pathname === "/" : pathname?.startsWith(href);
}

function getVisibleItems(roles?: string[]) {
  const access = getConsoleAccess(roles);
  return {
    access,
    visibleItems: items.filter((item) =>
      hasAudience(access.audience, item.minAudience ?? "client"),
    ),
  };
}

export function Sidebar({ roles }: { roles?: string[] }) {
  const pathname = usePathname();
  const { access, visibleItems } = getVisibleItems(roles);
  const groups = Array.from(new Set(visibleItems.map((i) => i.group)));

  return (
    <aside className="hidden w-72 flex-col bg-[#005030] text-white md:flex">
      <div className="flex h-16 items-center gap-3 border-b border-white/15 px-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#FFB81C] text-[#005030] shadow-sm">
          <Cloud className="h-5 w-5" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">CalPolySOC</span>
          <span className="text-xs text-white/70">Private Cloud</span>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-4">
        {groups.map((group) => (
          <div key={group} className="mb-4">
            <div className="px-6 pb-2 text-xs font-semibold uppercase tracking-wider text-white/55">
              {group}
            </div>
            <ul className="space-y-0.5 px-3">
              {visibleItems
                .filter((i) => i.group === group)
                .map((item) => {
                  const active = isActiveItem(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-11 items-center gap-3 rounded-md border-l-4 px-3 py-2 text-sm font-medium transition-colors",
                          active
                            ? "border-[#FFB81C] bg-white text-[#005030] shadow-sm"
                            : "border-transparent text-white/78 hover:bg-white/10 hover:text-white",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/15 p-4 text-xs text-white/70">
        <div className="flex items-center gap-2 font-medium text-white">
          <span className="h-2 w-2 rounded-full bg-[#FFB81C]" />
          {access.label}
        </div>
        <div className="mt-1">Scoped resources</div>
      </div>
    </aside>
  );
}

export function MobileNav({ roles }: { roles?: string[] }) {
  const pathname = usePathname();
  const { visibleItems } = getVisibleItems(roles);

  return (
    <nav
      aria-label="Primary"
      className="border-t border-border/70 bg-card/95 px-3 py-2 shadow-sm md:hidden"
    >
      <div className="flex gap-2 overflow-x-auto pb-1">
        {visibleItems.map((item) => {
          const active = isActiveItem(pathname, item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-primary",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
