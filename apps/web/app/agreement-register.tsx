import Link from "next/link";
import { EmptyRegister } from "./production-state";

export type BoundAgreement = {
  id: string;
  agreement_kind: string;
  version: string;
  body_sha256: string;
  agreement_binding_id: string;
  resource_type: "ORG_MASTER" | "MATCH" | "TRADE";
  resource_id: string;
  binding_sha256: string;
  expires_at: string;
};

export function AgreementRegister({
  agreements,
}: {
  agreements: BoundAgreement[];
}) {
  return (
    <section className="sheet">
      <h2>Bound agreements</h2>
      {agreements.length ? (
        <div className="register-list">
          {agreements.map((agreement) => (
            <Link
              key={agreement.agreement_binding_id}
              href={`/api/agreements/${encodeURIComponent(agreement.id)}/${encodeURIComponent(agreement.version)}/bindings/${encodeURIComponent(agreement.agreement_binding_id)}/body`}
              target="_blank"
              rel="noopener"
            >
              <b>{agreement.agreement_kind.replaceAll("_", " ")}</b>
              <span>
                {agreement.resource_type} · {agreement.resource_id}
              </span>
              <time>SHA-256 {agreement.body_sha256.slice(0, 12)}…</time>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyRegister
          title="No bound agreement"
          body="No current legal document is bound to this company or one of its protected transactions. Acceptance remains unavailable."
        />
      )}
    </section>
  );
}
