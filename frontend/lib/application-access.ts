/** Claims must come from Auth.js's verified OIDC ID-token profile, never request data. */
export function getCloudApplicationAccess(claims: Record<string, unknown> | undefined, now = Date.now()) {
  const amr = claims?.amr;
  const applicationRoles = claims?.application_roles;
  if (!Array.isArray(amr) || !amr.every((value) => typeof value === "string") ||
      !amr.includes("ad") || amr.some((value) =>
        ["local_break_glass", "local_recovery", "portal_local"].includes(value))) return null;
  if (!Array.isArray(applicationRoles) || !applicationRoles.every((value) => typeof value === "string") ||
      !applicationRoles.includes("cloud:access")) return null;
  if (typeof claims?.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp * 1000 <= now) return null;
  if (applicationRoles.includes("cloud:administrator")) return { roles: ["cloud-admin"], expiresAt: claims.exp };
  if (applicationRoles.includes("cloud:user")) return { roles: ["cloud-user"], expiresAt: claims.exp };
  return null;
}

/** Old session cookies have no verified policy evidence and must reauthenticate. */
export function cloudSessionClaims(token: Record<string, unknown>, now = Date.now()) {
  if (token.applicationAccessVersion !== 1) return null;
  return getCloudApplicationAccess({ amr: token.amr, application_roles: token.applicationRoles, exp: token.applicationAccessExpiresAt }, now);
}
