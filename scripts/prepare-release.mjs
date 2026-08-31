import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {readdirSync,readFileSync,statSync,mkdirSync,writeFileSync} from "node:fs";
import {join,relative} from "node:path";
const root=process.cwd(),excluded=new Set(["node_modules","dist",".next","releases","artifacts",".git"]),files=[];
function walk(directory){for(const name of readdirSync(directory).sort()){if(excluded.has(name))continue;const path=join(directory,name),stat=statSync(path);if(stat.isDirectory())walk(path);else files.push(relative(root,path));}}
for(const directory of ["src","migrations","scripts","tests","apps/web/app","docs"]){walk(join(root,directory))}for(const file of ["package.json","package-lock.json","tsconfig.json","PRODUCT.md","DESIGN.md","apps/web/package.json","apps/web/package-lock.json"]){if(!files.includes(file))files.push(file)}files.sort();
const hashes=Object.fromEntries(files.map(file=>[file,createHash("sha256").update(readFileSync(join(root,file))).digest("hex")]));
const rootLock=JSON.parse(readFileSync("package-lock.json","utf8")),webLock=JSON.parse(readFileSync("apps/web/package-lock.json","utf8"));
const packages=[];for(const [scope,lock] of [["root",rootLock],["web",webLock]])for(const [path,value] of Object.entries(lock.packages??{}))if(path&&value.version)packages.push({type:"library",name:path.split("node_modules/").pop(),version:value.version,scope});
const sbom={bomFormat:"CycloneDX",specVersion:"1.5",version:1,metadata:{component:{type:"application",name:"sablestone-brokerage",version:"0.0.0"},properties:[{name:"sablestone:evidence","value":"offline-build-only"}]},components:packages.sort((a,b)=>`${a.scope}:${a.name}`.localeCompare(`${b.scope}:${b.name}`))};
const payload={release:"plan66-build-candidate",generatedAt:"2026-08-31T00:00:00+05:30",claim:"BUILD_VERIFIED candidate only; no live/provider/legal claim",liveFlags:{trading:false,outreach:false,settlement:false,productionProviders:false},sourceHashes:hashes,sbomSha256:createHash("sha256").update(JSON.stringify(sbom)).digest("hex")};
const bytes=Buffer.from(JSON.stringify(payload));const {privateKey,publicKey}=generateKeyPairSync("ed25519"),signature=sign(null,bytes,privateKey).toString("base64");
mkdirSync("releases",{recursive:true});writeFileSync("releases/plan66-sbom.cdx.json",JSON.stringify(sbom,null,2)+"\n");writeFileSync("releases/plan66-build-attestation.json",JSON.stringify({...payload,signatureAlgorithm:"Ed25519",publicKeyPem:publicKey.export({type:"spki",format:"pem"}),signatureBase64:signature},null,2)+"\n");
console.log(`release_files=${files.length} components=${packages.length}`);

