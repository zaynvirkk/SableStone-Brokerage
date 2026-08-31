import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  equalState,
  oidcConfig,
  safeReturnPath,
  sessionCookie,
} from "../../../lib/oidc";

const clear = (response: NextResponse) => {
  for (const name of [
    "sablestone_oidc_state",
    "sablestone_oidc_verifier",
    "sablestone_oidc_return",
  ])
    response.cookies.delete(name);
};
export async function GET(request: Request) {
  const jar = await cookies(),
    url = new URL(request.url),
    code = url.searchParams.get("code") ?? "",
    state = url.searchParams.get("state") ?? "",
    expectedState = jar.get("sablestone_oidc_state")?.value ?? "",
    verifier = jar.get("sablestone_oidc_verifier")?.value ?? "",
    returnTo = safeReturnPath(jar.get("sablestone_oidc_return")?.value ?? null);
  try {
    if (
      !/^[A-Za-z0-9._~-]{8,4096}$/.test(code) ||
      !equalState(state, expectedState) ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)
    )
      throw new Error("OIDC callback invalid");
    const config = oidcConfig(),
      tokenResponse = await fetch(config.tokenEndpoint, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: config.redirectUri,
          code_verifier: verifier,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      }),
      token = (await tokenResponse.json()) as {
        access_token?: unknown;
        token_type?: unknown;
        expires_in?: unknown;
        refresh_token?: unknown;
      };
    if (
      !tokenResponse.ok ||
      typeof token.access_token !== "string" ||
      token.access_token.length > 16_384 ||
      token.token_type !== "Bearer" ||
      !Number.isSafeInteger(token.expires_in) ||
      Number(token.expires_in) < 60 ||
      token.refresh_token !== undefined
    )
      throw new Error("OIDC token response invalid");
    const validation = await fetch(new URL("/v1/session", config.apiUrl), {
      headers: { authorization: `Bearer ${token.access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!validation.ok) throw new Error("OIDC API token rejected");
    const session = (await validation.json()) as { expiresAt?: unknown };
    if (
      typeof session.expiresAt !== "string" ||
      Date.parse(session.expiresAt) <= Date.now()
    )
      throw new Error("OIDC session expiry invalid");
    const response = NextResponse.redirect(new URL(returnTo, request.url));
    response.cookies.set(
      "sablestone_session",
      token.access_token,
      sessionCookie(
        Math.min(
          Number(token.expires_in),
          Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000),
        ),
      ),
    );
    clear(response);
    return response;
  } catch {
    const response = NextResponse.redirect(
      new URL("/?auth=failed", request.url),
    );
    response.cookies.delete("sablestone_session");
    clear(response);
    return response;
  }
}
