-- Credit days: how long a customer has to pay a bill. Book default, and optionally per company.
alter table yards add column if not exists credit_days integer not null default 30;
alter table company_meta add column if not exists credit_days integer;

-- Delivery challans: the slip that goes with the cylinders, signed by the receiver, later turned into a bill.
create table if not exists challans (
  id text primary key,
  yard_id text not null references yards (id) on delete cascade,
  challan_no text not null,
  company_name text not null,
  challan_date date not null,
  vehicle text not null default '',
  driver text not null default '',
  receiver text not null default '',
  signature text not null default '',
  signed_at timestamptz,
  billed_bill_no text not null default '',
  created_by text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists challans_no_idx on challans (yard_id, challan_no);
