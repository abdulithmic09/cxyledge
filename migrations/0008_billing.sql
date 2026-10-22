-- Cancelled bills: entries stay for the record but drop out of balances. A credit note number is issued.
alter table entries add column if not exists cancelled_at timestamptz;
alter table entries add column if not exists cancelled_by text;
alter table entries add column if not exists cancel_reason text not null default '';
alter table entries add column if not exists credit_note_no text not null default '';
create index if not exists entries_bill_idx on entries (yard_id, bill_no);

-- Each company's rate card: JSON object of gas type -> price per cylinder.
alter table company_meta add column if not exists prices text not null default '';
