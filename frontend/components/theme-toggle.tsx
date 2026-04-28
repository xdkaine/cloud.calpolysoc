"use client";

import { MoonStar, SunMedium } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

export function ThemeToggle({
  className,
  showLabel = false,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const nextModeLabel = resolvedTheme === "dark" ? "light" : "dark";

  return (
    <Button
      type="button"
      variant="outline"
      size={showLabel ? "sm" : "icon"}
      className={cn(
        "border-border/70 bg-card/85 shadow-sm backdrop-blur-sm hover:border-primary/40",
        className,
      )}
      title={`Switch to ${nextModeLabel} mode`}
      aria-label={`Switch to ${nextModeLabel} mode`}
      onClick={toggleTheme}
    >
      {resolvedTheme === "dark" ? (
        <SunMedium className="h-4 w-4" />
      ) : (
        <MoonStar className="h-4 w-4" />
      )}
      {showLabel ? (
        <span className="ml-2 capitalize">{nextModeLabel} mode</span>
      ) : null}
    </Button>
  );
}