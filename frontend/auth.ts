import NextAuth, { type DefaultSession } from "next-auth";
import Keycloak from "next-auth/providers/keycloak";

/**
 * Auth.js v5 (NextAuth 5) configuration for CalPolySOC SSO.
 *
 * Talks to the internal Keycloak realm at:
 *   https://auth.calpolysoc.org/realms/calpolysoc
 *
 * Required env vars (see .env.example):
 *   AUTH_SECRET                 - random string, used for JWT signing
 *   AUTH_KEYCLOAK_ID            - Keycloak client_id
 *   AUTH_KEYCLOAK_SECRET        - Keycloak client_secret
 *   AUTH_KEYCLOAK_ISSUER        - https://auth.calpolysoc.org/realms/calpolysoc
 *   AUTH_TRUST_HOST             - true (we run behind Nginx)
 */

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    idToken?: string;
    error?: "RefreshAccessTokenError";
    user: {
      id?: string;
      roles?: string[];
    } & DefaultSession["user"];
  }
}

type AppJWT = {
  accessToken?: string;
  idToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  roles?: string[];
  sub?: string;
  error?: "RefreshAccessTokenError";
  [key: string]: unknown;
};

const issuer = process.env.AUTH_KEYCLOAK_ISSUER!;
const keycloakClientId = process.env.AUTH_KEYCLOAK_ID!;

type KeycloakClaims = {
  sub?: string;
  realm_access?: {
    roles?: string[];
  };
  resource_access?: Record<string, { roles?: string[] }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function decodeJwtClaims(token: string | undefined): KeycloakClaims | null {
  if (!token) return null;

  const segments = token.split(".");
  if (segments.length < 2) return null;

  try {
    const payload = segments[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(segments[1].length / 4) * 4, "=");
    const decoded = Buffer.from(payload, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    return isRecord(parsed) ? (parsed as KeycloakClaims) : null;
  } catch {
    return null;
  }
}

function extractStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function extractRolesFromClaims(claims: KeycloakClaims | null | undefined) {
  if (!claims) return [];

  const realmRoles = extractStringArray(claims.realm_access?.roles);
  const clientRoles = extractStringArray(
    claims.resource_access?.[keycloakClientId]?.roles,
  );

  return Array.from(new Set([...realmRoles, ...clientRoles]));
}

function resolveRoles(input: {
  profile?: unknown;
  accessToken?: string;
  idToken?: string;
  fallback?: string[];
}) {
  const profileClaims = isRecord(input.profile)
    ? (input.profile as KeycloakClaims)
    : null;
  const accessTokenClaims = decodeJwtClaims(input.accessToken);
  const idTokenClaims = decodeJwtClaims(input.idToken);

  return Array.from(
    new Set([
      ...extractRolesFromClaims(profileClaims),
      ...extractRolesFromClaims(accessTokenClaims),
      ...extractRolesFromClaims(idTokenClaims),
      ...(input.fallback ?? []),
    ]),
  );
}

function resolveSubject(input: {
  profile?: unknown;
  accessToken?: string;
  idToken?: string;
  fallback?: string;
}) {
  const profileClaims = isRecord(input.profile)
    ? (input.profile as KeycloakClaims)
    : null;
  const accessTokenClaims = decodeJwtClaims(input.accessToken);
  const idTokenClaims = decodeJwtClaims(input.idToken);

  return (
    profileClaims?.sub ??
    accessTokenClaims?.sub ??
    idTokenClaims?.sub ??
    input.fallback
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [
    Keycloak({
      clientId: process.env.AUTH_KEYCLOAK_ID!,
      clientSecret: process.env.AUTH_KEYCLOAK_SECRET!,
      issuer,
      authorization: { params: { scope: "openid profile email offline_access" } },
    }),
  ],
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  callbacks: {
    async jwt({ token: rawToken, account, profile }) {
      const token = rawToken as AppJWT;
      // Initial sign-in: stash tokens
      if (account) {
        token.accessToken = account.access_token;
        token.idToken = account.id_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at
          ? account.expires_at * 1000
          : Date.now() + 60_000;
        token.sub = resolveSubject({
          profile,
          accessToken: account.access_token,
          idToken: account.id_token,
          fallback: token.sub,
        });
        token.roles = resolveRoles({
          profile,
          accessToken: account.access_token,
          idToken: account.id_token,
          fallback: token.roles,
        });
        return token;
      }

      // Token still valid (60s skew)
      if (token.expiresAt && Date.now() < token.expiresAt - 60_000) {
        return token;
      }

      // Try refresh
      if (!token.refreshToken) return token;
      try {
        const res = await fetch(`${issuer}/protocol/openid-connect/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: process.env.AUTH_KEYCLOAK_ID!,
            client_secret: process.env.AUTH_KEYCLOAK_SECRET!,
            refresh_token: token.refreshToken,
          }),
          cache: "no-store",
        });
        const refreshed = await res.json();
        if (!res.ok) throw refreshed;
        return {
          ...token,
          accessToken: refreshed.access_token,
          idToken: refreshed.id_token ?? token.idToken,
          refreshToken: refreshed.refresh_token ?? token.refreshToken,
          expiresAt: Date.now() + refreshed.expires_in * 1000,
          sub: resolveSubject({
            accessToken: refreshed.access_token,
            idToken: refreshed.id_token ?? token.idToken,
            fallback: token.sub,
          }),
          roles: resolveRoles({
            accessToken: refreshed.access_token,
            idToken: refreshed.id_token ?? token.idToken,
            fallback: token.roles,
          }),
          error: undefined,
        };
      } catch {
        return { ...token, error: "RefreshAccessTokenError" };
      }
    },
    async session({ session, token: rawToken }) {
      const token = rawToken as AppJWT;
      session.accessToken = token.accessToken;
      session.idToken = token.idToken;
      session.error = token.error;
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.roles = token.roles;
      }
      return session;
    },
  },
});
