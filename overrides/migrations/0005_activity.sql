alter table yard_members add column if not exists last_seen_at timestamptz;

create table if not exists activity_log (
  id text primary key,
  yard_id text not null references yards (id) on delete cascade,
  user_id text not null,
  action text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists activity_log_yard_idx on activity_log (yard_id, created_at desc);
create index if not exists activity_log_user_idx on activity_log (yard_id, user_id, created_at desc);
