-- Extra facts about a bill that its book lines can't carry: a monthly bill's own date, month and note.
create table if not exists bill_meta (
  yard_id text not null references yards (id) on delete cascade,
  bill_no text not null,
  kind text not null default 'monthly',
  month text not null default '',
  bill_date date not null,
  note text not null default '',
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (yard_id, bill_no)
);
