create table if not exists security_events (
  id uuid primary key,
  occurred_at timestamptz not null,
  principal_id uuid,
  event_type text not null,
  resource_digest text not null check (resource_digest ~ '^[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('ALLOWED','DENIED','REDACTED')),
  details_redacted jsonb not null
);
create table if not exists safety_controls (
  singleton boolean primary key default true check (singleton),
  live_trading_killed boolean not null default true,
  live_outreach_killed boolean not null default true,
  settlement_killed boolean not null default true,
  identity_release_killed boolean not null default true,
  reason text not null,
  changed_at timestamptz not null
);
create table if not exists backup_manifests (
  backup_id uuid primary key,
  created_at timestamptz not null,
  encrypted boolean not null check (encrypted),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  restore_verified_at timestamptz
);

