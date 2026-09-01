import {
  assertCurrentCredentialBinding,
  credentialFingerprint,
} from "../dist/index.js";

const secret = "Bearer production-scoped-secret",
  fingerprint = credentialFingerprint(["secret://provider/api", secret]),
  pool = {
    async query(sql, values) {
      if (
        !sql.includes("PRODUCTION_CREDENTIAL_VERIFICATION") ||
        !sql.includes("production_credential_revocations") ||
        !sql.includes("r.id is null") ||
        !sql.includes("b.valid_until>now()")
      )
        throw new Error("credential binding query is not receipt/revocation bound");
      const matches =
        values[0] === "ESCROW_COM" &&
        values[1] === "SETTLEMENT_API" &&
        values[2] === "PRODUCTION" &&
        values[3] === fingerprint;
      return {
        rowCount: matches ? 1 : 0,
        rows: matches
          ? [{ id: "binding-1", verified_at: "2026-09-01T00:00:00.000Z", valid_until: "2026-12-01T00:00:00.000Z" }]
          : [],
      };
    },
  };
const binding = await assertCurrentCredentialBinding(pool, {
  provider: "ESCROW_COM",
  capability: "SETTLEMENT_API",
  environment: "PRODUCTION",
  credentialParts: ["secret://provider/api", secret],
});
if (binding.id !== "binding-1") throw new Error("valid credential rejected");
let rejected = 0;
for (const changed of [
  { credentialParts: ["secret://provider/api", "wrong-secret"] },
  { capability: "SETTLEMENT_WEBHOOK" },
  { provider: "OTHER_PROVIDER" },
  { credentialParts: [] },
]) {
  try {
    await assertCurrentCredentialBinding(pool, {
      provider: "ESCROW_COM",
      capability: "SETTLEMENT_API",
      environment: "PRODUCTION",
      credentialParts: ["secret://provider/api", secret],
      ...changed,
    });
  } catch {
    rejected++;
  }
}
if (rejected !== 4) throw new Error("unbound credential survived");
console.log(
  "PRODUCTION_CREDENTIAL_OK fingerprint=bound wrong_secret=blocked wrong_scope=blocked wrong_provider=blocked missing=blocked revocation=checked self_assertion=removed",
);
