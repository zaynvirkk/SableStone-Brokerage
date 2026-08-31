import {createHash,createPublicKey,verify} from "node:crypto";import{readFileSync}from"node:fs";
const sbom=JSON.parse(readFileSync("releases/plan66-sbom.cdx.json","utf8")),att=JSON.parse(readFileSync("releases/plan66-build-attestation.json","utf8"));
const {signatureAlgorithm,publicKeyPem,signatureBase64,...payload}=att;
if(signatureAlgorithm!=="Ed25519"||!verify(null,Buffer.from(JSON.stringify(payload)),createPublicKey(publicKeyPem),Buffer.from(signatureBase64,"base64")))throw new Error("release signature invalid");
if(createHash("sha256").update(JSON.stringify(sbom)).digest("hex")!==att.sbomSha256)throw new Error("SBOM digest mismatch");
for(const [file,digest]of Object.entries(att.sourceHashes))if(createHash("sha256").update(readFileSync(file)).digest("hex")!==digest)throw new Error(`source drift: ${file}`);
if(Object.values(att.liveFlags).some(Boolean)||!att.claim.includes("BUILD_VERIFIED candidate only"))throw new Error("release claim or live flags invalid");
console.log(`RELEASE_OK signed=true sbom=true source_files=${Object.keys(att.sourceHashes).length} live_flags=false operator_gates=blocked`);

