import type { Pool } from "pg";

export interface AcquisitionOutreachPolicyBinding {
  readonly version: string;
  readonly contactId: string;
}

const currentPolicySql =
  "from outreach_policies p join authority_receipts a on a.receipt_id=p.authority_receipt_id join contacts c on c.id=$1 join organizations o on o.id=c.organization_id where p.outreach_approved=true and p.effective_at<=now() and p.expires_at>now() and a.authority_kind='OUTREACH_POLICY_APPROVAL' and a.retrieved_at<=now() and a.effective_at<=now() and a.expires_at>now() and c.verification='VERIFIED' and c.verified_at<=now() and c.jurisdiction=any(p.allowed_jurisdictions) and c.source=any(p.allowed_contact_sources) and c.source<>'GUESSED' and o.organization_type=any(p.allowed_organization_roles) and not exists(select 1 from global_suppressions s where s.email_lookup_hash=c.email_lookup_hash)";

export async function resolveCurrentAcquisitionOutreachPolicy(
  pool: Pick<Pool, "query">,
  contactId: string,
): Promise<string> {
  if (!contactId.trim()) throw new Error("acquisition contact missing");
  const result = await pool.query(
    `select p.version ${currentPolicySql} order by p.effective_at desc,p.version desc limit 1`,
    [contactId],
  );
  const version = result.rows[0]?.version;
  if (typeof version !== "string" || !version.trim())
    throw new Error("current acquisition outreach policy unavailable");
  return version;
}

/** Revalidates the exact structured outreach policy and its professional
 * authority receipt against the selected contact immediately before a
 * first-contact message is materialized or sent. */
export async function assertCurrentAcquisitionOutreachPolicy(
  pool: Pick<Pool, "query">,
  binding: AcquisitionOutreachPolicyBinding,
): Promise<void> {
  if (!binding.version.trim() || !binding.contactId.trim())
    throw new Error("acquisition outreach policy binding missing");
  const result = await pool.query(
    `select 1 ${currentPolicySql} and p.version=$2`,
    [binding.contactId, binding.version],
  );
  if (!result.rowCount)
    throw new Error("current acquisition outreach policy unavailable");
}
