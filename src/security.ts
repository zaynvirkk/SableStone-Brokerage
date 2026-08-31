import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type Role = "OPERATIONS" | "SUPPLIER" | "BUYER" | "SYSTEM";
export interface Principal { readonly principalId:string; readonly role:Role; readonly organizationId:string|null; readonly sessionExpiresAt:string; readonly disabled:boolean; }
export interface ResourceScope { readonly organizationId:string|null; readonly allowedRoles:readonly Role[]; }

export function assertAuthorized(principal:Principal, resource:ResourceScope, now:string):void {
  if (principal.disabled || Date.parse(principal.sessionExpiresAt) <= Date.parse(now)) throw new Error("principal session unavailable");
  if (!resource.allowedRoles.includes(principal.role)) throw new Error("role unauthorized");
  if (resource.organizationId !== null && principal.role !== "OPERATIONS" && principal.role !== "SYSTEM" && principal.organizationId !== resource.organizationId) throw new Error("object scope unauthorized");
}

const SECRET_KEYS=/(authorization|cookie|password|secret|token|bank|accountnumber|ifsc|pan|gst|email|phone|legalname)/i;
export function redactForTelemetry(value:unknown):unknown {
  if (Array.isArray(value)) return value.map(redactForTelemetry);
  if (!value || typeof value!=="object") return value;
  return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,member])=>[key,SECRET_KEYS.test(key)?"[REDACTED]":redactForTelemetry(member)]));
}

export interface SignedWebhook { readonly timestamp:string; readonly signatureHex:string; readonly body:string; }
export function verifyWebhook(input:SignedWebhook,secret:string,now:string,maxAgeSeconds=300):string {
  const age=Math.abs(Date.parse(now)-Date.parse(input.timestamp));
  if (!Number.isFinite(age)||age>maxAgeSeconds*1000) throw new Error("webhook timestamp stale");
  if (!secret || !/^[0-9a-f]{64}$/.test(input.signatureHex)) throw new Error("webhook signature malformed");
  const expected=createHmac("sha256",secret).update(`${input.timestamp}.${input.body}`).digest();
  const supplied=Buffer.from(input.signatureHex,"hex");
  if (supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) throw new Error("webhook signature invalid");
  return createHash("sha256").update(input.body).digest("hex");
}

