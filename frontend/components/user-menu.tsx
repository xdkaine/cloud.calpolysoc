import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { LogOut, User } from "lucide-react";

export function UserMenu({
  name,
  email,
  audienceLabel,
}: {
  name: string;
  email?: string;
  audienceLabel?: string;
}) {
  const initials = (name || email || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
  const secondaryLabel = email && name !== email ? email : audienceLabel;

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right text-xs leading-tight sm:block">
        <div className="font-medium">{name}</div>
        {secondaryLabel ? (
          <div className="text-muted-foreground">{secondaryLabel}</div>
        ) : null}
      </div>
      <div
        className="flex h-9 w-9 items-center justify-center rounded-full border border-primary/15 bg-primary/10 text-sm font-semibold text-primary shadow-sm"
        title={name}
      >
        {initials || <User className="h-4 w-4" />}
      </div>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/auth/signin" });
        }}
      >
        <Button type="submit" variant="ghost" size="icon" title="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
