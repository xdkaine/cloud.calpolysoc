import { auth } from "@/auth";
import AccessDenied from "@/components/access-denied";
import ComingSoon from "@/components/coming-soon";
import { getConsoleAccess } from "@/lib/console-access";

export default async function Page() {
  const session = await auth();
  const access = getConsoleAccess(session?.user?.roles);
  if (!access.canViewAudit) {
    return (
      <AccessDenied
        title="Audit logs"
        description="Platform-wide activity, customer actions, and control-plane traces are staff-only views."
      />
    );
  }

  return (
    <ComingSoon
      title="Audit Logs"
      description="Platform activity, customer events, and operator traces"
    />
  );
}
