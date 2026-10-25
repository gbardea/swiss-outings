-- Security & family-feature tests. Run AFTER the migration, inside a transaction that is rolled back:
--   begin; <migration>; <this file>; rollback;
-- Uses synthetic users/households only. Prints one row per check: name, ok, info.

create temp table t_res(n serial, name text, ok boolean, info text);
grant all on t_res to authenticated, anon; grant usage on sequence t_res_n_seq to authenticated, anon;

-- fixtures ------------------------------------------------------------
insert into auth.users(id, email, email_confirmed_at, created_at) values
 ('00000000-0000-0000-0000-0000000000a1','a1@test.invalid',now(),now()),
 ('00000000-0000-0000-0000-0000000000a2','a2@test.invalid',now(),now()),
 ('00000000-0000-0000-0000-0000000000b1','b1@test.invalid',now(),now()),
 ('00000000-0000-0000-0000-0000000000c1','c1@test.invalid',now(),now()),
 ('00000000-0000-0000-0000-0000000000d1','d1@test.invalid',now(),now()),
 ('00000000-0000-0000-0000-0000000000ad','admin@test.invalid',now(),now());
insert into households(id,name,join_code,friend_code) values
 ('00000000-0000-0000-0000-00000000000a','House A','TJOINAAA','TFRNDAAA'),
 ('00000000-0000-0000-0000-00000000000b','House B','TJOINBBB','TFRNDBBB'),
 ('00000000-0000-0000-0000-0000000000ff','House Admin','TJOINXXX','TFRNDXXX');
insert into members(user_id,household_id,display_name,is_admin) values
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000a','Anna',false),
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000b','Ben',false),
 ('00000000-0000-0000-0000-0000000000ad','00000000-0000-0000-0000-0000000000ff','Boss',true);
-- A and B are friends; B shares its plans with A, A does not share with B
insert into friendships values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b',false,now()),
                               ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000a',true,now());
insert into events(id,data,start_date,end_date) values ('zz-test-1','{"id":"zz-test-1","title":"Test gig","start":"2030-01-01"}',date '2030-01-01',date '2030-01-01');
insert into picks(event_id,user_id,household_id,state) values
 ('zz-test-1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000a','interested'),
 ('zz-test-1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000b','going');

-- ANON ------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$ declare n int; begin
  select count(*) into n from events where id='zz-test-1';
  insert into t_res(name,ok,info) values ('anon can read public events', n=1, n::text);
  begin perform 1 from picks limit 1; insert into t_res(name,ok) values ('anon cannot read picks', false);
  exception when insufficient_privilege then insert into t_res(name,ok) values ('anon cannot read picks', true); end;
  begin perform 1 from households limit 1; insert into t_res(name,ok) values ('anon cannot read households', false);
  exception when insufficient_privilege then insert into t_res(name,ok) values ('anon cannot read households', true); end;
  begin delete from events where id='zz-test-1'; get diagnostics n = row_count; insert into t_res(name,ok,info) values ('anon cannot delete events', n=0, n::text);
  exception when insufficient_privilege then insert into t_res(name,ok) values ('anon cannot delete events', true); end;
  begin perform public.log_activity('[{"kind":"view"}]'); insert into t_res(name,ok) values ('anon cannot log activity', false);
  exception when insufficient_privilege then insert into t_res(name,ok) values ('anon cannot log activity', true); end;
  begin perform public.submit_message('contact','Visitor','v@test.invalid','Hello there'); insert into t_res(name,ok) values ('anon can send a contact message', true);
  exception when others then insert into t_res(name,ok,info) values ('anon can send a contact message', false, sqlerrm); end;
end $$;
reset role;

