import { cookies } from "next/headers";
import { NextResponse } from "next/server";

type Agreement = {
  id: string;
  version: string;
  agreement_kind: string;
  agreement_binding_id: string;
  resource_type: "ORG_MASTER" | "MATCH" | "TRADE";
  resource_id: string;
};
const json = async (response: Response) => {
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
};
export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; version: string; bindingId: string }> },
) {
  const requestUrl = new URL(request.url),
    origin = request.headers.get("origin"),
    { id, version, bindingId } = await params,
    token = (await cookies()).get("sablestone_session")?.value,
    base = process.env.SABLESTONE_API_URL;
  if (!origin || origin !== requestUrl.origin)
    return Response.json({ error: "CSRF_REJECTED" }, { status: 403 });
  if (!token) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  if (!base)
    return Response.json({ error: "API_UNAVAILABLE" }, { status: 503 });
  if (
    !/^[0-9a-f-]{36}$/i.test(id) ||
    !/^[0-9a-f-]{36}$/i.test(bindingId) ||
    !version ||
    version.length > 100
  )
    return Response.json({ error: "REFERENCE_INVALID" }, { status: 400 });
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  try {
    const listing = (await json(
        await fetch(new URL("/v1/agreements", base), {
          headers,
          cache: "no-store",
          signal: AbortSignal.timeout(5_000),
        }),
      )) as { items?: unknown },
      agreement = Array.isArray(listing.items)
        ? listing.items.find((value): value is Agreement =>
            Boolean(
              value &&
              typeof value === "object" &&
              (value as Agreement).id === id &&
              (value as Agreement).version === version &&
              (value as Agreement).agreement_binding_id === bindingId,
            ),
          )
        : undefined;
    if (!agreement) throw new Error("bound agreement unavailable");
    const accepted = await json(
        await fetch(
          new URL(
            `/v1/agreements/${encodeURIComponent(id)}/${encodeURIComponent(version)}/acceptance`,
            base,
          ),
          {
            method: "POST",
            headers,
            body: JSON.stringify({ agreementBindingId: bindingId }),
            cache: "no-store",
            signal: AbortSignal.timeout(5_000),
          },
        ),
      ),
      acceptanceId = accepted.acceptanceId;
    if (
      typeof acceptanceId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(acceptanceId)
    )
      throw new Error("acceptance receipt invalid");
    if (
      [
        "PROTECTED_ACCOUNT_NOTICE",
        "PROTECTED_SUPPLIER_ACKNOWLEDGEMENT",
      ].includes(agreement.agreement_kind)
    )
      await json(
        await fetch(
          new URL(
            `/v1/matches/${encodeURIComponent(agreement.resource_id)}/protected-acceptance`,
            base,
          ),
          {
            method: "POST",
            headers,
            body: JSON.stringify({ agreementAcceptanceId: acceptanceId }),
            cache: "no-store",
            signal: AbortSignal.timeout(5_000),
          },
        ),
      );
    if (agreement.agreement_kind === "TRANSACTION_CONFIRMATION")
      await json(
        await fetch(
          new URL(
            `/v1/trades/${encodeURIComponent(agreement.resource_id)}/contract-acceptance`,
            base,
          ),
          {
            method: "POST",
            headers,
            body: JSON.stringify({ agreementAcceptanceId: acceptanceId }),
            cache: "no-store",
            signal: AbortSignal.timeout(5_000),
          },
        ),
      );
    const destination =
      agreement.resource_type === "TRADE"
        ? `/trade/${encodeURIComponent(agreement.resource_id)}?accepted=1`
        : agreement.agreement_kind.includes("SUPPLIER") ||
            agreement.agreement_kind === "PROTECTED_ACCOUNT_NOTICE"
          ? "/supplier?accepted=1"
          : "/buyer?accepted=1";
    return NextResponse.redirect(new URL(destination, request.url), 303);
  } catch {
    return NextResponse.redirect(
      new URL("/?acceptance=failed", request.url),
      303,
    );
  }
}
