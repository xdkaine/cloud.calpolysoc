import type { ConsoleIdentityUser, Instance } from "@/lib/api";

function normalized(value?: string | null) {
  return value?.trim().toLowerCase() || "";
}

function withoutGroupPrefix(value: string) {
  return value.startsWith("@") ? value.slice(1) : value;
}

function userPrincipalCandidates(user?: ConsoleIdentityUser | null) {
  const candidates = new Set<string>();

  for (const value of [user?.id, user?.email, user?.name]) {
    const current = normalized(value);
    if (current) candidates.add(current);
  }

  const email = normalized(user?.email);
  const atIndex = email.indexOf("@");
  if (atIndex > 0) {
    const localPart = email.slice(0, atIndex);
    candidates.add(`${localPart}@pam`);
    candidates.add(`${localPart}@pve`);
    candidates.add(`${localPart}@calpolysoc`);
  }

  return candidates;
}

function userRoleCandidates(user?: ConsoleIdentityUser | null) {
  return new Set(
    (user?.roles ?? [])
      .map((role) => withoutGroupPrefix(normalized(role)))
      .filter(Boolean),
  );
}

function instanceOwnerCandidates(instance: Instance) {
  const owner = instance.owner;
  return [
    owner?.principal,
    owner?.email,
    owner?.id,
    owner?.name,
    owner?.acl_subject,
    instance.owner_principal,
    instance.owner_email,
  ]
    .map(normalized)
    .filter(Boolean);
}

function hasOwnerMatch(instance: Instance, user?: ConsoleIdentityUser | null) {
  const userCandidates = userPrincipalCandidates(user);
  if (userCandidates.size === 0) return false;

  return instanceOwnerCandidates(instance).some((candidate) =>
    userCandidates.has(candidate),
  );
}

function hasAclMatch(instance: Instance, user?: ConsoleIdentityUser | null) {
  const userCandidates = userPrincipalCandidates(user);
  const roleCandidates = userRoleCandidates(user);
  if (userCandidates.size === 0 && roleCandidates.size === 0) return false;

  return (instance.acl_entries ?? []).some((entry) => {
    const subject = normalized(entry.ugid);
    if (!subject) return false;

    if (userCandidates.has(subject)) return true;

    const group = withoutGroupPrefix(subject);
    return normalized(entry.type) === "group" && roleCandidates.has(group);
  });
}

export function canSeeInstance(
  instance: Instance,
  user?: ConsoleIdentityUser | null,
  canAccessAdmin = false,
) {
  if (canAccessAdmin) return true;
  return hasOwnerMatch(instance, user) || hasAclMatch(instance, user);
}

export function isInstanceOwnedByUser(
  instance: Instance,
  user?: ConsoleIdentityUser | null,
) {
  return hasOwnerMatch(instance, user);
}

export function visibleInstancesForUser(
  instances: Instance[],
  user?: ConsoleIdentityUser | null,
  canAccessAdmin = false,
) {
  return instances.filter((instance) =>
    canSeeInstance(instance, user, canAccessAdmin),
  );
}
