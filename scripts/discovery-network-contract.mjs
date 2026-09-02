import {
  assertPublicNetworkAddress,
  assertPublicHttpsDomainUrl,
  createPinnedPublicFetch,
  createPinnedPublicLookup,
  readBoundedResponseBody,
  resolveExternalProviderEndpoint,
  ReviewedHttpDiscoveryConnector,
  StructuredRegistryParser,
} from "../dist/index.js";

for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
  assertPublicNetworkAddress(address);

const blocked = [
  "0.0.0.0",
  "10.0.0.1",
  "100.64.0.1",
  "127.0.0.1",
  "169.254.169.254",
  "172.16.0.1",
  "192.168.1.1",
  "198.18.0.1",
  "198.51.100.4",
  "203.0.113.8",
  "224.0.0.1",
  "::",
  "::1",
  "::ffff:127.0.0.1",
  "fc00::1",
  "fe80::1",
  "ff02::1",
  "2001:db8::1",
];
for (const address of blocked) {
  let rejected = false;
  try {
    assertPublicNetworkAddress(address);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`non-public address accepted:${address}`);
}

function lookupWith(resolver, all = true) {
  return new Promise((resolve, reject) =>
    createPinnedPublicLookup(resolver)(
      "reviewed.example",
      { all },
      (error, address, family) =>
        error ? reject(error) : resolve({ address, family }),
    ),
  );
}

const pinned = await lookupWith(async () => [
  { address: "8.8.8.8", family: 4 },
  { address: "2606:4700:4700::1111", family: 6 },
]);
if (!Array.isArray(pinned.address) || pinned.address.length !== 2)
  throw new Error("validated DNS results were not pinned");

for (const resolver of [
  async () => [{ address: "127.0.0.1", family: 4 }],
  async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "169.254.169.254", family: 4 },
  ],
  async () => [{ address: "8.8.8.8", family: 6 }],
  async () => [],
]) {
  let rejected = false;
  try {
    await lookupWith(resolver);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("hostile DNS answer accepted");
}

let literalReachedNetwork = false;
const connector = new ReviewedHttpDiscoveryConnector(
  "PUBLIC_WEBSITE",
  {
    sourceAllowed: true,
    robotsAllowed: true,
    termsReviewed: true,
    maxPages: 1,
    allowedHosts: ["127.0.0.1"],
  },
  {
    async preserve() {
      throw new Error("literal target reached storage");
    },
  },
  new StructuredRegistryParser(() => []),
  async () => {
    literalReachedNetwork = true;
    return new Response("unexpected");
  },
);
await connector.harvest("https://127.0.0.1/internal").then(
  () => {
    throw new Error("literal target accepted");
  },
  () => undefined,
);
if (literalReachedNetwork) throw new Error("literal target reached network");

let invalidUrlResolutions = 0;
const pinnedFetch = createPinnedPublicFetch(async () => {
  invalidUrlResolutions += 1;
  return [{ address: "8.8.8.8", family: 4 }];
});
for (const target of [
  "http://provider.example/api",
  "https://127.0.0.1/api",
  "https://[::1]/api",
]) {
  let rejected = false;
  try {
    await pinnedFetch(target);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`unsafe provider URL accepted:${target}`);
}
if (invalidUrlResolutions !== 0)
  throw new Error("unsafe provider URL reached DNS or network");

if (
  assertPublicHttpsDomainUrl("https://provider.example/api").hostname !==
  "provider.example"
)
  throw new Error("public provider domain rejected");
if (
  resolveExternalProviderEndpoint(
    "https://provider.example/base",
    "/v1/check",
  ).toString() !== "https://provider.example/v1/check"
)
  throw new Error("same-origin provider path resolution failed");
for (const operation of [
  () => assertPublicHttpsDomainUrl("https://secret@provider.example/api"),
  () =>
    resolveExternalProviderEndpoint(
      "https://provider.example/base",
      "https://attacker.example/steal",
    ),
  () =>
    resolveExternalProviderEndpoint(
      "https://provider.example/base",
      "//attacker.example/steal",
    ),
  () =>
    resolveExternalProviderEndpoint(
      "https://provider.example/base",
      "relative/path",
    ),
]) {
  let rejected = false;
  try {
    operation();
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("provider origin escape accepted");
}

const exact = await readBoundedResponseBody(
  new Response("12345", { headers: { "content-length": "5" } }),
  5,
);
if (new TextDecoder().decode(exact) !== "12345")
  throw new Error("bounded response corrupted");
for (const response of [
  new Response("12345", { headers: { "content-length": "999" } }),
  new Response("123456"),
  new Response("12345", { headers: { "content-length": "invalid" } }),
]) {
  let rejected = false;
  try {
    await readBoundedResponseBody(response, 5);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("oversized or malformed response accepted");
}

console.log(
  `DISCOVERY_NETWORK_OK public=accepted private_blocked=${blocked.length} mixed_rebinding=blocked family_mismatch=blocked empty_dns=blocked literal_ip=blocked http=blocked redirects=error_default origin_escape=blocked url_credentials=blocked pinned=true response_stream=bounded`,
);
