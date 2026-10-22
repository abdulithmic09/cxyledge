-- Roles: owner (everything), staff (add and edit, no deleting), viewer (read only).
-- Everyone who joined before roles existed becomes staff.
update yard_members set role = 'staff' where role not in ('owner', 'staff', 'viewer');

-- Recently deleted bin: deleted rows stay for 30 days and can be restored.
alter table entries add column if not exists deleted_at timestamptz;
alter table entries add column if not exists deleted_by text;
alter table documents add column if not exists deleted_at timestamptz;
alter table documents add column if not exists deleted_by text;

-- Payments received from customers (in) or paid to suppliers (out), including part-payments.
create table if not exists payments (
  id text primary key,
  yard_id text not null references yards (id) on delete cascade,
  company_name text not null,
  direction text not null default 'in',
  amount numeric(12, 2) not null,
  paid_on date not null,
  mode text not null,
  reference text not null default '',
  bill_no text not null default '',
  note text not null default '',
  receipt_no text not null default '',
  created_by text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text,
  constraint payments_amount_positive check (amount > 0 and amount <= 1000000000),
  constraint payments_direction check (direction in ('in', 'out'))
);

create index if not exists payments_yard_idx on payments (yard_id, paid_on desc);

-- WhatsApp number for each customer.
alter table company_meta add column if not exists phone text not null default '';

-- When the whole book was last backed up.
alter table yards add column if not exists last_backup_at timestamptz;
