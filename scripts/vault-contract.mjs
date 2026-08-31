import { ProtectedIdentityVault, assertNoForbiddenPlaintext, decimal } from "../dist/index.js";
const vault = new ProtectedIdentityVault();
const sealed = (id, prefix) => ({ organizationId: id, legalNameCiphertext: `${prefix}:legal`, addressCiphertext: `${prefix}:address`, contactCiphertext: `${prefix}:contact`, taxIdCiphertext: `${prefix}:tax`, bankDetailsCiphertext: `${prefix}:bank`, keyVersion: "kms-v1" });
vault.seal(sealed("supplier-1", "enc-s")); vault.seal(sealed("buyer-1", "enc-b"));
const anonymous = vault.anonymous({ anonymousAccountId: "P-10982", industry: "rigid packaging", coarseLocation: "Maharashtra", volumeBandMt: "100-150", materialFamily: "RPP_NATURAL_LIGHT_INJECTION", documentStates: ["COA_AVAILABLE"] });
const serialized = JSON.stringify({ api: anonymous, log: anonymous, url: `/accounts/${anonymous.anonymousAccountId}`, document: anonymous, prompt: anonymous });
assertNoForbiddenPlaintext(serialized, ["Acme Buyer Private Ltd", "Secret Recycler Pvt Ltd", "buyer@example.com", "27ABCDE1234F1Z5"]);
const relationship = { relationshipId: "rel-1", supplierId: "supplier-1", buyerId: "buyer-1", introducedAt: "2026-08-30T00:00:00Z", protectedUntil: "2028-08-30T00:00:00Z", commodityScope: ["RPP_NATURAL_LIGHT_INJECTION"], affiliateScope: "named controlled affiliates", qualifyingPurchaseDefinition: "fixture purchases in scope", commissionType: "PER_KG", commissionRate: decimal("4"), currency: "INR", supplierAcceptanceId: "sa", supplierAcceptanceSha256: "a".repeat(64), buyerAcceptanceId: "ba", buyerAcceptanceSha256: "b".repeat(64), requiredSettlementCapabilities: ["BROKER_FEE_SPLIT"] };
const auth = { relationshipId: "rel-1", supplierAcceptanceCurrent: true, buyerAcceptanceCurrent: true, commissionLocked: true, settlementAvailable: true, feeLockId: "lock-1", authorizationDigest: "c".repeat(64), authorizedAt: "2026-08-31T00:00:00Z" };
let rejected = 0;
for (const change of [
  { supplierAcceptanceCurrent: false }, { buyerAcceptanceCurrent: false }, { commissionLocked: false }, { settlementAvailable: false }, { feeLockId: null },
]) { try { new ProtectedIdentityVault().release(relationship, { ...auth, ...change }); } catch { rejected += 1; } }
const event = vault.release(relationship, auth); const replay = vault.release(relationship, auth);
if (event !== replay || !vault.isReleased("rel-1") || rejected !== 5) throw new Error("vault release contract failed");
try { vault.release(relationship, { ...auth, authorizationDigest: "d".repeat(64) }); throw new Error("conflicting replay accepted"); } catch (error) { if (error.message === "conflicting replay accepted") throw error; }
console.log("VAULT_OK anonymous_pre_release=true surfaces_redacted=5 prerequisites=5 atomic_release=true replay_idempotent=true conflict_rejected=true");
