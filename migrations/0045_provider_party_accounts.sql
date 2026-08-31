create table provider_party_accounts (
  id uuid primary key,
  provider text not null,
  organization_id uuid not null references organizations(id),
  party_role text not null check (party_role in ('BUYER','SUPPLIER','SABLESTONE')),
  reference_ciphertext bytea not null,
  reference_sha256 text not null check (reference_sha256 ~ '^[0-9a-f]{64}$'),
  verification_receipt_id text not null,
  verified_at timestamptz not null,
  valid_until timestamptz not null,
  revoked_at timestamptz,
  unique(provider, organization_id, party_role, reference_sha256),
  check (valid_until > verified_at)
);

alter table settlement_instructions
  add column provider_buyer_party_account_id uuid references provider_party_accounts(id),
  add column provider_supplier_party_account_id uuid references provider_party_accounts(id),
  add column provider_sablestone_party_account_id uuid references provider_party_accounts(id);

create index provider_party_accounts_current_idx
  on provider_party_accounts(provider, organization_id, party_role, valid_until)
  where revoked_at is null;
