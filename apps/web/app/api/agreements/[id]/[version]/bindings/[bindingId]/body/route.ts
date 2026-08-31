import { cookies } from "next/headers";

export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ id: string; version: string; bindingId: string }> },
) {
  const base = process.env.SABLESTONE_API_URL,
    token = (await cookies()).get("sablestone_session")?.value,
    { id, version, bindingId } = await params;
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
  try {
    const response = await fetch(
      new URL(
        `/v1/agreements/${encodeURIComponent(id)}/${encodeURIComponent(version)}/bindings/${encodeURIComponent(bindingId)}/body`,
        base,
      ),
      {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok)
      return Response.json(
        {
          error:
            response.status === 401
              ? "AUTH_REQUIRED"
              : response.status === 403
                ? "FORBIDDEN"
                : "AGREEMENT_UNAVAILABLE",
        },
        { status: response.status },
      );
    const digest = response.headers.get("x-sablestone-body-sha256");
    if (!digest || !/^[0-9a-f]{64}$/.test(digest))
      return Response.json(
        { error: "AGREEMENT_DIGEST_MISSING" },
        { status: 502 },
      );
    return new Response(await response.arrayBuffer(), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition":
          response.headers.get("content-disposition") ?? "inline",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "x-sablestone-body-sha256": digest,
        vary: "Cookie",
      },
    });
  } catch {
    return Response.json({ error: "AGREEMENT_UNAVAILABLE" }, { status: 503 });
  }
}
