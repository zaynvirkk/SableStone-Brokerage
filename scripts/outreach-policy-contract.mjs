import {
  assertCurrentAcquisitionOutreachPolicy,
  resolveCurrentAcquisitionOutreachPolicy,
} from "../dist/index.js";

let current = true,
  checks = 0;
const pool = {
  async query(sql, values) {
    checks += 1;
    if (!sql.includes("OUTREACH_POLICY_APPROVAL"))
      throw new Error("exact outreach authority kind missing");
    if (!sql.includes("c.source=any(p.allowed_contact_sources)"))
      throw new Error("contact source not bounded");
    if (!sql.includes("c.jurisdiction=any(p.allowed_jurisdictions)"))
      throw new Error("jurisdiction not bounded");
    if (!sql.includes("global_suppressions"))
      throw new Error("global suppression not checked");
    const resolving = sql.includes("select p.version");
    if (values[0] !== "contact-1" || (!resolving && values[1] !== "privacy-v1"))
      throw new Error("outreach binding changed");
    return {
      rowCount: current ? 1 : 0,
      rows: current
        ? [resolving ? { version: "privacy-v1" } : { "?column?": 1 }]
        : [],
    };
  },
};

const resolved = await resolveCurrentAcquisitionOutreachPolicy(
  pool,
  "contact-1",
);
if (resolved !== "privacy-v1") throw new Error("current policy not resolved");
await assertCurrentAcquisitionOutreachPolicy(pool, {
  version: "privacy-v1",
  contactId: "contact-1",
});
current = false;
await assertCurrentAcquisitionOutreachPolicy(pool, {
  version: "privacy-v1",
  contactId: "contact-1",
}).then(
  () => {
    throw new Error("expired or revoked outreach policy accepted");
  },
  () => undefined,
);
if (checks !== 3) throw new Error("outreach policy not checked per use");

console.log(
  "OUTREACH_POLICY_OK exact_kind=required contact=bound policy=authority_resolved jurisdiction=bounded source=bounded suppression=checked per_use=required revoked=blocked",
);
