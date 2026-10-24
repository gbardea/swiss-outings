-- Planner storage checks: household-private settings and trips; public link hides home and family.
create temp table p_res(n serial, name text, ok boolean, info text);
grant all on p_res to authenticated, anon; grant usage on sequence p_res_n_seq to authenticated, anon;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a7','g1@test.invalid'),('00000000-0000-0000-0000-0000000000b7','h1@test.invalid');
insert into households(id,name,join_code,friend_code) values ('00000000-0000-0000-0000-0000000000c7','House G','TJOINGGG','TFRNDGGG'),('00000000-0000-0000-0000-0000000000d7','House H','TJOINHHH','TFRNDHHH');
insert into members(user_id,household_id,display_name) values ('00000000-0000-0000-0000-0000000000a7','00000000-0000-0000-0000-0000000000c7','Gina'),('00000000-0000-0000-0000-0000000000b7','00000000-0000-0000-0000-0000000000d7','Hal');
insert into friendships values ('00000000-0000-0000-0000-0000000000c7','00000000-0000-0000-0000-0000000000d7',true,now()),('00000000-0000-0000-0000-0000000000d7','00000000-0000-0000-0000-0000000000c7',true,now());

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a7","role":"authenticated"}',true);
do $$ declare n int; tok text; begin
  insert into household_settings(household_id,home_label,home_lat,home_lon,kids) values (public.my_household(),'Seestrasse 1, 8700 Küsnacht',47.31,8.58,'[9,6]');
  insert into p_res(name,ok) values ('household can save its home address', true);
  insert into trips(household_id,created_by,title,day,plan) values (public.my_household(),auth.uid(),'Rapperswil day','2030-05-01',
    '{"title":"Rapperswil day","start":{"lat":47.31,"lon":8.58,"label":"Seestrasse 1, 8700 Küsnacht"},"who":{"kids":[9,6]},"params":{"x":1},"stops":[{"name":"Kinderzoo"}]}');
  select count(*) into n from trips; insert into p_res(name,ok,info) values ('household sees its trip', n=1, n::text);
  begin insert into trips(household_id,title,day,plan) values ('00000000-0000-0000-0000-0000000000d7','evil','2030-05-01','{}'); insert into p_res(name,ok) values ('cannot create trips for another household', false);
  exception when others then insert into p_res(name,ok) values ('cannot create trips for another household', true); end;
  begin update trips set share_token='guessable' where true; insert into p_res(name,ok) values ('share token cannot be changed', false);
  exception when others then insert into p_res(name,ok) values ('share token cannot be changed', true); end;
  update trips set done='[0]' where true; get diagnostics n=row_count; insert into p_res(name,ok) values ('can tick off stops', n=1);
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000b7","role":"authenticated"}',true);
do $$ declare n int; begin
  select count(*) into n from household_settings; insert into p_res(name,ok,info) values ('friends cannot see your home address', n=0, n::text);
  select count(*) into n from trips; insert into p_res(name,ok,info) values ('friends cannot list your trips', n=0, n::text);
  select count(*) into n from households where prefs::text like '%Seestrasse%'; insert into p_res(name,ok) values ('home address not in readable household prefs', n=0);
end $$;
reset role;

set local role anon;
do $$ declare j jsonb; tok text; begin
  select share_token into tok from (select share_token from trips) x;  -- anon cannot read trips: expect error
  insert into p_res(name,ok) values ('anon cannot read trips table', false);
exception when insufficient_privilege then insert into p_res(name,ok) values ('anon cannot read trips table', true); end $$;
reset role;
do $$ declare tok text; begin select share_token into tok from trips limit 1; perform set_config('test.tok', tok, true); end $$;
set local role anon;
do $$ declare j jsonb; begin
  j := public.trip_public(current_setting('test.tok'));
  insert into p_res(name,ok,info) values ('shared link shows the trip to anyone', j->>'title'='Rapperswil day', j->>'title');
  insert into p_res(name,ok) values ('shared link hides home address and family', (j->'plan'->'start') is null and (j->'plan'->'who') is null and position('Seestrasse' in j::text)=0);
  insert into p_res(name,ok) values ('wrong or short token shows nothing', public.trip_public('abc') is null and public.trip_public(repeat('x',32)) is null);
end $$;
reset role;
select name, ok, info from p_res order by n;
