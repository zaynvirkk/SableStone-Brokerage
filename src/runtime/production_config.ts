import type { ProductionActivationPayload } from "./activation.js";

export function validateProductionEnvironment(
  env: Readonly<Record<string,string|undefined>>,
  activation: Readonly<ProductionActivationPayload>,
):void{
  const requireKeys=(capability:string,keys:readonly string[])=>{for(const key of keys)if(!env[key]?.trim())throw new Error(`${capability} configuration missing: ${key}`)};
  if(activation.capabilities.includes("OUTREACH"))requireKeys("OUTREACH",["SABLESTONE_GMAIL_CLIENT_ID","SABLESTONE_GMAIL_CLIENT_SECRET","SABLESTONE_GMAIL_REFRESH_TOKEN","SABLESTONE_GMAIL_USER_ID","SABLESTONE_GMAIL_PUBSUB_TOPIC","SABLESTONE_GMAIL_PUSH_AUDIENCE","SABLESTONE_GMAIL_PUSH_SERVICE_ACCOUNT_EMAIL","SABLESTONE_PORTAL_BASE_URL","SABLESTONE_ACTION_LINK_SECRET","SABLESTONE_IDENTITY_PROVISIONING_JSON"]);
  if(activation.capabilities.includes("DISCOVERY"))requireKeys("DISCOVERY",["SABLESTONE_SEARCH_JSON","SABLESTONE_ENRICHMENT_JSON","SABLESTONE_KYB_JSON"]);
  if(activation.capabilities.includes("TRADING"))requireKeys("TRADING",["SABLESTONE_DOCUMENT_EXTRACTOR_JSON","SABLESTONE_DOCUMENT_VERIFIER_JSON","SABLESTONE_ECONOMIC_QUOTE_PROVIDERS_JSON","SABLESTONE_COMMERCIAL_EXTRACTOR_JSON","SABLESTONE_TEMPORAL_ADDRESS"]);
  if(activation.capabilities.includes("SETTLEMENT")){requireKeys("SETTLEMENT",["SABLESTONE_SETTLEMENT_PROVIDERS_JSON","SABLESTONE_BANK_WEBHOOKS_JSON"]);const providers=JSON.parse(env.SABLESTONE_SETTLEMENT_PROVIDERS_JSON!);if(!Array.isArray(providers)||providers.length<1)throw new Error("SETTLEMENT requires at least one approved provider configuration");}
  if(activation.capabilities.some((value)=>value!=="DEPLOY")&&env.SABLESTONE_OBJECT_STORAGE_OBJECT_LOCK!=="true")throw new Error("operational activation requires Object Lock evidence storage");
  if(env.SABLESTONE_OTEL_ENABLED==="true"&&!env.SABLESTONE_OTEL_ENDPOINT?.startsWith("https://"))throw new Error("enabled telemetry requires HTTPS OTLP endpoint");
}
