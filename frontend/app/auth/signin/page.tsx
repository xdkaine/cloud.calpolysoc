import { signIn } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Cloud, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl = "/", error } = await searchParams;

  return (
    <div className="min-h-screen bg-background">
      <div className="h-2 bg-secondary" />
      <div className="absolute right-6 top-6 z-10">
        <ThemeToggle showLabel />
      </div>
      <div className="grid min-h-[calc(100vh-0.5rem)] lg:grid-cols-[1.05fr_0.95fr]">
        <section className="flex items-center bg-primary px-6 py-20 text-primary-foreground sm:px-10 lg:px-16">
          <div className="max-w-xl">
            <div className="mb-8 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                <Cloud className="h-6 w-6" />
              </div>
              <div>
                <div className="text-lg font-bold">CalPolySOC Cloud</div>
                <div className="text-sm text-primary-foreground/72">
                  Private infrastructure console
                </div>
              </div>
            </div>
            <h1 className="max-w-lg text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              Cal Poly Pomona-aligned access to lab compute and cloud services.
            </h1>
            <p className="mt-5 max-w-lg text-sm leading-7 text-primary-foreground/78 sm:text-base">
              Manage Proxmox-backed instances and Floci-backed storage,
              database, and queue resources with account-scoped controls.
            </p>
            <div className="mt-8 inline-flex items-center gap-2 rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-secondary" />
              CalPolySOC SSO required
            </div>
          </div>
        </section>

        <main className="flex items-center justify-center px-6 py-20 sm:px-10">
          <Card className="w-full max-w-md border-border/80">
            <CardHeader className="border-b border-border/80">
              <div className="mb-3 h-1 w-14 rounded-full bg-secondary" />
              <CardTitle className="text-2xl text-primary">
                Sign in to the console
              </CardTitle>
              <CardDescription>
                Use your CalPolySOC account to open the private cloud workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
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
        </main>
      </div>
    </div>
  );
}
