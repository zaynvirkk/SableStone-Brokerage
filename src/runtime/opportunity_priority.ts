import { createHash } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { known } from "../domain.js";
import { decimal, divideDecimal, multiplyDecimal, addDecimal } from "../money.js";
import { expectedProfitPriority } from "../pricing.js";

type Scope = "GLOBAL" | "SEGMENT" | "PAIR";
interface Prior { close: string; settleGivenFunded: string; fill: string; days: string; observations: number }
const HEURISTIC: Prior = { close: "0.25", settleGivenFunded: "0.7", fill: "0.8", days: "30", observations: 0 };
const PRIOR_STRENGTH: Readonly<Record<Scope, number>> = Object.freeze({ GLOBAL: 20, SEGMENT: 12, PAIR: 6 });

function blend(prior: string, successes: number, trials: number, strength: number): string {
  return divideDecimal(addDecimal(multiplyDecimal(decimal(prior), decimal(String(strength))), decimal(String(successes))), decimal(String(strength + trials)), 8);
}
function posterior(previous: Prior, row: QueryResultRow, scope: Scope): Prior {
  const opportunities = Number(row.opportunity_count), funded = Number(row.funded_count), settled = Number(row.settled_count), measured = Number(row.measured_count), strength = PRIOR_STRENGTH[scope], fillSuccesses = Number(row.fulfilled_milli_ratio_sum ?? 0), fillTrials = measured * 1000;
  return {
    close: blend(previous.close, funded, opportunities, strength),
    settleGivenFunded: blend(previous.settleGivenFunded, settled, funded, strength),
    fill: fillTrials ? blend(previous.fill, fillSuccesses, fillTrials, strength * 1000) : previous.fill,
    days: settled > 0 ? divideDecimal(addDecimal(multiplyDecimal(decimal(previous.days),decimal(String(strength))),multiplyDecimal(decimal(String(row.days_to_cash)),decimal(String(settled)))),decimal(String(strength+settled)),8) : previous.days,
    observations: previous.observations + funded,
  };
}

/** Canonical EV: close, conditional settlement and physical fill occur once.
 * Broad evidence updates the prior before segment and exact-pair evidence. */
