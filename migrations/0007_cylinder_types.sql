-- The book's own list of cylinder types (JSON array). Empty means the standard list.
alter table yards add column if not exists cylinder_types text not null default '';
