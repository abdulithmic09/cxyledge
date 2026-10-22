create table if not exists yards (
  id text primary key,
  name text not null,
  invite_code text not null unique,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists yard_members (
  yard_id text not null references yards (id) on delete cascade,
  user_id text not null,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (yard_id, user_id)
);

create index if not exists yard_members_user_idx on yard_members (user_id);

create table if not exists profiles (
  user_id text primary key,
  active_yard_id text references yards (id)
);

create table if not exists entries (
  id text primary key,
  yard_id text not null references yards (id) on delete cascade,
  created_by text not null,
  company_name text not null,
  entry_date date not null,
  serial_no text not null default '',
  quantity integer not null,
  payment_status text not null,
  amount_due numeric(12, 2),
  amount_paid numeric(12, 2),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entries_quantity_positive check (quantity > 0 and quantity <= 100000),
  constraint entries_payment_status check (payment_status in ('received', 'partial', 'unpaid'))
);

create index if not exists entries_yard_date_idx on entries (yard_id, entry_date desc);
