alter table entries add column if not exists cylinder_type text not null default '';

create table if not exists company_meta (
  yard_id text not null references yards (id) on delete cascade,
  company_name text not null,
  keywords text not null default '',
  notes text not null default '',
  updated_at timestamptz not null default now(),
  primary key (yard_id, company_name)
);
