-- "When can we go?": calendar connections. Run after 20261024_launch.sql. Safe to re-run.
-- Secrets (Google refresh token or private calendar link) are encrypted by the server (AES-GCM, key only in Vercel)
-- before they reach the database, so the database only ever holds ciphertext.
create table if not exists public.calendar_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google','ics')),
  secret text not null,
  label text,
  created_at timestamptz not null default now()
);
alter table public.calendar_links enable row level security;   -- no policies: functions only
revoke all on public.calendar_links from anon, authenticated;

create or replace function public.save_calendar_link(p_provider text, p_secret text, p_label text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_provider not in ('google','ics') or length(coalesce(p_secret,'')) < 20 or length(p_secret) > 8000 then raise exception 'bad calendar link'; end if;
  insert into calendar_links(user_id, provider, secret, label) values (auth.uid(), p_provider, p_secret, left(p_label,60))
  on conflict (user_id) do update set provider = excluded.provider, secret = excluded.secret, label = excluded.label, created_at = now();
end $$;

-- What the app shows in Settings (never the secret)
create or replace function public.my_calendar()
returns table(provider text, label text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select provider, label, created_at from calendar_links where user_id = auth.uid()
$$;

create or replace function public.delete_my_calendar()
returns void language sql security definer set search_path = public as $$
  delete from calendar_links where user_id = auth.uid()
$$;

-- For the server's free/busy check: the (encrypted) links of everyone in my household
create or replace function public.household_calendars()
returns table(user_id uuid, name text, provider text, secret text)
language sql stable security definer set search_path = public as $$
  select c.user_id, coalesce(m.display_name, 'Partner'), c.provider, c.secret
  from calendar_links c join members m on m.user_id = c.user_id
  where m.household_id = public.my_household()
$$;

-- log "when can we go" checks too
create or replace function public.log_activity(p jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null or jsonb_typeof(p) <> 'array' then return 0; end if;
  if (select count(*) from activity where user_id = auth.uid() and at > now() - interval '1 minute') > 120 then return 0; end if;
  insert into activity(user_id, household_id, kind, event_id, event_title, meta)
  select auth.uid(), public.my_household(), x->>'kind', left(x->>'event_id',200),
         (select left(data->>'title',200) from events where id = x->>'event_id'),
         case when jsonb_typeof(x->'meta')='object' and pg_column_size(x->'meta') < 1500 then x->'meta' else '{}'::jsonb end
  from (select value x from jsonb_array_elements(p) limit 50) s
  where x->>'kind' in ('app_open','sign_in','sign_up','view','keen','unkeen','going','ungoing','hide','unhide',
                       'calendar','tickets','official','video','photos','map','share','invite','contact','install_help','search','filter','listen',
                       'when','calendar_connect');
  get diagnostics n = row_count; return n;
end $$;

do $$ declare f text; begin
  foreach f in array array['public.save_calendar_link(text,text,text)','public.my_calendar()','public.delete_my_calendar()','public.household_calendars()','public.log_activity(jsonb)']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
