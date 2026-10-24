-- Minimal stand-in for Supabase so migrations and tests can run on a plain local Postgres.
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, created_at timestamptz default now(), last_sign_in_at timestamptz, is_sso_user boolean not null default false, is_anonymous boolean not null default false);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
create publication supabase_realtime;
