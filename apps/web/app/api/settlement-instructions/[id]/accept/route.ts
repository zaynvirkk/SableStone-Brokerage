import { cookies } from "next/headers";
import { NextResponse } from "next/server";

type Trade = {
  id: string;
  settlement: { id: string; instructionDigest: string } | null;
};
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestUrl = new URL(request.url),
    origin = request.headers.get("origin"),
    { id } = await params,
    token = (await cookies()).get("sablestone_session")?.value,
    base = process.env.SABLESTONE_API_URL,
    tradeId = requestUrl.searchParams.get("tradeId") ?? "";
  if (!origin || origin !== requestUrl.origin)
    return Response.json({ error: "CSRF_REJECTED" }, { status: 403 });
  if (!token) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  if (!base)
    return Response.json({ error: "API_UNAVAILABLE" }, { status: 503 });
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(tradeId))
    return Response.json({ error: "REFERENCE_INVALID" }, { status: 400 });
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  try {
    const tradeResponse = await fetch(
      new URL(`/v1/trades/${encodeURIComponent(tradeId)}`, base),
      { headers, cache: "no-store", signal: AbortSignal.timeout(5_000) },
    );
    if (!tradeResponse.ok) throw new Error("trade unavailable");
    const trade = (await tradeResponse.json()) as Trade;
    if (
      trade.id !== tradeId ||
      trade.settlement?.id !== id ||
      !/^[0-9a-f]{64}$/.test(trade.settlement.instructionDigest)
    )
      throw new Error("current instruction mismatch");
    const accepted = await fetch(
      new URL(
        `/v1/settlement-instructions/${encodeURIComponent(id)}/acceptance`,
        base,
      ),
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          instructionDigest: trade.settlement.instructionDigest,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!accepted.ok) throw new Error("instruction acceptance rejected");
    return NextResponse.redirect(
      new URL(
        `/trade/${encodeURIComponent(tradeId)}?settlementAccepted=1`,
        request.url,
      ),
      303,
    );
  } catch {
    return NextResponse.redirect(
      new URL(
        `/trade/${encodeURIComponent(tradeId)}?settlementAcceptance=failed`,
        request.url,
      ),
      303,
    );
  }
}
