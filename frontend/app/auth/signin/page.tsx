import { signIn } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Cloud } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl = "/", error } = await searchParams;

  return (
    <div className="relative min-h-screen overflow-hidden px-6 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(var(--accent)/0.4),transparent_30%),radial-gradient(circle_at_top_right,hsl(var(--primary)/0.16),transparent_28%)]"
      />
      <div className="absolute right-6 top-6">
        <ThemeToggle showLabel />
      </div>
      <div className="relative flex min-h-[80vh] items-center justify-center">
      <Card className="w-full max-w-md border-border/70 bg-card/90 shadow-2xl shadow-primary/10 backdrop-blur">
        <CardHeader className="items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/20">
            <Cloud className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle>Sign in to CalPolySOC Cloud</CardTitle>
          <CardDescription>
            Manage Proxmox-backed compute and Floci-backed services from a single CalPolySOC control plane.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error === "AccessDenied"
                ? "Access denied. Your account does not have permission to use this console."
                : `Sign-in failed: ${error}`}
            </div>
          ) : null}

          <form
            action={async () => {
              "use server";
              await signIn("keycloak", { redirectTo: callbackUrl });
            }}
          >
            <Button type="submit" className="w-full">
              Continue with CalPolySOC SSO
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            You will be redirected to <code>auth.calpolysoc.org</code>.
          </p>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
