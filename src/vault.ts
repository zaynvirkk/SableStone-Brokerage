import type { DecimalString } from "./money.js";

export interface SealedIdentity {
  readonly organizationId: string;
  readonly legalNameCiphertext: string;
  readonly addressCiphertext: string;
  readonly contactCiphertext: string;
  readonly taxIdCiphertext: string;
  readonly bankDetailsCiphertext: string;
  readonly keyVersion: string;
}
export interface AnonymousProfile {
  readonly anonymousAccountId: string;
  readonly industry: string;
  readonly coarseLocation: string;
  readonly volumeBandMt: string;
  readonly materialFamily: string;
  readonly documentStates: readonly string[];
}
export interface ProtectedRelationship {
  readonly relationshipId: string;
  readonly supplierId: string;
  readonly buyerId: string;
  readonly introducedAt: string;
  readonly protectedUntil: string;
  readonly commodityScope: readonly string[];
  readonly affiliateScope: string;
  readonly qualifyingPurchaseDefinition: string;
  readonly commissionType: "PER_KG" | "FIXED";
  readonly commissionRate: DecimalString;
  readonly currency: string;
  readonly supplierAcceptanceId: string;
  readonly supplierAcceptanceSha256: string;
  readonly buyerAcceptanceId: string;
  readonly buyerAcceptanceSha256: string;
  readonly requiredSettlementCapabilities: readonly string[];
}
export interface IdentityReleaseAuthorization {
  readonly relationshipId: string;
  readonly supplierAcceptanceCurrent: boolean;
  readonly buyerAcceptanceCurrent: boolean;
  readonly commissionLocked: boolean;
  readonly settlementAvailable: boolean;
  readonly feeLockId: string | null;
  readonly authorizationDigest: string;
  readonly authorizedAt: string;
}
export interface IdentityReleaseEvent {
  readonly relationshipId: string;
  readonly supplierId: string;
  readonly buyerId: string;
  readonly feeLockId: string;
  readonly authorizationDigest: string;
  readonly releasedAt: string;
}

export class ProtectedIdentityVault {
  readonly #identities = new Map<string, Readonly<SealedIdentity>>();
  readonly #releases = new Map<string, Readonly<IdentityReleaseEvent>>();
  seal(identity: SealedIdentity): void {
    for (const value of [identity.legalNameCiphertext, identity.addressCiphertext, identity.contactCiphertext, identity.taxIdCiphertext, identity.bankDetailsCiphertext, identity.keyVersion]) {
      if (!value.trim()) throw new Error("all identity fields must be encrypted and key-versioned");
    }
    if (this.#identities.has(identity.organizationId)) throw new Error("identity version already sealed");
    this.#identities.set(identity.organizationId, Object.freeze({ ...identity }));
  }
  anonymous(profile: AnonymousProfile): Readonly<AnonymousProfile> {
    assertNoSensitiveKeys(profile); return Object.freeze({ ...profile, documentStates: Object.freeze([...profile.documentStates]) });
  }
  release(relationship: ProtectedRelationship, authorization: IdentityReleaseAuthorization): Readonly<IdentityReleaseEvent> {
    const existing = this.#releases.get(relationship.relationshipId);
    if (existing) {
      if (existing.authorizationDigest !== authorization.authorizationDigest || existing.feeLockId !== authorization.feeLockId) throw new Error("identity release replay conflict");
      return existing;
    }
    if (authorization.relationshipId !== relationship.relationshipId) throw new Error("relationship authorization mismatch");
    if (!(authorization.supplierAcceptanceCurrent && authorization.buyerAcceptanceCurrent && authorization.commissionLocked && authorization.settlementAvailable)) throw new Error("identity release prerequisites incomplete");
    if (!authorization.feeLockId || !/^[0-9a-f]{64}$/.test(authorization.authorizationDigest)) throw new Error("fee lock and release digest required");
    if (!this.#identities.has(relationship.supplierId) || !this.#identities.has(relationship.buyerId)) throw new Error("both sealed identities required");
    if (Date.parse(relationship.protectedUntil) <= Date.parse(authorization.authorizedAt)) throw new Error("relationship protection expired");
    const event = Object.freeze({ relationshipId: relationship.relationshipId, supplierId: relationship.supplierId, buyerId: relationship.buyerId, feeLockId: authorization.feeLockId, authorizationDigest: authorization.authorizationDigest, releasedAt: authorization.authorizedAt });
    this.#releases.set(relationship.relationshipId, event); return event;
  }
  isReleased(relationshipId: string): boolean { return this.#releases.has(relationshipId); }
}

const SENSITIVE_KEYS = /(?:legalName|address|contact|email|phone|taxId|gst|pan|bank|accountNumber|ifsc)/i;
export function assertNoSensitiveKeys(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.test(key)) throw new Error(`sealed identity key leaked: ${key}`);
    assertNoSensitiveKeys(member);
  }
}
export function assertNoForbiddenPlaintext(serialized: string, forbiddenPlaintexts: readonly string[]): void {
  const normalized = serialized.toLocaleLowerCase("en-US");
  for (const plaintext of forbiddenPlaintexts) if (plaintext.trim() && normalized.includes(plaintext.toLocaleLowerCase("en-US"))) throw new Error("sealed identity plaintext leaked");
}
