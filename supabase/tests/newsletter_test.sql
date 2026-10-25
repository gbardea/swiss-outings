-- Weekly email: own preferences only, secret-guarded sending, one-click unsubscribe.
create temp table n_res(n serial, name text, ok boolean, info text);
grant all on n_res to authenticated, anon; grant usage on sequence n_res_n_seq to authenticated, anon;
insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-0000-0000-0000000000a8','n1@test.invalid',now()),('00000000-0000-0000-0000-0000000000b8','n2@test.invalid',now()),('00000000-0000-0000-0000-0000000000c8','n3@test.invalid',null);
insert into households(id,name,join_code,friend_code) values ('00000000-0000-0000-0000-0000000000d8','House N','TJOINNNN','TFRNDNNN'),('00000000-0000-0000-0000-0000000000e8','House O','TJOINOOO','TFRNDOOO');
insert into members(user_id,household_id,display_name,is_admin) values ('00000000-0000-0000-0000-0000000000a8','00000000-0000-0000-0000-0000000000d8','Nora',true),('00000000-0000-0000-0000-0000000000b8','00000000-0000-0000-0000-0000000000e8','Otto',false),('00000000-0000-0000-0000-0000000000c8','00000000-0000-0000-0000-0000000000e8','Unconfirmed',false);
insert into app_config(key,value) values ('newsletter','{"secret":"s3cret-s3cret-s3cret-s3cret-s3cret-123"}') on conflict (key) do update set value=excluded.value;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a8","role":"authenticated","aal":"aal1"}',true);
do $$ declare n int; t text; begin
  insert into email_prefs(user_id,weekly) values (auth.uid(), true); insert into n_res(name,ok) values ('user can opt in', true);
  begin select token into t from email_prefs; insert into n_res(name,ok) values ('user cannot read the unsubscribe token', false);
  exception when insufficient_privilege then insert into n_res(name,ok) values ('user cannot read the unsubscribe token', true); end;
  begin update email_prefs set last_sent = null; insert into n_res(name,ok) values ('user cannot change the send log', false);
  exception when insufficient_privilege then insert into n_res(name,ok) values ('user cannot change the send log', true); end;
  begin insert into email_prefs(user_id,weekly) values ('00000000-0000-0000-0000-0000000000b8', true); insert into n_res(name,ok) values ('cannot opt someone else in', false);
  exception when others then insert into n_res(name,ok) values ('cannot opt someone else in', true); end;
  begin perform public.newsletter_batch('wrong-wrong-wrong-wrong-wrong-wrong-1'); insert into n_res(name,ok) values ('recipient list needs the secret', false);
  exception when others then insert into n_res(name,ok) values ('recipient list needs the secret', true); end;
  insert into n_res(name,ok) values ('test email needs the admin 2-step session', public.newsletter_test_target() is null);
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000b8","role":"authenticated"}',true);
do $$ declare n int; begin
  insert into email_prefs(user_id,weekly) values (auth.uid(), false);
  insert into email_prefs(user_id,weekly,updated_at) values (auth.uid(), true, now()) on conflict (user_id) do update set user_id=excluded.user_id, weekly=excluded.weekly, updated_at=excluded.updated_at;
  insert into n_res(name,ok) values ('the app can switch it on and off (upsert)', (select weekly from email_prefs));
  insert into email_prefs(user_id,weekly,updated_at) values (auth.uid(), false, now()) on conflict (user_id) do update set user_id=excluded.user_id, weekly=excluded.weekly, updated_at=excluded.updated_at;
  begin update email_prefs set user_id='00000000-0000-0000-0000-0000000000a8'; insert into n_res(name,ok) values ('cannot move your settings onto someone else', false);
  exception when others then insert into n_res(name,ok) values ('cannot move your settings onto someone else', true); end;
  select count(*) into n from email_prefs; insert into n_res(name,ok,info) values ('users only see their own email settings', n=1, n::text);
end $$;
reset role;
insert into email_prefs(user_id,weekly) values ('00000000-0000-0000-0000-0000000000c8', true);

set local role anon;
do $$ declare j jsonb; n int; tok text; begin
  j := public.newsletter_batch('s3cret-s3cret-s3cret-s3cret-s3cret-123');
  insert into n_res(name,ok,info) values ('batch: only opted-in, confirmed users', jsonb_array_length(j)=1 and j->0->>'email'='n1@test.invalid', j::text);
  perform public.newsletter_mark_sent('s3cret-s3cret-s3cret-s3cret-s3cret-123', array['00000000-0000-0000-0000-0000000000a8'::uuid]);
  j := public.newsletter_batch('s3cret-s3cret-s3cret-s3cret-s3cret-123');
  insert into n_res(name,ok,info) values ('no second email on the same day', jsonb_array_length(j)=0, j::text);
  j := public.newsletter_batch('s3cret-s3cret-s3cret-s3cret-s3cret-123', '00000000-0000-0000-0000-0000000000a8');
  tok := j->0->>'token';
  insert into n_res(name,ok) values ('unsubscribe: short or wrong token does nothing', not public.newsletter_unsubscribe('abc') and not public.newsletter_unsubscribe(repeat('x',64)));
  insert into n_res(name,ok) values ('unsubscribe link works without signing in', public.newsletter_unsubscribe(tok));
end $$;
reset role;
insert into n_res(name,ok) values ('unsubscribed user is opted out', not (select weekly from email_prefs where user_id='00000000-0000-0000-0000-0000000000a8'));

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a8","role":"authenticated","aal":"aal2"}',true);
do $$ begin insert into n_res(name,ok) values ('admin with 2-step can send a test to themselves', public.newsletter_test_target() = auth.uid()); end $$;
reset role;

select name, ok, info from n_res order by n;
