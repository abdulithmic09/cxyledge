-- Business email on the letterhead (bills, receipts, statements).
alter table yards add column if not exists email text not null default '';
