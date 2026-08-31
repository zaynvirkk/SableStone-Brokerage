import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface OidcConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
  apiUrl: string;
}

function required(key: string): string {
  const value = process.env[key];
  if (!value?.trim()) throw new Error(`OIDC configuration missing:${key}`);
  return value;
}

function trustedHttps(value: string, label: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Error(`OIDC ${label} must be a trusted HTTPS URL`);
  return url.toString();
}
function trustedApi(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("production API URL invalid");
  return url.toString();
}

export function oidcConfig(): OidcConfig {
  const scope =
    process.env.SABLESTONE_OIDC_SCOPE?.trim() || "openid profile email";
  if (
    !scope.split(/\s+/).includes("openid") ||
    scope.includes("offline_access")
  )
    throw new Error(
      "OIDC scope must include openid and exclude offline_access",
    );
  return Object.freeze({
    authorizationEndpoint: trustedHttps(
      required("SABLESTONE_OIDC_AUTHORIZATION_ENDPOINT"),
      "authorization endpoint",
    ),
    tokenEndpoint: trustedHttps(
      required("SABLESTONE_OIDC_TOKEN_ENDPOINT"),
      "token endpoint",
    ),
    clientId: required("SABLESTONE_OIDC_CLIENT_ID"),
    clientSecret: required("SABLESTONE_OIDC_CLIENT_SECRET"),
    redirectUri: trustedHttps(
      required("SABLESTONE_OIDC_REDIRECT_URI"),
      "redirect URI",
    ),
    scope,
    apiUrl: trustedApi(required("SABLESTONE_API_URL")),
  });
}

export function randomBase64Url(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
export function pkceChallenge(verifier: string): string {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(verifier))
    throw new Error("PKCE verifier invalid");
  return createHash("sha256").update(verifier).digest("base64url");
}
export function safeReturnPath(value: string | null): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return "/";
  return value.slice(0, 500);
}
export function equalState(left: string, right: string): boolean {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && a.length >= 32 && timingSafeEqual(a, b);
}
export const transientCookie = Object.freeze({
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 600,
});
export const sessionCookie = (maxAge: number) => {
  if (!Number.isSafeInteger(maxAge) || maxAge < 60)
    throw new Error("OIDC session lifetime too short");
  return Object.freeze({
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.min(3600, maxAge),
  });
};
