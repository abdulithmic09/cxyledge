-- Private statement links: a company opens its own balance, bills and cylinders without signing in.
create table if not exists statement_links (
  token text primary key,
  yard_id text not null references yards (id) on delete cascade,
  company_name text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  views integer not null default 0
);
create index if not exists statement_links_company_idx on statement_links (yard_id, company_name);
