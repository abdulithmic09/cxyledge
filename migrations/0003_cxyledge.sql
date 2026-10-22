alter table entries add column if not exists movement text not null default 'delivery';
alter table entries add column if not exists unit_price numeric(12, 2);
alter table entries add column if not exists bill_no text not null default '';
alter table entries add column if not exists parent_id text;

alter table yards add column if not exists address text not null default '';
alter table yards add column if not exists gst text not null default '';
alter table yards add column if not exists pan text not null default '';
alter table yards add column if not exists phone text not null default '';
alter table yards add column if not exists logo text not null default '';

create table if not exists documents (
  id text primary key,
  yard_id text not null references yards (id) on delete cascade,
  company_name text not null default '',
  title text not null,
  kind text not null,
  mime text not null,
  content text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists documents_yard_idx on documents (yard_id, created_at desc);

create table if not exists return_logs (
  id text primary key,
  yard_id text not null references yards (id) on delete cascade,
  entry_id text,
  company_name text not null,
  serials text not null default '',
  quantity integer not null,
  actor text not null,
  created_at timestamptz not null default now()
);

create index if not exists return_logs_yard_idx on return_logs (yard_id, created_at desc);
