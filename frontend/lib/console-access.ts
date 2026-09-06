export type ConsoleAudience = "client" | "staff" | "admin";

export type ConsoleAccess = {
  audience: ConsoleAudience;
  label: string;
  description: string;
  canAccessAdmin: boolean;
  canManageCatalog: boolean;
  canViewAudit: boolean;
};

const EXPLICIT_ROLE_AUDIENCE: Record<string, ConsoleAudience> = {
  "cloud-admin": "admin",
  "cloud-staff": "staff",
  "cloud-operator": "staff",
  "cloud-support": "staff",
  "cloud-user": "client",
  admin: "admin",
  staff: "staff",
};

/**
 * Privileges are mapped from AD group CNs (the auth-service `groups` claim)
 * via env config — mirroring the UAr portal's AUTH_ADMIN_GROUPS pattern:
 *   CLOUD_ADMIN_GROUPS=Domain Admins,Cloud Admins
 *   CLOUD_STAFF_GROUPS=IT Staff,Cloud Staff
 * Unset lists mean no group grants that privilege.
 */
function parseGroupList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((group) => group.trim().toLowerCase())
    .filter(Boolean);
}

const ADMIN_GROUPS = new Set(parseGroupList(process.env.CLOUD_ADMIN_GROUPS));
const STAFF_GROUPS = new Set(parseGroupList(process.env.CLOUD_STAFF_GROUPS));

export function getConsoleAudience(roles?: string[]): ConsoleAudience {
  const normalizedRoles = roles
    ?.map((role) => role.trim().toLowerCase())
    .filter(Boolean) ?? [];

  // In restricted application mode only canonical roles derived from signed
  // application_roles are accepted; legacy AD group environment maps are ignored.
  if (process.env.AUTH_REQUIRE_APPLICATION_ACCESS === "true") {
    return normalizedRoles.includes("cloud-admin") ? "admin" : "client";
  }

  if (normalizedRoles.some((role) => ADMIN_GROUPS.has(role))) {
    return "admin";
  }
  if (normalizedRoles.some((role) => STAFF_GROUPS.has(role))) {
    return "staff";
  }

  const explicitAudience = normalizedRoles
    .map((role) => EXPLICIT_ROLE_AUDIENCE[role])
    .find(Boolean);
  if (explicitAudience) {
    return explicitAudience;
  }

  return "client";
}

export function getConsoleAccess(roles?: string[]): ConsoleAccess {
  const audience = getConsoleAudience(roles);

  if (audience === "admin") {
    return {
      audience,
      label: "Admin console",
      description: "Platform-wide operations, catalog management, and customer support tools.",
      canAccessAdmin: true,
      canManageCatalog: true,
      canViewAudit: true,
    };
  }

  if (audience === "staff") {
    return {
      audience,
      label: "Staff console",
      description: "Operational visibility with support and provisioning controls.",
      canAccessAdmin: true,
      canManageCatalog: true,
      canViewAudit: true,
    };
  }

  return {
    audience,
    label: "Client workspace",
    description: "Workspace-scoped resources and self-service cloud actions.",
    canAccessAdmin: false,
    canManageCatalog: false,
    canViewAudit: false,
  };
}

export function hasAudience(
  current: ConsoleAudience,
  required: ConsoleAudience = "client",
) {
  const order: Record<ConsoleAudience, number> = {
    client: 0,
    staff: 1,
    admin: 2,
  };

  return order[current] >= order[required];
}
