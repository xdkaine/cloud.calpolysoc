import { signIn } from "@/auth";
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
    <div className="flex min-h-[80vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-md bg-primary">
            <Cloud className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle>Sign in to CalPolySOC Cloud</CardTitle>
          <CardDescription>
            Authenticate with your CalPolySOC SSO account.
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
  );
}
