-- Weekly "Swiss Outings Sunday" email for every user who opts in. Run after 20261028_admin_mfa.sql. Safe to re-run.
-- Sending happens in /api/newsletter (Vercel cron). The server proves itself with a secret that lives in
-- app_config 'newsletter' (not readable by users) and in Vercel's CRON_SECRET.

create table if not exists public.email_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  weekly boolean not null default false,
  token text unique not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  last_sent date,
  updated_at timestamptz not null default now()
);
alter table public.email_prefs enable row level security;
drop policy if exists ep_own on public.email_prefs;
create policy ep_own on public.email_prefs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.email_prefs from anon, authenticated;
grant select (user_id, weekly, updated_at), insert (user_id, weekly, updated_at) on public.email_prefs to authenticated;
grant update (user_id, weekly, updated_at) on public.email_prefs to authenticated;   -- never the unsubscribe token or send log (RLS keeps user_id = you)

-- Second line of defence (also works where the grants above can't be applied): signed-in users can never
-- choose their own token or touch the send log; only the server-side functions (run as the owner) can.
create or replace function public._email_prefs_guard() returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      new.last_sent := null;
    else
      new.token := old.token; new.last_sent := old.last_sent;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists email_prefs_guard on public.email_prefs;
create trigger email_prefs_guard before insert or update on public.email_prefs for each row execute function public._email_prefs_guard();

-- One-click unsubscribe from the link in every email (no sign-in needed; the long random token is the key)
create or replace function public.newsletter_unsubscribe(p_token text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if length(coalesce(p_token, '')) < 40 then return false; end if;
  update email_prefs set weekly = false, updated_at = now() where token = p_token;
  return found;
end $$;
revoke execute on function public.newsletter_unsubscribe(text) from public;
grant execute on function public.newsletter_unsubscribe(text) to anon, authenticated;

create or replace function public._newsletter_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select length(coalesce(p_secret, '')) >= 32
     and p_secret = (select value->>'secret' from app_config where key = 'newsletter')
$$;
revoke execute on function public._newsletter_ok(text) from public, anon, authenticated;

-- Who gets this week's email, with what their household is planning. Server-only (needs the secret).
-- p_only: send to just this user (admin "send me a test"), regardless of opt-in and of last_sent.
create or replace function public.newsletter_batch(p_secret text, p_only uuid default null)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
begin
  if not public._newsletter_ok(p_secret) then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(r) from (
    select m.user_id, u.email, m.display_name as name, m.household_id, ep.token,
      (select coalesce(jsonb_array_length(hs.kids), 0) from household_settings hs where hs.household_id = m.household_id) as kids,
      (select coalesce(jsonb_agg(distinct p.event_id), '[]'::jsonb) from picks p join events e on e.id = p.event_id
         where p.household_id = m.household_id and coalesce(e.end_date, e.start_date) >= current_date) as planned,
      (select coalesce(jsonb_agg(h.event_id), '[]'::jsonb) from hidden h where h.household_id = m.household_id) as hidden
    from members m
    join auth.users u on u.id = m.user_id and u.email_confirmed_at is not null
    join email_prefs ep on ep.user_id = m.user_id
    where (p_only is not null and m.user_id = p_only)
       or (p_only is null and ep.weekly and ep.last_sent is distinct from current_date)
    limit 500) r), '[]'::jsonb);
end $$;
revoke execute on function public.newsletter_batch(text, uuid) from public;
grant execute on function public.newsletter_batch(text, uuid) to anon;   -- guarded by the secret

create or replace function public.newsletter_mark_sent(p_secret text, p_users uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public._newsletter_ok(p_secret) then raise exception 'not allowed'; end if;
  update email_prefs set last_sent = current_date where user_id = any(p_users);
  get diagnostics n = row_count; return n;
end $$;
revoke execute on function public.newsletter_mark_sent(text, uuid[]) from public;
grant execute on function public.newsletter_mark_sent(text, uuid[]) to anon;

-- make sure a test email for the signed-in admin is only possible with the 2-step admin session
create or replace function public.newsletter_test_target()
returns uuid language sql stable security definer set search_path = public as $$
  select case when public.i_am_admin() then auth.uid() end
$$;
grant execute on function public.newsletter_test_target() to authenticated;

-- log email opt-in/out choices
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
                       'when','calendar_connect','plan','plan_save','plan_share','plan_edit','story','newsletter');
  get diagnostics n = row_count; return n;
end $$;
revoke execute on function public.log_activity(jsonb) from public, anon;
grant execute on function public.log_activity(jsonb) to authenticated;
