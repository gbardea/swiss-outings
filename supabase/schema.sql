-- Swiss Outings schema
create extension if not exists pgcrypto;

-- Shared event feed (written by the daily scan with the service role)
create table if not exists public.events (
  id text primary key,
  data jsonb not null,
  start_date date,
  end_date date,
  first_seen date default current_date,
  updated_at timestamptz default now()
);
create index if not exists events_start_idx on public.events(start_date);

create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text unique not null default upper(substr(md5(random()::text),1,6)),
  friend_code text unique not null default upper(substr(md5(random()::text),1,6)),
  prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists public.app_invites (
  code text primary key default upper(substr(md5(random()::text),1,8)),
  created_by_household uuid references public.households(id) on delete set null,
  used_by_household uuid references public.households(id) on delete set null,
  created_at timestamptz default now(),
  used_at timestamptz
);

create table if not exists public.picks (
  event_id text not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  state text not null check (state in ('interested','going')),
  updated_at timestamptz default now(),
  primary key (event_id, user_id)
);

create table if not exists public.hidden (
  household_id uuid not null references public.households(id) on delete cascade,
  event_id text not null references public.events(id) on delete cascade,
  by_user uuid references auth.users(id) on delete set null,
  title text, category text, tags jsonb,
  created_at timestamptz default now(),
  primary key (household_id, event_id)
);

-- A row (A,B) means household A is connected to B; share_plans = A lets B see A's picks
create table if not exists public.friendships (
  household_id uuid not null references public.households(id) on delete cascade,
  friend_household_id uuid not null references public.households(id) on delete cascade,
  share_plans boolean not null default false,
  created_at timestamptz default now(),
  primary key (household_id, friend_household_id)
);

-- helpers
create or replace function public.my_household() returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from public.members where user_id = auth.uid()
$$;
create or replace function public.i_am_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.members where user_id = auth.uid()), false)
$$;

alter table public.events enable row level security;
alter table public.app_config enable row level security;
alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.app_invites enable row level security;
alter table public.picks enable row level security;
alter table public.hidden enable row level security;
alter table public.friendships enable row level security;

-- events: anyone can read (public listings; also used by the calendar-file endpoint)
drop policy if exists events_read on public.events;
create policy events_read on public.events for select using (true);

drop policy if exists config_read on public.app_config;
create policy config_read on public.app_config for select to authenticated using (true);
drop policy if exists config_admin on public.app_config;
create policy config_admin on public.app_config for all to authenticated using (public.i_am_admin()) with check (public.i_am_admin());

-- households: see own + connected friends
drop policy if exists hh_read on public.households;
create policy hh_read on public.households for select to authenticated using (
  id = public.my_household()
  or id in (select friend_household_id from public.friendships where household_id = public.my_household())
  or public.i_am_admin()
);
drop policy if exists hh_update on public.households;
create policy hh_update on public.households for update to authenticated using (id = public.my_household()) with check (id = public.my_household());

-- members: own household (admin sees all)
drop policy if exists mem_read on public.members;
create policy mem_read on public.members for select to authenticated using (household_id = public.my_household() or public.i_am_admin());
drop policy if exists mem_update_self on public.members;
create policy mem_update_self on public.members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and household_id = public.my_household());
drop policy if exists mem_admin_delete on public.members;
create policy mem_admin_delete on public.members for delete to authenticated using (public.i_am_admin() or user_id = auth.uid());

-- invites: see the ones my household created
drop policy if exists inv_read on public.app_invites;
create policy inv_read on public.app_invites for select to authenticated using (created_by_household = public.my_household() or public.i_am_admin());

-- picks: own household, plus friends who share with us
drop policy if exists picks_read on public.picks;
create policy picks_read on public.picks for select to authenticated using (
  household_id = public.my_household()
  or household_id in (select household_id from public.friendships where friend_household_id = public.my_household() and share_plans)
);
drop policy if exists picks_write on public.picks;
create policy picks_write on public.picks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and household_id = public.my_household());

