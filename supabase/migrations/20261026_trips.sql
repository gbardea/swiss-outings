-- "Plan our day": household planning settings (home address, family) and saved trips. Run after 20261025_calendar.sql. Safe to re-run.

-- Private to the household (not in households.prefs, which connected friends can read)
create table if not exists public.household_settings (
  household_id uuid primary key references public.households(id) on delete cascade,
  home_label text, home_lat double precision, home_lon double precision,
  adults int not null default 2 check (adults between 1 and 8),
  kids jsonb not null default '[]'::jsonb,
  half_fare boolean not null default false, junior boolean not null default false,
  travel text not null default 'train' check (travel in ('train','car')),
  updated_at timestamptz not null default now()
);
alter table public.household_settings enable row level security;
drop policy if exists hs_own on public.household_settings;
create policy hs_own on public.household_settings for all to authenticated
  using (household_id = public.my_household()) with check (household_id = public.my_household());
revoke all on public.household_settings from anon, authenticated;
grant select, insert, update on public.household_settings to authenticated;

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  day date not null,
  plan jsonb not null,
  done jsonb not null default '[]'::jsonb,
  share_token text unique not null default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trips_hh_day on public.trips(household_id, day);
alter table public.trips enable row level security;
drop policy if exists trips_own on public.trips;
create policy trips_own on public.trips for all to authenticated
  using (household_id = public.my_household()) with check (household_id = public.my_household() and pg_column_size(plan) < 200000);
revoke all on public.trips from anon, authenticated;
grant select, insert, delete on public.trips to authenticated;
grant update (title, day, plan, done, updated_at) on public.trips to authenticated;   -- not share_token / household_id

-- Shared trip page (/t/<token>): anyone with the link, but never the home address or family details
create or replace function public.trip_public(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('title', t.title, 'day', t.day, 'done', t.done, 'updated_at', t.updated_at,
                            'plan', (t.plan - 'start' - 'params' - 'who'))
  from trips t where t.share_token = p_token and length(p_token) >= 24
$$;
revoke execute on function public.trip_public(text) from public;
grant execute on function public.trip_public(text) to anon, authenticated;

-- log planner use
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
                       'when','calendar_connect','plan','plan_save','plan_share','plan_edit');
  get diagnostics n = row_count; return n;
end $$;
revoke execute on function public.log_activity(jsonb) from public, anon;
grant execute on function public.log_activity(jsonb) to authenticated;
