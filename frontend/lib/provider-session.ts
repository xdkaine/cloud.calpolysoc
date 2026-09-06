type SessionIdentity = { providerSid?: unknown; sub?: unknown };
type SessionEnvironment = { issuer: string; clientId: string; clientSecret: string };

function environment(): SessionEnvironment {
  return { issuer: process.env.AUTH_OIDC_ISSUER ?? "", clientId: process.env.AUTH_OIDC_CLIENT_ID ?? "", clientSecret: process.env.AUTH_OIDC_CLIENT_SECRET ?? "" };
}

async function requestSession(path: string, fields: Record<string, string>, env: SessionEnvironment, fetcher: typeof fetch) {
  const issuer = new URL(env.issuer);
  if (issuer.protocol !== "https:" || !env.clientId || !env.clientSecret) throw new Error("Session authority is unavailable");
  const response = await fetcher(`${env.issuer.replace(/\/$/, "")}${path}`, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(5000),
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64")}` },
    body: new URLSearchParams(fields),
  });
  if (!response.ok) throw new Error("Session authority is unavailable");
  return response.json();
}

export async function providerSessionActive(token: SessionIdentity, fetcher: typeof fetch = fetch, env = environment()): Promise<boolean> {
  if (typeof token.providerSid !== "string" || !token.providerSid || typeof token.sub !== "string" || !token.sub) return false;
  try {
    const result = await requestSession("/session/status", { sid: token.providerSid, sub: token.sub }, env, fetcher);
    return result?.active === true;
  } catch { return false; }
}

/** A failed termination must not be mistaken for successful logout. */
export async function terminateProviderSession(token: SessionIdentity, fetcher: typeof fetch = fetch, env = environment()): Promise<void> {
  if (typeof token.providerSid !== "string" || !token.providerSid) throw new Error("This session cannot be ended through the identity provider");
  const result = await requestSession("/session/backchannel-logout", { sid: token.providerSid }, env, fetcher);
  if (typeof result?.destroyed !== "boolean") throw new Error("Session termination was not confirmed");
}
