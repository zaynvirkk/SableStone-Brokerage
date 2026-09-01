# Production authority-kind matrix

A current receipt is not interchangeable with another current receipt. Each
load-bearing production capability requires the exact `authority_kind` below,
as well as preserved source bytes, retrieval/effective/expiry times and the
existing release or provider binding where applicable.

| Capability                                    | Required `authority_kind`            |
| --------------------------------------------- | ------------------------------------ |
| Reviewed supplier/buyer source                | `DISCOVERY_SOURCE_REVIEW`            |
| Brave Search provider                         | `SEARCH_PROVIDER_APPROVAL`           |
| Hunter/contact enrichment                     | `CONTACT_ENRICHMENT_APPROVAL`        |
| Evidence-bound commercial language extraction | `COMMERCIAL_EXTRACTION_APPROVAL`     |
| Document extraction                           | `DOCUMENT_EXTRACTION_APPROVAL`       |
| Independent document verification             | `DOCUMENT_VERIFICATION_APPROVAL`     |
| KYB provider                                  | `KYB_PROVIDER_APPROVAL`              |
| Freight/payment/tax/inspection quote provider | `ECONOMIC_QUOTE_PROVIDER_APPROVAL`   |
| Bank receipt webhook                          | `BANK_WEBHOOK_PROVIDER_APPROVAL`     |
| Pricing policy                                | `PRICING_POLICY_APPROVAL`            |
| Negotiation policy                            | `NEGOTIATION_POLICY_APPROVAL`        |
| Brokerage tax policy                          | `TAX_POLICY_APPROVAL`                |
| Settlement provider use case                  | `PROVIDER_WRITTEN_APPROVAL`          |
| Provider party account mapping                | `PROVIDER_ACCOUNT_VERIFICATION`      |
| Provider party account revocation             | `PROVIDER_ACCOUNT_REVOCATION`        |
| Production credential verification            | `PRODUCTION_CREDENTIAL_VERIFICATION` |
| Production credential revocation              | `PRODUCTION_CREDENTIAL_REVOCATION`   |
| Counsel-approved agreement                    | `LEGAL_AGREEMENT_APPROVAL`           |
| Counsel-approved deterministic template       | `LEGAL_AGREEMENT_TEMPLATE`           |

Release activation has an additional exact purpose-to-kind contract:

| Activation purpose       | Required `authority_kind` |
| ------------------------ | ------------------------- |
| `OPERATOR_AUTHORIZATION` | `OPERATOR_AUTHORIZATION`  |
| `ENTITY`                 | `ENTITY_REGISTRATION`     |
| `LEGAL`                  | `PROFESSIONAL_LEGAL_MEMO` |
| `TAX`                    | `PROFESSIONAL_TAX_MEMO`   |
| `PRIVACY`                | `PROFESSIONAL_LEGAL_MEMO` |
| `DEPLOYMENT`             | `DEPLOYMENT_VERIFICATION` |

`MARKETING_PAGE`, `PROVIDER_PUBLIC_DOCUMENTATION`, official law, official
registry data, or a receipt approved for another connector cannot open any of
these capabilities. Public documentation may inform implementation but never
proves underwriting, professional advice, credentials, deployment, or an
operator decision.
