import {
  DocketHeader,
  FieldTable,
  Shell,
  StateRail,
  Status,
  tradeStates,
} from "../../components";
import { productionGet } from "../../lib/production-api";
import { ProductionBoundary } from "../../production-state";
type Settlement = {
  id: string;
  provider: string;
  currency: string;
  gross_amount: string;
  supplier_entitlement: string;
  sablestone_entitlement: string;
  expires_at: string;
  acknowledged: boolean;
  instructionDigest: string;
  acceptances: string[];
};
type TradeData = {
  id: string;
  viewerRole: string;
  state: string;
  relationshipId: string | null;
  supplierId: string;
  buyerId: string;
  updatedAt: string;
  settlement: Settlement | null;
  contractAcceptances: string[];
  nextAction: string;
};
const labels: Record<string, string> = {
  MATCHED: "Matched",
  NEGOTIATING: "Negotiating",
  PROTECTED: "Protected",
  FEE_LOCKED: "Fee locked",
  IDENTITY_RELEASED: "Identity released",
  CONTRACTED: "Contracted",
  FUNDED: "Funded",
  DISPATCHED: "Dispatched",
  IN_TRANSIT: "In transit",
  DELIVERED: "Delivered",
  ACCEPTED: "Accepted",
  SETTLED: "Settled",
  RECURRING: "Settled",
};
export default async function Trade({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    result = await productionGet<TradeData>(
      `/v1/trades/${encodeURIComponent(id)}`,
    );
  if (result.state !== "CONNECTED")
    return (
      <Shell current={`/trade/${id}`}>
        <ProductionBoundary state={result.state} reason={result.reason} />
      </Shell>
    );
  const trade = result.data,
    active = Math.max(0, tradeStates.indexOf(labels[trade.state] ?? "Matched"));
  return (
    <Shell current={`/trade/${id}`}>
      <DocketHeader
        title={`Protected trade ${id}`}
        refId={id}
        rails={trade.settlement?.acknowledged ? "Acknowledged" : "Pending"}
      />
      <StateRail active={active} />
      <div className="workbench">
        <div className="sheet trade-sheet">
          <section>
            <h2>Relationship boundary</h2>
            <FieldTable
              rows={[
                [
                  "State",
                  trade.state,
                  <Status
                    key="state"
                    state={
                      ["SETTLED", "RECURRING"].includes(trade.state)
                        ? "pass"
                        : [
                              "REJECTED",
                              "EXPIRED",
                              "CANCELLED",
                              "SETTLEMENT_FAILED",
                            ].includes(trade.state)
                          ? "blocked"
                          : "unknown"
                    }
                  />,
                ],
                ["Supplier", trade.supplierId],
                ["Buyer", trade.buyerId],
                ["Relationship", trade.relationshipId ?? "Not created"],
                [
                  "Updated",
                  new Intl.DateTimeFormat("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(trade.updatedAt)),
                ],
              ]}
            />
          </section>
          <section>
            <h2>Independent settlement</h2>
            {trade.settlement ? (
              <>
                <FieldTable
                  rows={[
                    ["Provider", trade.settlement.provider],
                    [
                      "Buyer gross",
                      `${trade.settlement.currency} ${trade.settlement.gross_amount}`,
                    ],
                    [
                      "Supplier entitlement",
                      `${trade.settlement.currency} ${trade.settlement.supplier_entitlement}`,
                    ],
                    [
                      "SableStone brokerage",
                      `${trade.settlement.currency} ${trade.settlement.sablestone_entitlement}`,
                    ],
                    [
                      "Provider acknowledgement",
                      trade.settlement.acknowledged
                        ? "Acknowledged"
                        : "Not acknowledged",
                      <Status
                        key="ack"
                        state={
                          trade.settlement.acknowledged ? "pass" : "unknown"
                        }
                      />,
                    ],
                    [
                      "Accepted roles",
                      trade.settlement.acceptances.join(", ") || "Pending",
                    ],
                    ["Instruction digest", trade.settlement.instructionDigest],
                    [
                      "Expires",
                      new Intl.DateTimeFormat("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(trade.settlement.expires_at)),
                    ],
                  ]}
                />
                {trade.state === "PROTECTED" &&
                ["SUPPLIER", "BUYER"].includes(trade.viewerRole) &&
                !trade.settlement.acceptances.includes(trade.viewerRole) ? (
                  <form
                    action={`/api/settlement-instructions/${encodeURIComponent(trade.settlement.id)}/accept?tradeId=${encodeURIComponent(trade.id)}`}
                    method="post"
                  >
                    <button type="submit">
                      Accept exact settlement instruction
                    </button>
                  </form>
                ) : null}
              </>
            ) : (
              <p className="copy">
                No current settlement instruction exists. Identity remains
                sealed.
              </p>
            )}
          </section>
          <section>
            <h2>Contract acceptance</h2>
            <FieldTable
              rows={[
                [
                  "Supplier",
                  trade.contractAcceptances.includes("SUPPLIER")
                    ? "Accepted"
                    : "Pending",
                ],
                [
                  "Buyer",
                  trade.contractAcceptances.includes("BUYER")
                    ? "Accepted"
                    : "Pending",
                ],
              ]}
            />
          </section>
        </div>
        <aside className="decision">
          <p>Deterministic next action</p>
          <div className="stamp unknown">{trade.state}</div>
          <h2>{trade.nextAction.replaceAll("_", " ")}</h2>
          <p>
            The server derives this action from current receipts. Unsupported
            transitions remain unavailable.
          </p>
          <hr />
          <dl>
            <div>
              <dt>Founder action</dt>
              <dd>None</dd>
            </div>
            <div>
              <dt>Identity</dt>
              <dd>
                {trade.supplierId === "SEALED" || trade.buyerId === "SEALED"
                  ? "Sealed"
                  : "Released"}
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </Shell>
  );
}
