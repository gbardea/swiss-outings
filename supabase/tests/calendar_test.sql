-- Calendar-connection checks. Run after both migrations (and after security_test.sql's fixtures if combined).
create temp table c_res(n serial, name text, ok boolean, info text);
grant all on c_res to authenticated, anon; grant usage on sequence c_res_n_seq to authenticated, anon;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000e1','e1@test.invalid'),('00000000-0000-0000-0000-0000000000e2','e2@test.invalid'),('00000000-0000-0000-0000-0000000000f1','f1@test.invalid');
insert into households(id,name,join_code,friend_code) values ('00000000-0000-0000-0000-0000000000ee','House E','TJOINEEE','TFRNDEEE'),('00000000-0000-0000-0000-0000000000fe','House F','TJOINFFF','TFRNDFFF');
insert into members(user_id,household_id,display_name) values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000ee','Eve'),('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000ee','Ed'),('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000fe','Fay');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}',true);
do $$ declare n int; begin
  perform public.save_calendar_link('ics','ciphertext-for-eve-0123456789','iPhone / iCloud calendar');
  select count(*) into n from public.my_calendar(); insert into c_res(name,ok) values ('user can connect a calendar', n=1);
  begin perform 1 from calendar_links; insert into c_res(name,ok) values ('calendar table not readable directly', false);
  exception when insufficient_privilege then insert into c_res(name,ok) values ('calendar table not readable directly', true); end;
  begin perform public.save_calendar_link('evil','ciphertext-0123456789012','x'); insert into c_res(name,ok) values ('unknown provider rejected', false);
  exception when others then insert into c_res(name,ok) values ('unknown provider rejected', true); end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}',true);
do $$ declare n int; begin
  perform public.save_calendar_link('google','ciphertext-for-ed-0123456789','Google Calendar');
  select count(*) into n from public.household_calendars(); insert into c_res(name,ok,info) values ('partner check sees both household calendars', n=2, n::text);
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}',true);
do $$ declare n int; begin
  select count(*) into n from public.household_calendars(); insert into c_res(name,ok,info) values ('other households see none of them', n=0, n::text);
  select count(*) into n from public.my_calendar(); insert into c_res(name,ok,info) values ('my_calendar shows only my own', n=0, n::text);
  perform public.delete_my_calendar();
end $$;
reset role;
insert into c_res(name,ok) values ('someone else''s disconnect deletes nothing', (select count(*) from calendar_links)=2);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}',true);
do $$ declare n int; begin
  perform public.delete_my_calendar(); select count(*) into n from public.my_calendar(); insert into c_res(name,ok) values ('user can disconnect', n=0);
  select public.log_activity('[{"kind":"when"},{"kind":"calendar_connect"}]') into n; insert into c_res(name,ok,info) values ('when/connect are logged', n=2, n::text);
end $$;
reset role;
set local role anon;
do $$ begin begin perform public.household_calendars(); insert into c_res(name,ok) values ('anon cannot list calendars', false);
  exception when insufficient_privilege then insert into c_res(name,ok) values ('anon cannot list calendars', true); end; end $$;
reset role;
select name, ok, info from c_res order by n;
