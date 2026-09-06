import { providerSessionActive } from "./lib/provider-session";
import NextAuth, { type DefaultSession } from "next-auth";
import type { Provider } from "@auth/core/providers";
import { getCloudApplicationAccess, cloudSessionClaims } from "./lib/application-access";

/**
 * Auth.js v5 (NextAuth 5) configuration for CalPolySOC SSO.
 *
 * Delegates authentication to the platform auth-service — a standalone
 * OpenID Connect provider (authorization-code + PKCE, RS256 tokens):
 *   https://auth-dev.calpolysoc.org/   (issuer)
 *
 * Required env vars (see .env.example):
 *   AUTH_SECRET            - random string, used for JWT session signing
 *   AUTH_OIDC_ISSUER       - auth-service issuer URL
 *   AUTH_OIDC_CLIENT_ID    - registered OIDC client id
 *   AUTH_OIDC_CLIENT_SECRET- registered OIDC client secret
 *   AUTH_TRUST_HOST        - true (we run behind Nginx)
 *
 * The auth-service does not issue refresh tokens (offline_access is not an
 * allowed scope), so the Auth.js JWT session simply lives for
 * `session.maxAge` and re-authenticates through the IdP when it expires.
 */

declare module "next-auth" {
  interface Session {
    error?: "RefreshAccessTokenError";
    user: {
      id?: string;
      roles?: string[];
    } & DefaultSession["user"];
  }
}

type AppJWT = {
  roles?: string[];
  sub?: string;
  error?: "RefreshAccessTokenError";
  [key: string]: unknown;
};

const issuer = process.env.AUTH_OIDC_ISSUER!;
const requireApplicationAccess = process.env.AUTH_REQUIRE_APPLICATION_ACCESS === "true";

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Roles are AD group CNs supplied by the auth-service `groups` claim. */
const authServiceProvider: Provider = {
  id: "cloud-sso",
  name: "CalPolySOC SSO",
  type: "oidc",
  issuer,
  clientId: process.env.AUTH_OIDC_CLIENT_ID!,
  clientSecret: process.env.AUTH_OIDC_CLIENT_SECRET!,
  authorization: { params: { scope: "openid email profile amr groups" } },
  // The auth-service mandates PKCE (S256) for every client.
  checks: ["state", "pkce", "nonce"],
  profile(profile: Record<string, unknown>) {
    const preferredUsername =
      typeof profile.preferred_username === "string" ? profile.preferred_username : undefined;
    const name =
      typeof profile.name === "string" && profile.name ? profile.name : preferredUsername;
    return {
      id: String(profile.sub ?? ""),
      name: name || undefined,
      email: typeof profile.email === "string" ? profile.email : undefined,
      image: undefined,
      preferredUsername,
    };
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: requireApplicationAccess ? 600 : 8 * 60 * 60 },
  providers: [authServiceProvider],
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  callbacks: {
    async signIn({ profile }) {
      return !requireApplicationAccess || getCloudApplicationAccess(profile) !== null;
    },
    async jwt({ token: rawToken, account, profile }) {
      const token = rawToken as AppJWT;
      // Initial sign-in: derive identity from verified claims.
      // No refresh flow — the auth-service issues no refresh tokens.
      if (account) {
        const subject =
          (typeof profile?.sub === "string" ? profile.sub : undefined) ??
          (typeof account.sub === "string" ? account.sub : undefined);
        if (subject) token.sub = subject;
        if (requireApplicationAccess) {
          const access = getCloudApplicationAccess(profile);
          if (!access) return null;
          if (typeof profile?.sid !== "string" || !profile.sid || !subject) return null;
          token.providerSid = profile.sid;
          if (!await providerSessionActive(token)) return null;
          token.amr = profile?.amr;
          token.applicationRoles = profile?.application_roles;
          token.applicationAccessExpiresAt = access.expiresAt;
          token.applicationAccessVersion = 1;
          token.roles = access.roles;
          return token;
        }
        token.roles = extractStringArray(
          (profile as Record<string, unknown> | undefined)?.groups,
        );
        return token;
      }
      if (requireApplicationAccess) {
        const access = cloudSessionClaims(token);
        if (!access || !await providerSessionActive(token)) return null;
        token.roles = access.roles;
      }
      return token;
    },
    async session({ session, token: rawToken }) {
      const token = rawToken as AppJWT;
      // OAuth credentials and provider session identifiers remain server-side.
      session.error = token.error;
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.roles = token.roles;
      }
      return session;
    },
  },
});
