-- Public "what we cover" numbers for the welcome screen and the "How it works" story. Aggregates only, no personal data.
-- Run after 20261026_trips.sql. Safe to re-run.
create or replace function public.coverage()
returns jsonb language sql stable security definer set search_path = public as $$
  with up as (
    select id, data, start_date from events where coalesce(end_date, start_date) >= current_date
  ), tg as (
    select lower(t) t, count(*) n from up, jsonb_array_elements_text(coalesce(up.data->'tags','[]'::jsonb)) t group by 1
  )
  select jsonb_build_object(
    'events',     (select count(*) from up),
    'venues',     (select count(distinct lower(data->>'venue')) from up),
    'towns',      (select count(distinct lower(data->>'city')) from up),
    'new7',       (select count(*) from up where data->>'firstSeen' >= (current_date - 7)::text),
    'free',       (select count(*) from up where (data->>'free')::boolean),
    'gems',       (select count(*) from up where data->>'scale' = 'gem'),
    'kids',       (select count(*) from up where data->'audience' ?| array['Kids','Family']),
    'months',     (select greatest(1, ((max(start_date) - current_date) / 30)::int) from up),
    'categories', (select jsonb_object_agg(k, n) from (select data->>'category' k, count(*) n from up group by 1) x where k is not null),
    'regions',    (select jsonb_object_agg(k, n) from (select data->>'region' k, count(*) n from up group by 1) x where k is not null),
    'tags',       (select jsonb_object_agg(t, n) from tg where t in ('nature','village','tradition','unusual','small venue','hands-on','wildlife','stargazing','market','guided hike','date night','free')),
    'sources',    (select count(*) from scan_sources),
    'sourceGroups',(select jsonb_object_agg(grp, n) from (select grp, count(*) n from scan_sources group by 1) x),
    'sourceRegions',(select count(distinct region) from scan_sources),
    'lastRun',    (select value->>'lastRun' from app_config where key = 'scan'),
    'lastAdded',  (select value->>'lastAdded' from app_config where key = 'scan'),
    'samples',    (select coalesce(jsonb_agg(s), '[]'::jsonb) from (
                     select jsonb_build_object('id', id, 'title', data->>'title', 'city', data->>'city', 'start', data->>'start', 'category', data->>'category') s
                     from up where data->>'scale' = 'gem' and start_date <= current_date + 60
                       and data->'tags' ?| array['unusual','nature','wildlife','stargazing','tradition','village','hands-on']
                     order by md5(id || current_date::text) limit 4) z)
  )
$$;
grant execute on function public.coverage() to anon, authenticated;

-- log "How it works" views
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
                       'when','calendar_connect','plan','plan_save','plan_share','plan_edit','story');
  get diagnostics n = row_count; return n;
end $$;
revoke execute on function public.log_activity(jsonb) from public, anon;
grant execute on function public.log_activity(jsonb) to authenticated;
