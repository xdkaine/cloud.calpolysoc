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
        if (profile) {
          token.sub = profile.sub ?? token.sub;
          // Keycloak embeds realm roles under realm_access.roles
          const realmAccess = (profile as any).realm_access;
          if (realmAccess?.roles) token.roles = realmAccess.roles;
        }
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
