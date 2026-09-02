import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import {
  Agent,
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from "undici";

export interface ResolvedNetworkAddress {
  readonly address: string;
  readonly family: number;
}

export type PublicAddressResolver = (
  hostname: string,
) => Promise<readonly ResolvedNetworkAddress[]>;

function ipv4Number(address: string): number {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    throw new Error("invalid IPv4 address");
  return (
    (((parts[0]! << 24) >>> 0) +
      (parts[1]! << 16) +
      (parts[2]! << 8) +
      parts[3]!) >>>
    0
  );
}

function inIpv4Range(value: number, network: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (network & mask);
}

export function assertPublicNetworkAddress(address: string): void {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address),
      blocked: readonly [string, number][] = [
        ["0.0.0.0", 8],
        ["10.0.0.0", 8],
        ["100.64.0.0", 10],
        ["127.0.0.0", 8],
        ["169.254.0.0", 16],
        ["172.16.0.0", 12],
        ["192.0.0.0", 24],
        ["192.0.2.0", 24],
        ["192.88.99.0", 24],
        ["192.168.0.0", 16],
        ["198.18.0.0", 15],
        ["198.51.100.0", 24],
        ["203.0.113.0", 24],
        ["224.0.0.0", 3],
      ];
    if (
      blocked.some(([network, prefix]) =>
        inIpv4Range(value, ipv4Number(network), prefix),
      )
    )
      throw new Error("non-public discovery address rejected");
    return;
  }
  if (family === 6) {
    const normalized = address.toLowerCase(),
      first = Number.parseInt(normalized.split(":", 1)[0] || "0", 16);
    if (
      first < 0x2000 ||
      first > 0x3fff ||
      /^2001:0?db8:/i.test(normalized) ||
      /^2001:0?0?2:/i.test(normalized) ||
      /^2001:0?0?[12]0:/i.test(normalized)
    )
      throw new Error("non-public discovery address rejected");
    return;
  }
  throw new Error("discovery DNS returned invalid address");
}

export function assertPublicHttpsDomainUrl(value: string): URL {
  const url = new URL(value),
    hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "https:" ||
    isIP(hostname) !== 0 ||
    Boolean(url.username) ||
    Boolean(url.password)
  )
    throw new Error("external provider URL must use a public HTTPS domain");
  return url;
}

export function resolveExternalProviderEndpoint(
  baseUrl: string,
  path: string,
): URL {
  const base = assertPublicHttpsDomainUrl(baseUrl);
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error("provider endpoint path must be root-relative");
  const endpoint = assertPublicHttpsDomainUrl(new URL(path, base).toString());
  if (endpoint.origin !== base.origin)
    throw new Error("provider endpoint origin mismatch");
  return endpoint;
}

export const systemPublicAddressResolver: PublicAddressResolver = async (
  hostname,
) =>
  dnsLookup(hostname, { all: true, verbatim: true }).then((addresses) =>
    addresses.map(({ address, family }) => ({ address, family })),
  );

export function createPinnedPublicLookup(
  resolver: PublicAddressResolver = systemPublicAddressResolver,
): LookupFunction {
  return (hostname, options, callback) => {
    void resolver(hostname)
      .then((addresses) => {
        if (!addresses.length) throw new Error("discovery DNS returned empty");
        for (const result of addresses) {
          if (result.family !== isIP(result.address))
            throw new Error("discovery DNS family mismatch");
          assertPublicNetworkAddress(result.address);
        }
        if (options.all) callback(null, [...addresses]);
        else {
          const selected = addresses[0]!;
          callback(null, selected.address, selected.family);
        }
      })
      .catch((error: unknown) =>
        callback(
          error instanceof Error
            ? Object.assign(error, { code: "EACCES" })
            : Object.assign(new Error("discovery DNS rejected"), {
                code: "EACCES",
              }),
          "",
          0,
        ),
      );
  };
}

/** Uses the validated DNS result as the socket lookup answer, so connection
 * establishment cannot perform a second, attacker-controlled resolution. */
export function createPinnedPublicFetch(
  resolver: PublicAddressResolver = systemPublicAddressResolver,
): typeof fetch {
  const dispatcher = new Agent({
    connect: { lookup: createPinnedPublicLookup(resolver) },
  });
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input !== "string" && !(input instanceof URL))
      throw new Error("pinned discovery fetch requires an explicit URL");
    const url = assertPublicHttpsDomainUrl(String(input));
    const response = await undiciFetch(url, {
      ...(init as unknown as UndiciRequestInit),
      redirect: init?.redirect ?? "error",
      dispatcher,
    });
    return response as unknown as Response;
  }) as typeof fetch;
}

export async function readBoundedResponseBody(
  response: Pick<Response, "body" | "headers">,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1)
    throw new Error("response byte limit invalid");
  const declaredRaw = response.headers.get("content-length");
  if (declaredRaw !== null) {
    if (!/^\d+$/.test(declaredRaw))
      throw new Error("provider content length invalid");
    const declared = Number(declaredRaw);
    if (!Number.isSafeInteger(declared) || declared > maximumBytes)
      throw new Error("provider response too large");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("provider response too large");
        throw new Error("provider response too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
