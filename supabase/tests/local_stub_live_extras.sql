-- Functions/tables that exist on the live project but not in schema.sql (simplified stand-ins)
create table if not exists public.scan_sources(id bigserial primary key, url text unique);
alter table public.scan_sources enable row level security;
create policy src_admin on public.scan_sources for all to authenticated using (public.i_am_admin()) with check (public.i_am_admin());
create or replace function public.import_seed(p_events jsonb, p_picks jsonb, p_hidden jsonb) returns integer language sql security definer as $$ select 0 $$;
create or replace function public.promote_if_admin() returns void language sql security definer as $$ select $$;
create or replace function public.admin_upsert_events(p jsonb, p_added integer default null, p_note text default null) returns integer language sql security definer as $$ select 0 $$;
create or replace function public.scan_cleanup() returns integer language sql security definer as $$ select 0 $$;
