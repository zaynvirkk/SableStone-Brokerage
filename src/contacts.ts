export type EmailVerification = "VERIFIED" | "UNVERIFIED" | "RISKY" | "BOUNCED";
export type ContactSource = "PUBLIC_COMPANY_SITE" | "HUNTER" | "APOLLO" | "INBOUND" | "GUESSED";

export interface ContactRecord {
  readonly contactId: string;
  readonly organizationId: string;
  readonly email: string;
  readonly source: ContactSource;
  readonly sourceReceiptId: string;
  readonly verification: EmailVerification;
  readonly verifiedAt: string | null;
  readonly lawfulBasisPolicyVersion: string;
  readonly jurisdiction: string;
}

export interface ContactPolicy {
  readonly version: string;
  readonly outreachApproved: boolean;
  readonly allowedJurisdictions: readonly string[];
  readonly allowedSources: readonly ContactSource[];
  readonly expiresAt: string;
}

export type SuppressionReason = "UNSUBSCRIBE" | "BOUNCE" | "COMPLAINT" | "LEGAL" | "OPERATOR";
export interface SuppressionEntry {
  readonly normalizedEmail: string;
  readonly reason: SuppressionReason;
  readonly sourceEventId: string;
  readonly createdAt: string;
}

export class GlobalSuppressionRegistry {
  readonly #entries = new Map<string, SuppressionEntry>();

  suppress(email: string, reason: SuppressionReason, sourceEventId: string, createdAt: string): SuppressionEntry {
    const normalizedEmail = normalizeEmail(email);
    const existing = this.#entries.get(normalizedEmail);
    if (existing) return existing;
    const entry = Object.freeze({ normalizedEmail, reason, sourceEventId, createdAt });
    this.#entries.set(normalizedEmail, entry);
    return entry;
  }

  isSuppressed(email: string): boolean { return this.#entries.has(normalizeEmail(email)); }
  entries(): readonly SuppressionEntry[] { return Object.freeze([...this.#entries.values()]); }
}

export function assertContactSendable(
  contact: ContactRecord,
  policy: ContactPolicy,
  suppression: GlobalSuppressionRegistry,
  now: string,
): void {
  normalizeEmail(contact.email);
  if (!policy.outreachApproved || Date.parse(now) >= Date.parse(policy.expiresAt)) throw new Error("outreach policy unavailable or expired");
  if (!policy.allowedJurisdictions.includes(contact.jurisdiction)) throw new Error("jurisdiction not approved");
  if (!policy.allowedSources.includes(contact.source) || contact.source === "GUESSED") throw new Error("contact source not approved");
  if (contact.verification !== "VERIFIED" || !contact.verifiedAt) throw new Error("verified email required");
  if (Date.parse(contact.verifiedAt) > Date.parse(now)) throw new Error("verification time invalid");
  if (contact.lawfulBasisPolicyVersion !== policy.version) throw new Error("contact policy version drift");
  if (suppression.isSuppressed(contact.email)) throw new Error("globally suppressed contact");
}

export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLocaleLowerCase("en-US");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("invalid email");
  return normalized;
}
