"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Cloud,
  Server,
  Database,
  HardDrive,
  Inbox,
  LayoutDashboard,
  Network,
  Shield,
  KeyRound,
  ScrollText,
  Settings,
  Rocket,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Item = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
};

const items: Item[] = [
  { group: "Overview", label: "Dashboard", href: "/", icon: LayoutDashboard },
  { group: "Compute", label: "Instances", href: "/instances", icon: Server },
  { group: "Compute", label: "Launch", href: "/instances/launch", icon: Rocket },
  { group: "Storage", label: "S3 Buckets", href: "/s3", icon: HardDrive },
  { group: "Database", label: "DynamoDB", href: "/dynamodb", icon: Database },
  { group: "Messaging", label: "SQS Queues", href: "/sqs", icon: Inbox },
  { group: "Network", label: "VPCs", href: "/vpcs", icon: Network },
  { group: "Network", label: "Security Groups", href: "/security-groups", icon: Shield },
  { group: "IAM", label: "Access Keys", href: "/access-keys", icon: KeyRound },
  { group: "IAM", label: "Audit Logs", href: "/audit", icon: ScrollText },
  { group: "Admin", label: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const groups = Array.from(new Set(items.map((i) => i.group)));

  return (
    <aside className="hidden md:flex w-64 flex-col border-r bg-card">
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
          <Cloud className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">CalPolySOC</span>
          <span className="text-xs text-muted-foreground">Private Cloud</span>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-4">
        {groups.map((group) => (
          <div key={group} className="mb-4">
            <div className="px-6 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {group}
            </div>
            <ul className="space-y-0.5 px-3">
              {items
                .filter((i) => i.group === group)
                .map((item) => {
                  const active =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname?.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                          active
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground",
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
      <div className="border-t p-4 text-xs text-muted-foreground">
        <div>region: us-east-1</div>
        <div>account: 000000000000</div>
      </div>
    </aside>
  );
}
