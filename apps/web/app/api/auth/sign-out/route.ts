import { NextResponse } from "next/server";
export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.delete("sablestone_session");
  for (const name of [
    "sablestone_oidc_state",
    "sablestone_oidc_verifier",
    "sablestone_oidc_return",
  ])
    response.cookies.delete(name);
  return response;
}
