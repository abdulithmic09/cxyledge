-- Holding charges: free days and a daily rate per cylinder, for the book and (optionally) per company.
alter table yards add column if not exists hold_free_days integer not null default 30;
alter table yards add column if not exists hold_rate numeric(12, 2) not null default 0;
alter table company_meta add column if not exists hold_free_days integer;
alter table company_meta add column if not exists hold_rate numeric(12, 2);

-- Holding charges billed to a company are stored with payments, as direction 'charge'.
alter table payments drop constraint if exists payments_direction;
alter table payments add constraint payments_direction check (direction in ('in', 'out', 'charge'));

-- Cylinders sent to the refilling plant and back, and stock counts at the yard.
create table if not exists stock_moves (
  id text primary key,
  yard_id text not null references yards (id) on delete cascade,
  kind text not null,
  plant text not null default '',
  gas_type text not null default '',
  quantity integer not null default 0,
  serial_no text not null default '',
  full_count integer,
  empty_count integer,
  challan_no text not null default '',
  note text not null default '',
  moved_on date not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text,
  constraint stock_moves_kind check (kind in ('to_plant', 'from_plant', 'count'))
);
create index if not exists stock_moves_yard_idx on stock_moves (yard_id, moved_on desc);

-- Security deposits taken from customers for cylinders, and refunds.
create table if not exists deposits (
  id text primary key,
  yard_id text not null references yards (id) on delete cascade,
  company_name text not null,
  direction text not null,
  amount numeric(12, 2) not null,
  cylinders integer not null default 0,
  gas_type text not null default '',
  serial_no text not null default '',
  on_date date not null,
  mode text not null default 'cash',
  reference text not null default '',
  note text not null default '',
  receipt_no text not null default '',
  created_by text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text,
  constraint deposits_direction check (direction in ('taken', 'refunded')),
  constraint deposits_amount check (amount >= 0 and amount <= 1000000000)
);
create index if not exists deposits_yard_idx on deposits (yard_id, company_name);