-- hidden: own household
drop policy if exists hidden_all on public.hidden;
create policy hidden_all on public.hidden for all to authenticated
  using (household_id = public.my_household()) with check (household_id = public.my_household());

-- friendships
drop policy if exists fr_read on public.friendships;
create policy fr_read on public.friendships for select to authenticated using (household_id = public.my_household() or friend_household_id = public.my_household());
drop policy if exists fr_update on public.friendships;
create policy fr_update on public.friendships for update to authenticated using (household_id = public.my_household()) with check (household_id = public.my_household());
drop policy if exists fr_delete on public.friendships;
create policy fr_delete on public.friendships for delete to authenticated using (household_id = public.my_household() or friend_household_id = public.my_household());

-- RPCs ---------------------------------------------------------------
-- Join an existing household (partner) with its join code
create or replace function public.join_household(p_code text, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into h from households where join_code = upper(trim(p_code));
  if h is null then raise exception 'That household code was not found'; end if;
  insert into members(user_id, household_id, display_name) values (auth.uid(), h, nullif(trim(p_name),''))
  on conflict (user_id) do update set household_id = excluded.household_id, display_name = coalesce(excluded.display_name, members.display_name);
  return h;
end $$;

-- Create a new household with an app invite code (friends); auto-connect to the inviter
create or replace function public.redeem_invite(p_code text, p_household_name text, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv app_invites; h uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into inv from app_invites where code = upper(trim(p_code)) and used_by_household is null for update;
  if inv.code is null then raise exception 'That invite code is not valid or was already used'; end if;
  insert into households(name) values (coalesce(nullif(trim(p_household_name),''),'My household')) returning id into h;
  insert into members(user_id, household_id, display_name) values (auth.uid(), h, nullif(trim(p_name),''))
  on conflict (user_id) do update set household_id = excluded.household_id;
  update app_invites set used_by_household = h, used_at = now() where code = inv.code;
  if inv.created_by_household is not null then
    insert into friendships(household_id, friend_household_id) values (h, inv.created_by_household), (inv.created_by_household, h)
    on conflict do nothing;
  end if;
  return h;
end $$;

-- Any member can create an invite for a friend household (max 20 open per household)
create or replace function public.create_invite()
returns text language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_household(); c text; n int;
begin
  if h is null then raise exception 'not in a household'; end if;
  select count(*) into n from app_invites where created_by_household = h and used_by_household is null;
  if n >= 20 then raise exception 'Too many unused invites'; end if;
  insert into app_invites(created_by_household) values (h) returning code into c;
  return c;
end $$;

-- Connect two existing households using the other's friend code
create or replace function public.connect_friend(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_household(); f uuid;
begin
  if h is null then raise exception 'not in a household'; end if;
  select id into f from households where friend_code = upper(trim(p_code));
  if f is null then raise exception 'That friend code was not found'; end if;
  if f = h then raise exception 'That is your own code'; end if;
  insert into friendships(household_id, friend_household_id) values (h,f),(f,h) on conflict do nothing;
  return f;
end $$;

-- Friends' going/keen counts without exposing non-shared picks
create or replace function public.friend_picks()
returns table(event_id text, household_name text, state text)
language sql stable security definer set search_path = public as $$
  select p.event_id, hh.name, max(p.state)
  from picks p
  join friendships f on f.household_id = p.household_id and f.friend_household_id = public.my_household() and f.share_plans
  join households hh on hh.id = p.household_id
  group by p.event_id, hh.name
$$;

grant execute on function public.join_household(text,text) to authenticated;
grant execute on function public.redeem_invite(text,text,text) to authenticated;
grant execute on function public.create_invite() to authenticated;
grant execute on function public.connect_friend(text) to authenticated;
grant execute on function public.friend_picks() to authenticated;
grant execute on function public.my_household() to authenticated;
grant execute on function public.i_am_admin() to authenticated;

-- realtime
do $$ begin
  begin alter publication supabase_realtime add table public.picks; exception when others then null; end;
  begin alter publication supabase_realtime add table public.hidden; exception when others then null; end;
  begin alter publication supabase_realtime add table public.events; exception when others then null; end;
end $$;
