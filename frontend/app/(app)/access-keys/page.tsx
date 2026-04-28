import { auth } from "@/auth";
import ComingSoon from "@/components/coming-soon";
import { getConsoleAccess } from "@/lib/console-access";

export default async function Page() {
  const session = await auth();
  const access = getConsoleAccess(session?.user?.roles);

  return (
    <ComingSoon
      title="Access Keys"
      description={
        access.canAccessAdmin
          ? "Customer API credentials, service accounts, and issuance controls"
          : "Your workspace API credentials and automation access"
      }
    />
  );
}
