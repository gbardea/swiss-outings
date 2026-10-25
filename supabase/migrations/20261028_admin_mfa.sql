-- Admin needs two steps: the admin account's password AND a 6-digit code from an authenticator app (Supabase MFA, "aal2").
-- Every admin function, admin-only table policy and admin config write goes through i_am_admin(), so they all require the code.
-- Run after 20261027_coverage.sql. Safe to re-run.
-- Recovery if the phone with the authenticator is lost (run in the Supabase SQL editor):
--   delete from auth.mfa_factors where user_id = (select id from auth.users where email = '<your email>');
create or replace function public.i_am_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.members where user_id = auth.uid()), false)
     and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'aal', '') = 'aal2'
$$;

-- Is this an admin account at all (before the code step)? Only used to decide whether to show the code prompt.
create or replace function public.i_am_admin_account()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.members where user_id = auth.uid()), false)
$$;
grant execute on function public.i_am_admin_account() to authenticated;
