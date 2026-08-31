export type RiskCheckType = "OFFICIAL_REGISTRATION" | "KYB_IDENTITY" | "SANCTIONS" | "WATCHLIST" | "BANK_ACCOUNT";
export type RiskCheckState = "PASS" | "HIT" | "UNKNOWN" | "AMBIGUOUS" | "EXPIRED" | "ERROR";
export interface RiskCheck {
  readonly checkId: string;
  readonly organizationId: string;
  readonly type: RiskCheckType;
  readonly state: RiskCheckState;
  readonly sourceProvider: string;
  readonly sourceReceiptId: string;
  readonly sourceDigest: string;
  readonly checkedAt: string;
  readonly validUntil: string;
  readonly matchedEntityIds: readonly string[];
  readonly policyVersion: string;
}
export type RiskDecisionState = "PASS" | "REJECT" | "FREEZE";
export interface RiskDecision {
  readonly state: RiskDecisionState;
  readonly reasons: readonly string[];
  readonly checkIds: readonly string[];
  readonly policyVersion: string;
}
export interface RiskPolicy {
  readonly version: string;
  readonly requiredChecks: readonly RiskCheckType[];
  readonly acceptedProviders: Readonly<Record<RiskCheckType, readonly string[]>>;
}

export function decideCounterpartyRisk(checks: readonly RiskCheck[], policy: RiskPolicy, now: string): RiskDecision {
  const reasons: string[] = [], used: string[] = [];
  for (const type of policy.requiredChecks) {
    const candidates = checks.filter((check) => check.type === type && check.policyVersion === policy.version);
    if (candidates.length !== 1) { reasons.push(`${type}:REQUIRES_EXACTLY_ONE_CURRENT_CHECK`); continue; }
    const check = candidates[0];
    if (!check) continue;
    used.push(check.checkId);
    if (!policy.acceptedProviders[type].includes(check.sourceProvider)) reasons.push(`${type}:PROVIDER_NOT_APPROVED`);
    if (!check.sourceReceiptId || !/^[0-9a-f]{64}$/.test(check.sourceDigest)) reasons.push(`${type}:SOURCE_INVALID`);
    if (Date.parse(check.validUntil) <= Date.parse(now) || Date.parse(check.checkedAt) > Date.parse(now)) reasons.push(`${type}:NOT_CURRENT`);
    if (check.state !== "PASS") reasons.push(`${type}:${check.state}`);
    if (check.state === "PASS" && check.matchedEntityIds.length !== 1 && type === "KYB_IDENTITY") reasons.push(`${type}:IDENTITY_NOT_UNIQUE`);
  }
  if (reasons.some((reason) => reason.endsWith(":HIT"))) return result("REJECT", reasons, used, policy.version);
  if (reasons.length) return result("FREEZE", reasons, used, policy.version);
  return result("PASS", [], used, policy.version);
}

/** Model output is intentionally absent: callers can only supply provider checks. */
export function assertRiskPass(decision: RiskDecision): void {
  if (decision.state !== "PASS") throw new Error(`counterparty risk gate ${decision.state.toLowerCase()}`);
}
function result(state: RiskDecisionState, reasons: readonly string[], checkIds: readonly string[], policyVersion: string): RiskDecision {
  return Object.freeze({ state, reasons: Object.freeze([...reasons]), checkIds: Object.freeze([...checkIds]), policyVersion });
}
