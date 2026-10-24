-- Launch hardening + activity log + admin + contact messages + open sign-up
-- Safe to re-run.

------------------------------------------------------------------------
-- 1. Lock down table privileges (RLS still applies on top of these)
------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant select on public.events to anon;                       -- public listings, share pages, .ics

revoke truncate, references, trigger on all tables in schema public from authenticated;

-- members: users may only change their own display name (not is_admin, not household)
revoke insert, update on public.members from authenticated;
grant update (display_name) on public.members to authenticated;

-- households: secret codes are not readable through the table any more (friends could read them)
revoke select, insert, update, delete on public.households from authenticated;
grant select (id, name, prefs, created_at) on public.households to authenticated;
grant update (name) on public.households to authenticated;

-- friendships / invites: written only through functions
revoke insert, update on public.friendships from authenticated;
grant update (share_plans) on public.friendships to authenticated;
revoke insert, update, delete on public.app_invites from authenticated;
revoke insert, update, delete on public.events from authenticated;
revoke all on public.scan_sources from authenticated;
grant select, insert, update, delete on public.scan_sources to authenticated;   -- admin-only via RLS policy

-- app_config: ordinary users only see the scan status, not the brief or the admin list
drop policy if exists config_read on public.app_config;
create policy config_read on public.app_config for select to authenticated using (key = 'scan' or public.i_am_admin());

-- new functions are not callable by everyone unless granted
alter default privileges in schema public revoke execute on functions from public;
revoke execute on function public.import_seed(jsonb,jsonb,jsonb) from public, anon;
revoke execute on function public.promote_if_admin() from public, anon;
revoke execute on function public.admin_upsert_events(jsonb,integer,text) from public, anon;

------------------------------------------------------------------------
-- 2. Brute-force protection for codes
------------------------------------------------------------------------
create table if not exists public.code_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists code_attempts_idx on public.code_attempts(user_id, at);
alter table public.code_attempts enable row level security;   -- no policies: functions only

create or replace function public._code_guard()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if (select count(*) from code_attempts where user_id = auth.uid() and at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many tries. Please wait an hour and try again.';
  end if;
  insert into code_attempts(user_id) values (auth.uid());
  delete from code_attempts where at < now() - interval '1 day';
end $$;

-- longer, unambiguous codes for new households
create or replace function public._new_code(n int)
returns text language sql volatile set search_path = public as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random()*32)::int, 1), '')
  from generate_series(1, n)
$$;
alter table public.households alter column join_code set default public._new_code(8);
alter table public.households alter column friend_code set default public._new_code(8);

------------------------------------------------------------------------
-- 3. Household functions (open sign-up)
------------------------------------------------------------------------
-- My own household's codes (members only)
create or replace function public.my_codes()
returns table(join_code text, friend_code text)
language sql stable security definer set search_path = public as $$
  select join_code, friend_code from households where id = public.my_household()
$$;

