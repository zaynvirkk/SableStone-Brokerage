import { NextResponse } from "next/server";
import {
  oidcConfig,
  pkceChallenge,
  randomBase64Url,
  safeReturnPath,
  transientCookie,
} from "../../../lib/oidc";

export async function GET(request: Request) {
  try {
    const config = oidcConfig(),
      state = randomBase64Url(),
      verifier = randomBase64Url(48),
      url = new URL(config.authorizationEndpoint),
      returnTo = safeReturnPath(
        new URL(request.url).searchParams.get("returnTo"),
      );
    for (const [key, value] of Object.entries({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scope,
      state,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
    }))
      url.searchParams.set(key, value);
    const response = NextResponse.redirect(url);
    response.cookies.set("sablestone_oidc_state", state, transientCookie);
    response.cookies.set("sablestone_oidc_verifier", verifier, transientCookie);
    response.cookies.set("sablestone_oidc_return", returnTo, transientCookie);
    return response;
  } catch {
    return Response.json({ error: "SIGN_IN_UNAVAILABLE" }, { status: 503 });
  }
}