-- C1: signed-in stranger with no household (an attacker) ------------------
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}',true);
do $$ declare n int; t text; begin
  begin update members set is_admin=true where user_id=auth.uid(); exception when others then null; end;
  insert into t_res(name,ok) values ('stranger cannot make self admin', not public.i_am_admin());
  begin insert into members(user_id,household_id,is_admin) values (auth.uid(),'00000000-0000-0000-0000-00000000000a',true);
        insert into t_res(name,ok) values ('stranger cannot insert self into a household', false);
  exception when others then insert into t_res(name,ok) values ('stranger cannot insert self into a household', true); end;
  select count(*) into n from picks; insert into t_res(name,ok,info) values ('stranger sees no picks', n=0, n::text);
  select count(*) into n from households; insert into t_res(name,ok,info) values ('stranger sees no households', n=0, n::text);
  select count(*) into n from app_config where key in ('brief','admin_emails'); insert into t_res(name,ok,info) values ('stranger cannot read brief/admin list', n=0, n::text);
  select count(*) into n from activity; insert into t_res(name,ok,info) values ('stranger cannot read activity log', n=0, n::text);
  select count(*) into n from messages; insert into t_res(name,ok,info) values ('stranger cannot read messages', n=0, n::text);
  select count(*) into n from public.admin_users(); insert into t_res(name,ok,info) values ('stranger gets no admin user list', n=0, n::text);
  begin perform public.admin_overview(); insert into t_res(name,ok) values ('stranger blocked from admin overview', false);
  exception when others then insert into t_res(name,ok) values ('stranger blocked from admin overview', true); end;
  begin perform public.admin_delete_user('00000000-0000-0000-0000-0000000000a1'); insert into t_res(name,ok) values ('stranger cannot delete users', false);
  exception when others then insert into t_res(name,ok) values ('stranger cannot delete users', true); end;
  begin insert into events(id,data) values ('evil','{}'); insert into t_res(name,ok) values ('stranger cannot add events', false);
  exception when others then insert into t_res(name,ok) values ('stranger cannot add events', true); end;
  begin update app_config set value='"hacked"' where key='brief'; get diagnostics n=row_count; insert into t_res(name,ok,info) values ('stranger cannot change brief', n=0, n::text);
  exception when others then insert into t_res(name,ok) values ('stranger cannot change brief', true); end;
  begin insert into friendships values (public.my_household(),'00000000-0000-0000-0000-00000000000a',false,now()); insert into t_res(name,ok) values ('stranger cannot insert friendships', false);
  exception when others then insert into t_res(name,ok) values ('stranger cannot insert friendships', true); end;
  begin insert into picks(event_id,user_id,household_id,state) values ('zz-test-1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000a','going');
        insert into t_res(name,ok) values ('stranger cannot write picks for others', false);
  exception when others then insert into t_res(name,ok) values ('stranger cannot write picks for others', true); end;
  select public.log_activity('[{"kind":"view","event_id":"zz-test-1"},{"kind":"drop_tables"}]') into n;
  insert into t_res(name,ok,info) values ('activity log accepts only known kinds', n=1, n::text);
  -- brute force a household code
  insert into t_res(name,ok) values ('wrong household code returns nothing (no join)', public.join_household('WRONG0','x') is null and public.my_household() is null);
  for i in 1..9 loop begin perform public.join_household('WRONG'||i,'x'); exception when others then null; end; end loop;
  begin perform public.join_household('TJOINAAA','x'); insert into t_res(name,ok) values ('code guessing is rate-limited (11th try blocked even if right)', false);
  exception when others then insert into t_res(name,ok,info) values ('code guessing is rate-limited (11th try blocked even if right)', sqlerrm ilike '%too many%', sqlerrm); end;
end $$;
reset role;
delete from code_attempts where user_id='00000000-0000-0000-0000-0000000000c1';

-- C1 signs up properly via friend link of A (open sign-up) ---------------
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}',true);
do $$ declare n int; h uuid; begin
  h := public.create_household('House C','Cara','tfrndaaa');
  insert into t_res(name,ok) values ('open sign-up creates a household', h is not null and public.my_household()=h);
  select count(*) into n from households where name='House A'; insert into t_res(name,ok,info) values ('invite link connects new user to inviter', n=1, n::text);
  select count(*) into n from picks where household_id='00000000-0000-0000-0000-00000000000a'; insert into t_res(name,ok,info) values ('new friend cannot see A''s picks (A not sharing)', n=0, n::text);
  select count(*) into n from public.my_codes(); insert into t_res(name,ok) values ('my_codes returns own codes', n=1);
  select count(*) into n from public.my_codes() where join_code ~ '^[A-Z2-9]{8}$'; insert into t_res(name,ok) values ('new households get 8-character codes', n=1);
  begin update friendships set friend_household_id='00000000-0000-0000-0000-0000000000ff' where household_id=public.my_household(); insert into t_res(name,ok) values ('cannot repoint a friendship at another household', false);
  exception when others then insert into t_res(name,ok) values ('cannot repoint a friendship at another household', true); end;
  begin perform join_code from households limit 1; insert into t_res(name,ok) values ('join codes not readable from table', false);
  exception when insufficient_privilege then insert into t_res(name,ok) values ('join codes not readable from table', true); end;
end $$;
reset role;