export async function refreshMatchPriority(pool: Pool | PoolClient, matchId: string): Promise<void> {
  const facts = (await pool.query(
    "select m.id,o.supplier_id,d.buyer_id,o.product_family,coalesce(d.product_spec->>'application',o.product_spec->>'application','UNKNOWN') application,d.quantity_mt,d.standing,case when d.standing then greatest(least(coalesce(a.maximum_renewals-a.renewals_consumed-a.renewals_reserved,0),coalesce(floor(extract(epoch from(a.valid_until-greatest(a.next_required_at,now())))/(86400*a.cadence_days))+1,0)),0) else 1 end remaining_orders,coalesce(fe.realized_commission_per_kg,pd.commission_per_kg) expected_commission_per_kg,case when sj.country_code='IN' and bj.country_code='IN' then 'DOMESTIC_INDIA' else 'INTERNATIONAL' end geography from matches m join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version join buyer_demands d on d.id=m.demand_id and d.version=m.demand_version join pricing_decisions pd on pd.match_id=m.id and pd.state='EXECUTABLE' left join final_economics_snapshots fe on fe.match_id=m.id left join standing_demand_authorizations a on a.demand_id=d.id and a.demand_version=d.version and a.automatic_renewal_permitted and a.valid_until>now() join organization_jurisdictions sj on sj.organization_id=o.supplier_id and sj.state='VERIFIED' and sj.valid_until>now() join organization_jurisdictions bj on bj.organization_id=d.buyer_id and bj.state='VERIFIED' and bj.valid_until>now() where m.id=$1", [matchId],
  )).rows[0];
  if (!facts) return;
  const stats = (await pool.query(
    "with history as(select hm.id match_id,ho.supplier_id,hd.buyer_id,ho.product_family,coalesce(hd.product_spec->>'application',ho.product_spec->>'application','UNKNOWN') application,case when hsj.country_code='IN' and hbj.country_code='IN' then 'DOMESTIC_INDIA' else 'INTERNATIONAL' end geography,ht.id trade_id,ht.state,ht.created_at,ht.updated_at,fm.fulfilled_quantity_mt,fm.contracted_quantity_mt from matches hm join supplier_offers ho on ho.id=hm.offer_id and ho.version=hm.offer_version join buyer_demands hd on hd.id=hm.demand_id and hd.version=hm.demand_version join organization_jurisdictions hsj on hsj.organization_id=ho.supplier_id and hsj.state='VERIFIED' join organization_jurisdictions hbj on hbj.organization_id=hd.buyer_id and hbj.state='VERIFIED' left join trades ht on ht.match_id=hm.id left join fulfillment_measurements fm on fm.trade_id=ht.id where hm.compatible and hm.id<>$1),scoped as(select 'GLOBAL' scope,1 rank,h.* from history h where not(h.geography=$2 and h.product_family=$3 and h.application=$4) union all select 'SEGMENT',2,h.* from history h where h.geography=$2 and h.product_family=$3 and h.application=$4 and not(h.buyer_id=$5 and h.supplier_id=$6) union all select 'PAIR',3,h.* from history h where h.geography=$2 and h.product_family=$3 and h.application=$4 and h.buyer_id=$5 and h.supplier_id=$6) select scope,count(distinct match_id)::int opportunity_count,count(distinct trade_id) filter(where state in('FUNDED','DISPATCHED','IN_TRANSIT','DELIVERED','ACCEPTED','SETTLED','RECURRING'))::int funded_count,count(distinct trade_id) filter(where state in('SETTLED','RECURRING'))::int settled_count,count(distinct trade_id) filter(where fulfilled_quantity_mt is not null)::int measured_count,coalesce(sum(round(1000*fulfilled_quantity_mt/nullif(contracted_quantity_mt,0))) filter(where fulfilled_quantity_mt is not null),0)::int fulfilled_milli_ratio_sum,coalesce(avg(extract(epoch from(updated_at-created_at))/86400) filter(where state in('SETTLED','RECURRING')),30)::text days_to_cash from scoped group by scope,rank order by rank", [matchId, facts.geography, facts.product_family, facts.application, facts.buyer_id, facts.supplier_id],
  )).rows;
  let estimate = HEURISTIC;
  for (const row of stats) estimate = posterior(estimate, row, row.scope as Scope);
  const evidenceState = estimate.observations > 0 ? "CALIBRATED" : "HEURISTIC",
    result = expectedProfitPriority({
      monthlyVolumeKg: known(multiplyDecimal(decimal(String(facts.quantity_mt)), decimal("1000")), `match:${matchId}:quantity`),
      expectedCommissionPerKg: known(decimal(String(facts.expected_commission_per_kg)), `match:${matchId}:realized-or-priced-commission`),
      expectedMonths: known(decimal(String(facts.remaining_orders)), `match:${matchId}:authorized-remaining-orders`),
      physicalFillRatio: known(decimal(estimate.fill), `match:${matchId}:hierarchical-fill`),
      closeProbability: known(decimal(estimate.close), `match:${matchId}:hierarchical-close`),
      settlementGivenFundedProbability: known(decimal(estimate.settleGivenFunded), `match:${matchId}:hierarchical-settlement`),
      operationalComplexity: known(decimal(facts.geography === "INTERNATIONAL" ? "1.5" : "1"), `match:${matchId}:verified-jurisdictions`),
      expectedDaysToCash: known(decimal(String(Math.max(Number(estimate.days), 1))), `match:${matchId}:days-to-cash`),
    }, evidenceState);
  if (result.state !== "KNOWN") return;
  const digest = createHash("sha256").update(JSON.stringify({ matchId, facts, estimate, model: "hierarchical-ev-v2" })).digest("hex");
  await pool.query("update matches set priority_score=$2,priority_state=$3,priority_source_digest=$4,expected_days_to_cash=$5 where id=$1", [matchId, result.value, evidenceState, digest, Math.max(Number(estimate.days), 1)]);
}

export class OpportunityPriorityDispatcher {
  constructor(readonly pool: Pool) {}
  async dispatchBatch(limit = 100): Promise<number> {
    const rows = (await this.pool.query("select m.id from matches m join pricing_decisions pd on pd.match_id=m.id and pd.state='EXECUTABLE' where m.compatible order by m.priority_score desc,m.evaluated_at limit $1", [limit])).rows;
    for (const row of rows) await refreshMatchPriority(this.pool, row.id);
    await this.pool.query("update acquisition_outreach_jobs j set priority_score=s.value,priority_state='CALIBRATED',priority_source_digest=s.source_digest from acquisition_profiles p join lateral(select value,source_digest from acquisition_value_snapshots where segment_id=p.segment_id and state='CALIBRATED' and sample_size>=30 order by calculated_at desc limit 1)s on true where p.id=j.acquisition_profile_id and j.state in('WAITING_CONTACT','WAITING_RISK','WAITING_PROFILE','WAITING_INVENTORY','READY')");
    await this.pool.query("update workflow_schedules w set priority_score=s.value from discovery_source_configs d join lateral(select value from acquisition_value_snapshots where segment_id=lower(coalesce(d.country_code,'unknown')||':'||coalesce(d.parser_config->>'targetProductFamily','unknown')||':'||coalesce(d.parser_config->>'application','unknown')) and state='CALIBRATED' and sample_size>=30 order by calculated_at desc limit 1)s on true where d.id=w.source_id and w.state='ACTIVE'");
    return rows.length;
  }
}
