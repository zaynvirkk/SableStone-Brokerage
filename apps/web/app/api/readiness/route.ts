import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET() {
  const base = process.env.SABLESTONE_API_URL,
    token = process.env.SABLESTONE_API_SERVICE_TOKEN;
  if (!base || !token)
    return NextResponse.json(
      {
        state: "BLOCKED_OPERATOR",
        reason:
          "Production API credentials are not configured for this deployment.",
      },
      { status: 503 },
    );
  try {
    const response = await fetch(new URL("/v1/readiness", base), {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }),
      body = await response.json();
    if (!response.ok)
      return NextResponse.json(
        {
          state:
            response.status === 401 || response.status === 403
              ? "PERMISSION_DENIED"
              : "UNAVAILABLE",
          reason: "The production API refused the readiness request.",
        },
        { status: response.status },
      );
    return NextResponse.json({ state: "CONNECTED", ...body });
  } catch {
    return NextResponse.json(
      {
        state: "UNAVAILABLE",
        reason:
          "The production API could not be reached. Live capabilities remain disabled.",
      },
      { status: 503 },
    );
  }
}
