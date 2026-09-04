import type { Pool } from "pg";

export interface OperationalAlert {readonly code:string;readonly count:number;readonly freezes:string;}
export class RuntimeHealthMonitor {
  constructor(readonly pool:Pool,readonly emit:(alert:OperationalAlert)=>void=(alert)=>console.error(JSON.stringify({event:"OPERATIONAL_ALERT",...alert}))){}
  async inspect():Promise<readonly OperationalAlert[]>{
    const checks:readonly [string,string,string][]=Object.freeze([
      ["MONEY_DLQ","select count(*)::int count from external_event_inbox where processing_state='DEAD_LETTER_PENDING_REDRIVE'","AFFECTED_PROVIDER"],
      ["SETTLEMENT_STUCK","select count(*)::int count from settlement_instructions where acknowledged and entitlement_secured_at is null and expires_at<now()+interval '24 hours'","AFFECTED_TRADE"],
      ["SUPPLIER_PAYOUT_OVERDUE","select count(*)::int count from supplier_payout_controls where state in('HELD','RELEASE_PENDING') and held_at<now()-interval '14 days'","AFFECTED_PROVIDER"],
      ["RECONCILIATION_MISMATCH","select count(*)::int count from reconciliation_results where state='MISMATCH'","AFFECTED_TRADE"],
      ["RESERVATION_STUCK","select count(*)::int count from standing_renewal_reservations where state='RESERVED' and expires_at<=now()","AFFECTED_RECURRENCE"],
      ["ACTION_OVERDUE","select count(*)::int count from counterparty_actions where state in('REQUIRED','NOTIFIED') and deadline<=now()","AFFECTED_TRADE"],
      ["GMAIL_WATCH_STALE","select count(*)::int count from connector_leases where connector='GMAIL_WATCH' and expires_at<now()+interval '12 hours'","OUTREACH"],
    ]);
    const alerts:OperationalAlert[]=[];
    for(const [code,sql,freezes] of checks){const count=Number((await this.pool.query(sql)).rows[0]?.count??0);if(count>0){const alert=Object.freeze({code,count,freezes});alerts.push(alert);this.emit(alert)}}
    return Object.freeze(alerts);
  }
}