-- Join a partner's household with its join code
create or replace function public.join_household(p_code text, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid; old uuid := public.my_household();
begin
  perform public._code_guard();
  select id into h from households where join_code = upper(trim(p_code));
  if h is null then return null; end if;   -- not found: return null (raising would undo the recorded attempt)
  insert into members(user_id, household_id, display_name) values (auth.uid(), h, nullif(left(trim(p_name),40),''))
  on conflict (user_id) do update set household_id = excluded.household_id, display_name = coalesce(excluded.display_name, members.display_name);
  update picks set household_id = h where user_id = auth.uid();
  if old is not null and old <> h and not exists (select 1 from members where household_id = old) then
    delete from households where id = old;
  end if;
  return h;
end $$;

-- Start a new household. Optional invite: a friend's friend-code (or a legacy invite code) connects you to them.
create or replace function public.create_household(p_household_name text, p_name text, p_invite text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid; inviter uuid; inv_code text; v_code text := upper(trim(coalesce(p_invite,'')));
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if public.my_household() is not null then return public.my_household(); end if;
  if v_code <> '' then
    perform public._code_guard();
    select id into inviter from households where friend_code = v_code;
    if inviter is null then
      select i.code, i.created_by_household into inv_code, inviter from app_invites i where i.code = v_code and i.used_by_household is null for update;
    end if;
  end if;
  insert into households(name) values (coalesce(nullif(left(trim(p_household_name),60),''), coalesce(nullif(trim(p_name),''),'My') || '''s household')) returning id into h;
  insert into members(user_id, household_id, display_name) values (auth.uid(), h, nullif(left(trim(p_name),40),''));
  if inv_code is not null then update app_invites set used_by_household = h, used_at = now() where code = inv_code; end if;
  if inviter is not null then
    insert into friendships(household_id, friend_household_id) values (h, inviter), (inviter, h) on conflict do nothing;
  end if;
  return h;
end $$;

-- Legacy name kept for old links: now works for anyone (open sign-up)
create or replace function public.redeem_invite(p_code text, p_household_name text, p_name text)
returns uuid language sql security definer set search_path = public as $$
  select public.create_household(p_household_name, p_name, p_code)
$$;

create or replace function public.connect_friend(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_household(); f uuid;
begin
  if h is null then raise exception 'not in a household'; end if;
  perform public._code_guard();
  select id into f from households where friend_code = upper(trim(p_code));
  if f is null then return null; end if;   -- not found: return null so the attempt stays counted
  if f = h then raise exception 'That is your own code'; end if;
  insert into friendships(household_id, friend_household_id) values (h,f),(f,h) on conflict do nothing;
  return f;
end $$;

-- Delete my account completely (login, membership, picks); empty households go too
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare h uuid := public.my_household();
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
  if h is not null and not exists (select 1 from public.members where household_id = h) then
    delete from public.households where id = h;
  end if;
end $$;

------------------------------------------------------------------------
-- 4. Activity log
------------------------------------------------------------------------
create table if not exists public.activity (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  kind text not null,
  event_id text,
  event_title text,
  meta jsonb not null default '{}'::jsonb
);
create index if not exists activity_at_idx on public.activity(at desc);
create index if not exists activity_user_idx on public.activity(user_id, at desc);
create index if not exists activity_event_idx on public.activity(event_id);
alter table public.activity enable row level security;
drop policy if exists act_admin_read on public.activity;
create policy act_admin_read on public.activity for select to authenticated using (public.i_am_admin());

-- Batch logger. Kinds are whitelisted; user and household are taken from the session.
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
                       'calendar','tickets','official','video','photos','map','share','invite','contact','install_help','search','filter','listen');
  get diagnostics n = row_count; return n;
end $$;

------------------------------------------------------------------------
-- 5. Contact / venue suggestions
------------------------------------------------------------------------
create table if not exists public.messages (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  name text, email text,
  kind text not null default 'contact',
  body text not null,
  handled boolean not null default false
);
alter table public.messages enable row level security;
drop policy if exists msg_admin on public.messages;
create policy msg_admin on public.messages for all to authenticated using (public.i_am_admin()) with check (public.i_am_admin());

create or replace function public.submit_message(p_kind text, p_name text, p_email text, p_body text)
returns bigint language plpgsql security definer set search_path = public as $$
declare i bigint;
begin
  if length(trim(coalesce(p_body,''))) < 2 then raise exception 'Please write a message.'; end if;
  if auth.uid() is not null then
    if (select count(*) from messages where user_id = auth.uid() and at > now() - interval '1 hour') >= 5 then raise exception 'Thanks! You have sent several messages already. Please try again later.'; end if;
  else
    if (select count(*) from messages where user_id is null and at > now() - interval '1 hour') >= 20 then raise exception 'Please try again later.'; end if;
  end if;
  insert into messages(user_id, name, email, kind, body)
  values (auth.uid(), left(trim(p_name),80),
          left(coalesce(nullif(trim(p_email),''), (select email from auth.users where id = auth.uid())),120),
          case when p_kind in ('contact','venue','bug') then p_kind else 'contact' end, left(trim(p_body),4000))
  returning id into i;
  return i;
end $$;

------------------------------------------------------------------------
-- 6. Admin functions (all check i_am_admin)
------------------------------------------------------------------------
create or replace function public._admin() returns void language plpgsql stable security definer set search_path = public as $$
begin if not public.i_am_admin() then raise exception 'admin only'; end if; end $$;

create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public._admin();
  return jsonb_build_object(
    'users', (select count(*) from auth.users),
    'confirmed', (select count(*) from auth.users where email_confirmed_at is not null),
    'households', (select count(*) from households),
    'active7', (select count(distinct user_id) from activity where at > now() - interval '7 days'),
    'active1', (select count(distinct user_id) from activity where at > now() - interval '1 day'),
    'signups7', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'events_upcoming', (select count(*) from events where coalesce(end_date,start_date) >= current_date),
    'events_added7', (select count(*) from events where first_seen > current_date - 7),
    'picks', (select count(*) from picks),
    'hidden', (select count(*) from hidden),
    'messages_open', (select count(*) from messages where not handled),
    'scan', (select value from app_config where key='scan'),
    'daily', (select coalesce(jsonb_agg(d order by d->>'day'),'[]') from (
        select jsonb_build_object('day', g::date, 'active', (select count(distinct user_id) from activity a where a.at::date = g::date),
                                  'signups', (select count(*) from auth.users u where u.created_at::date = g::date),
                                  'actions', (select count(*) from activity a where a.at::date = g::date)) d
        from generate_series(current_date - 29, current_date, interval '1 day') g) z),
    'added_daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d),'[]') from (
        select first_seen d, count(*) n from events where first_seen > current_date - 30 group by 1) z)
  );
end $$;

drop function if exists public.admin_users();
create or replace function public.admin_users()
returns table(user_id uuid, email text, display_name text, household_id uuid, household_name text, is_admin boolean,
              created_at timestamptz, confirmed boolean, last_sign_in_at timestamptz, last_active timestamptz,
              views bigint, listens bigint, keen bigint, going bigint, hidden bigint, clicks bigint, shares bigint)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email::text, m.display_name, m.household_id, h.name, coalesce(m.is_admin,false), u.created_at,
         u.email_confirmed_at is not null, u.last_sign_in_at,
         (select max(at) from activity a where a.user_id = u.id),
         (select count(*) from activity a where a.user_id = u.id and kind='view'),
         (select count(*) from activity a where a.user_id = u.id and kind='listen'),
         (select count(*) from picks p where p.user_id = u.id and state='interested'),
         (select count(*) from picks p where p.user_id = u.id and state='going'),
         (select count(*) from hidden x where x.by_user = u.id),
         (select count(*) from activity a where a.user_id = u.id and kind in ('tickets','official','video','photos','map','calendar')),
         (select count(*) from activity a where a.user_id = u.id and kind in ('share','invite'))
  from auth.users u left join members m on m.user_id = u.id left join households h on h.id = m.household_id
  where public.i_am_admin()
  order by coalesce((select max(at) from activity a where a.user_id = u.id), u.last_sign_in_at, u.created_at) desc nulls last
$$;

create or replace function public.admin_user_detail(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public._admin();
  return jsonb_build_object(
    'activity', (select coalesce(jsonb_agg(to_jsonb(a) order by a.at desc),'[]') from (select at, kind, event_id, event_title, meta from activity where user_id = p_user order by at desc limit 400) a),
    'picks', (select coalesce(jsonb_agg(jsonb_build_object('event_id',p.event_id,'state',p.state,'at',p.updated_at,'title',e.data->>'title','start',e.start_date) order by p.updated_at desc),'[]')
              from picks p left join events e on e.id = p.event_id where p.user_id = p_user),
    'hidden', (select coalesce(jsonb_agg(jsonb_build_object('event_id',x.event_id,'title',x.title,'category',x.category,'at',x.created_at) order by x.created_at desc),'[]')
              from hidden x where x.by_user = p_user),
    'friends', (select coalesce(jsonb_agg(jsonb_build_object('household',h.name,'share_plans',f.share_plans)),'[]')
              from friendships f join households h on h.id = f.friend_household_id
              where f.household_id = (select household_id from members where user_id = p_user)),
    'household_members', (select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',m.display_name)),'[]')
              from members m where m.household_id = (select household_id from members where user_id = p_user))
  );
end $$;

create or replace function public.admin_recent_activity(p_limit int default 200)
returns table(at timestamptz, user_id uuid, who text, kind text, event_id text, event_title text, meta jsonb)
language sql stable security definer set search_path = public, auth as $$
  select a.at, a.user_id, coalesce(m.display_name, u.email::text), a.kind, a.event_id, a.event_title, a.meta
  from activity a left join members m on m.user_id = a.user_id left join auth.users u on u.id = a.user_id
  where public.i_am_admin()
  order by a.at desc limit least(greatest(p_limit,1),1000)
$$;

drop function if exists public.admin_event_stats(int);
create or replace function public.admin_event_stats(p_days int default 30)
returns table(event_id text, title text, start_date date, category text, views bigint, listens bigint, keen bigint, going bigint,
              hidden bigint, clicks bigint, shares bigint)
language sql stable security definer set search_path = public as $$
  with a as (select event_id, kind from activity where at > now() - make_interval(days => p_days) and event_id is not null),
  ids as (select event_id from a union select event_id from picks union select event_id from hidden)
  select i.event_id, coalesce(e.data->>'title', (select max(event_title) from activity x where x.event_id = i.event_id)), e.start_date, e.data->>'category',
         (select count(*) from a where a.event_id = i.event_id and kind='view'),
         (select count(*) from a where a.event_id = i.event_id and kind='listen'),
         (select count(*) from picks p where p.event_id = i.event_id and state='interested'),
         (select count(*) from picks p where p.event_id = i.event_id and state='going'),
         (select count(*) from hidden h where h.event_id = i.event_id),
         (select count(*) from a where a.event_id = i.event_id and kind in ('tickets','official','video','photos','map','calendar')),
         (select count(*) from a where a.event_id = i.event_id and kind = 'share')
  from ids i left join events e on e.id = i.event_id
  where public.i_am_admin()
  order by 5 desc, 7 desc, 8 desc limit 300
$$;

create or replace function public.admin_messages()
returns setof public.messages language sql stable security definer set search_path = public as $$
  select * from messages where public.i_am_admin() order by handled, at desc limit 300
$$;
create or replace function public.admin_message_done(p_id bigint, p_done boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._admin(); update messages set handled = p_done where id = p_id; end $$;

create or replace function public.admin_households()
returns table(id uuid, name text, created_at timestamptz, members jsonb, friends bigint)
language sql stable security definer set search_path = public as $$
  select h.id, h.name, h.created_at,
         (select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',m.display_name)),'[]') from members m where m.household_id = h.id),
         (select count(*) from friendships f where f.household_id = h.id)
  from households h where public.i_am_admin() order by h.created_at desc
$$;

create or replace function public.admin_set_admin(p_user uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._admin();
  if p_user = auth.uid() and not p_on then raise exception 'You cannot remove your own admin rights'; end if;
  update members set is_admin = p_on where user_id = p_user;
end $$;

create or replace function public.admin_set_name(p_user uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._admin(); update members set display_name = nullif(left(trim(p_name),40),'') where user_id = p_user; end $$;

create or replace function public.admin_move_user(p_user uuid, p_household uuid)
returns void language plpgsql security definer set search_path = public as $$
declare old uuid;
begin
  perform public._admin();
  if not exists (select 1 from households where id = p_household) then raise exception 'household not found'; end if;
  select household_id into old from members where user_id = p_user;
  update members set household_id = p_household where user_id = p_user;
  update picks set household_id = p_household where user_id = p_user;
  update hidden set household_id = p_household where by_user = p_user
    and not exists (select 1 from hidden h2 where h2.household_id = p_household and h2.event_id = hidden.event_id);
  if old is not null and old <> p_household and not exists (select 1 from members where household_id = old) then
    delete from households where id = old;
  end if;
end $$;

create or replace function public.admin_delete_user(p_user uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare h uuid;
begin
  perform public._admin();
  if p_user = auth.uid() then raise exception 'Use Delete my account in Settings to delete yourself'; end if;
  select household_id into h from public.members where user_id = p_user;
  delete from auth.users where id = p_user;
  if h is not null and not exists (select 1 from public.members where household_id = h) then delete from public.households where id = h; end if;
end $$;

------------------------------------------------------------------------
-- 7. Grants
------------------------------------------------------------------------
do $$ declare f text; begin
  foreach f in array array[
    'public.my_codes()','public.join_household(text,text)','public.create_household(text,text,text)',
    'public.redeem_invite(text,text,text)','public.connect_friend(text)','public.create_invite()','public.friend_picks()',
    'public.delete_my_account()','public.log_activity(jsonb)','public.submit_message(text,text,text,text)',
    'public.my_household()','public.i_am_admin()','public.promote_if_admin()','public.import_seed(jsonb,jsonb,jsonb)',
    'public.admin_upsert_events(jsonb,integer,text)',
    'public.admin_overview()','public.admin_users()','public.admin_user_detail(uuid)','public.admin_recent_activity(integer)',
    'public.admin_event_stats(integer)','public.admin_messages()','public.admin_message_done(bigint,boolean)',
    'public.admin_households()','public.admin_set_admin(uuid,boolean)','public.admin_set_name(uuid,text)',
    'public.admin_move_user(uuid,uuid)','public.admin_delete_user(uuid)']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke execute on function public._code_guard() from public, anon, authenticated;
revoke execute on function public._admin() from public, anon, authenticated;
revoke execute on function public._new_code(int) from public, anon, authenticated;
-- anonymous visitors may send a contact message (rate-limited)
grant execute on function public.submit_message(text,text,text,text) to anon;
