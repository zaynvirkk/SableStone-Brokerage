import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { known } from "../domain.js";
import {
  decimal,
  divideDecimal,
  multiplyDecimal,
} from "../money.js";
import { expectedRelationshipValue } from "../pricing.js";

/** Recalculates one opportunity from the best evidence currently available.
 * Fewer than 30 completed pair outcomes remains explicitly HEURISTIC. */
export async function refreshMatchPriority(
  pool: Pool | PoolClient,
  matchId: string,
): Promise<void> {
  const facts = (
    await pool.query(
      "select m.id,d.quantity_mt,d.standing,pd.commission_per_kg,t.geography,count(distinct history.id)::int outcome_count,count(distinct history.id) filter(where history.state in('SETTLED','RECURRING'))::int settled_count,count(distinct history.id) filter(where history.state in('FUNDED','DISPATCHED','IN_TRANSIT','DELIVERED','ACCEPTED','SETTLED','RECURRING'))::int funded_count,coalesce(avg(extract(epoch from(history.updated_at-history.created_at))/86400) filter(where history.state in('SETTLED','RECURRING')),30) days_to_cash from matches m join buyer_demands d on d.id=m.demand_id and d.version=m.demand_version join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version join pricing_decisions pd on pd.match_id=m.id and pd.state='EXECUTABLE' left join trades t on t.match_id=m.id left join trades history on history.supplier_id=o.supplier_id and history.buyer_id=d.buyer_id where m.id=$1 group by m.id,d.quantity_mt,d.standing,pd.commission_per_kg,t.geography",
      [matchId],
    )
  ).rows[0];
  if (!facts) return;
  const outcomes = Number(facts.outcome_count),
    settled = Number(facts.settled_count),
    funded = Number(facts.funded_count),
    calibrated = outcomes >= 30,
    fillRate = calibrated
      ? divideDecimal(decimal(String(settled)), decimal(String(outcomes)), 8)
      : decimal("0.5"),
    paymentProbability = calibrated
      ? divideDecimal(decimal(String(settled)), decimal(String(Math.max(funded, 1))), 8)
      : decimal("0.7"),
    closeProbability = calibrated
      ? divideDecimal(decimal(String(funded)), decimal(String(outcomes)), 8)
      : decimal("0.25"),
    expectedMonths = facts.standing ? decimal("24") : decimal("1"),
    relationship = expectedRelationshipValue(
      {
        monthlyVolumeKg: known(
          multiplyDecimal(decimal(String(facts.quantity_mt)), decimal("1000")),
          `match:${matchId}:quantity`,
        ),
        expectedCommissionPerKg: known(
          decimal(String(facts.commission_per_kg)),
          `match:${matchId}:pricing`,
        ),
        expectedFillRate: known(fillRate, `match:${matchId}:fill-rate`),
        expectedMonths: known(expectedMonths, `match:${matchId}:term`),
        paymentProbability: known(
          paymentProbability,
          `match:${matchId}:payment`,
        ),
        operationalComplexity: known(
          decimal(facts.geography === "INTERNATIONAL" ? "1.5" : "1"),
          `match:${matchId}:route`,
        ),
      },
      calibrated ? "CALIBRATED" : "HEURISTIC",
    );
  if (relationship.state !== "KNOWN") return;
  const days = decimal(String(Math.max(Number(facts.days_to_cash), 1))),
    priority = divideDecimal(
      multiplyDecimal(
        multiplyDecimal(relationship.value, closeProbability),
        paymentProbability,
      ),
      days,
      6,
    ),
    sourceDigest = createHash("sha256")
      .update(
        JSON.stringify({
          matchId,
          outcomes,
          settled,
          funded,
          relationship: relationship.value,
          closeProbability,
          paymentProbability,
          days,
          calibrated,
        }),
      )
      .digest("hex");
  await pool.query(
    "update matches set priority_score=$2,priority_state=$3,priority_source_digest=$4,expected_days_to_cash=$5 where id=$1",
    [
      matchId,
      priority,
      calibrated ? "CALIBRATED" : "HEURISTIC",
      sourceDigest,
      days,
    ],
  );
}

export class OpportunityPriorityDispatcher {
  constructor(readonly pool: Pool) {}
  async dispatchBatch(limit = 100): Promise<number> {
    const rows = (
      await this.pool.query(
        "select m.id from matches m join pricing_decisions pd on pd.match_id=m.id and pd.state='EXECUTABLE' where m.compatible order by m.priority_score desc,m.evaluated_at limit $1",
        [limit],
      )
    ).rows;
    for (const row of rows) await refreshMatchPriority(this.pool, row.id);
    await this.pool.query(
      "update acquisition_outreach_jobs j set priority_score=s.value,priority_state='CALIBRATED',priority_source_digest=s.source_digest from acquisition_profiles p join lateral(select value,source_digest from acquisition_value_snapshots where segment_id=p.segment_id and state='CALIBRATED' and sample_size>=30 order by calculated_at desc limit 1)s on true where p.id=j.acquisition_profile_id and j.state in('WAITING_CONTACT','WAITING_RISK','WAITING_PROFILE','WAITING_INVENTORY','READY')",
    );
    await this.pool.query(
      "update workflow_schedules w set priority_score=s.value from discovery_source_configs d join lateral(select value from acquisition_value_snapshots where segment_id=lower(coalesce(d.country_code,'unknown')||':'||coalesce(d.parser_config->>'targetProductFamily','unknown')||':'||coalesce(d.parser_config->>'application','unknown')) and state='CALIBRATED' and sample_size>=30 order by calculated_at desc limit 1)s on true where d.id=w.source_id and w.state='ACTIVE'",
    );
    return rows.length;
  }
}