-- A2 joins A as partner -------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}',true);
do $$ declare n int; begin
  perform public.join_household('tjoinaaa','Alex');
  insert into t_res(name,ok) values ('partner joins with household code', public.my_household()='00000000-0000-0000-0000-00000000000a');
  select count(*) into n from picks where user_id='00000000-0000-0000-0000-0000000000a1'; insert into t_res(name,ok,info) values ('partner sees the other partner''s picks', n=1, n::text);
  insert into picks(event_id,user_id,household_id,state) values ('zz-test-1',auth.uid(),public.my_household(),'going');
  select count(*) into n from picks where event_id='zz-test-1' and household_id=public.my_household(); insert into t_res(name,ok,info) values ('partner can add own pick', n=2, n::text);
  insert into hidden(household_id,event_id,by_user,title) values (public.my_household(),'zz-test-1',auth.uid(),'Test gig');
  select count(*) into n from friend_picks(); insert into t_res(name,ok,info) values ('A sees friend B''s shared plans', n=1, n::text);
  select count(*) into n from households where id='00000000-0000-0000-0000-00000000000b'; insert into t_res(name,ok,info) values ('A can see friend B''s household name', n=1, n::text);
  update members set display_name='Alexandra' where user_id=auth.uid(); get diagnostics n=row_count; insert into t_res(name,ok) values ('user can rename self', n=1);
  begin update members set is_admin=true where user_id=auth.uid(); exception when others then null; end;
  insert into t_res(name,ok) values ('member cannot make self admin', not public.i_am_admin());
  begin update members set household_id='00000000-0000-0000-0000-00000000000b' where user_id=auth.uid(); exception when others then null; end;
  insert into t_res(name,ok) values ('member cannot move self into another household', public.my_household()='00000000-0000-0000-0000-00000000000a');
end $$;
reset role;

-- B1: friend who is not shared with -------------------------------------
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}',true);
do $$ declare n int; begin
  select count(*) into n from friend_picks(); insert into t_res(name,ok,info) values ('B cannot see A''s plans (A not sharing)', n=0, n::text);
  select count(*) into n from hidden; insert into t_res(name,ok,info) values ('B cannot see A''s hidden list', n=0, n::text);
  update friendships set share_plans=true where household_id='00000000-0000-0000-0000-00000000000a'; get diagnostics n=row_count;
  insert into t_res(name,ok,info) values ('B cannot switch on A''s sharing', n=0, n::text);
end $$;
reset role;

-- ADMIN without the second step (password only) is refused -------------
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated","aal":"aal1"}',true);
do $$ declare ok boolean; begin
  insert into t_res(name,ok) values ('admin account without 2-step code is not admin', not public.i_am_admin() and public.i_am_admin_account());
  begin perform public.admin_overview(); insert into t_res(name,ok) values ('admin functions need the 2-step code', false);
  exception when others then insert into t_res(name,ok) values ('admin functions need the 2-step code', true); end;
  insert into t_res(name,ok) values ('admin lists are empty without the 2-step code', not exists (select 1 from public.admin_users()) and not exists (select 1 from public.admin_messages()));
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}',true);
do $$ begin insert into t_res(name,ok) values ('a normal user with 2-step is still not admin', not public.i_am_admin() and not public.i_am_admin_account()); end $$;
reset role;

-- ADMIN (password + code) -----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated","aal":"aal2"}',true);
do $$ declare n int; j jsonb; begin
  select count(*) into n from public.admin_users() where email like '%test.invalid'; insert into t_res(name,ok,info) values ('admin sees all users', n=6, n::text);
  j := public.admin_overview(); insert into t_res(name,ok) values ('admin overview works', (j->>'users')::int >= 6);
  j := public.admin_user_detail('00000000-0000-0000-0000-0000000000c1'); insert into t_res(name,ok,info) values ('admin sees a user''s timeline', jsonb_array_length(j->'activity')>=1, jsonb_array_length(j->'activity')::text);
  select count(*) into n from public.admin_event_stats(30) where event_id='zz-test-1'; insert into t_res(name,ok) values ('admin event stats include test event', n=1);
  select count(*) into n from public.admin_messages(); insert into t_res(name,ok) values ('admin sees contact messages', n>=1);
  perform public.admin_move_user('00000000-0000-0000-0000-0000000000d1'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid);
  perform public.admin_set_name('00000000-0000-0000-0000-0000000000a1','Anna B');
  perform public.admin_set_admin('00000000-0000-0000-0000-0000000000b1', true);
  perform public.admin_set_admin('00000000-0000-0000-0000-0000000000b1', false);
  perform public.admin_delete_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from public.admin_users() where user_id='00000000-0000-0000-0000-0000000000b1'; insert into t_res(name,ok) values ('admin can delete a user', n=0);
  begin perform public.admin_set_admin(auth.uid(), false); insert into t_res(name,ok) values ('admin cannot remove own admin', false);
  exception when others then insert into t_res(name,ok) values ('admin cannot remove own admin', true); end;
end $$;
reset role;

-- C1 deletes own account -------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}',true);
select public.delete_my_account();
reset role;
insert into t_res(name,ok) values ('delete my account removes login + household',
  not exists (select 1 from auth.users where id='00000000-0000-0000-0000-0000000000c1') and not exists (select 1 from households where name='House C'));

-- public coverage numbers: anon can read aggregates, no personal data
set local role anon;
do $$ declare c jsonb; begin
  c := public.coverage();
  insert into t_res(name,ok,info) values ('anon can read coverage numbers', (c->>'events')::int >= 1 and c ? 'sources' and not (c::text ilike '%@test.invalid%'), left(c::text,120));
end $$;
reset role;

select name, ok, info from t_res order by n;
