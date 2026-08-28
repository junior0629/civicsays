-- =========================================================================
-- CivicSays — 0005_seed.sql
-- Seed: one test official + enable Realtime for the relevant tables.
--
-- IMPORTANT: the auth.users row must already exist before this script runs.
-- Create it via Supabase dashboard (Authentication → Users → Add user with
-- email "official@civicsays.local" and password "ChangeMe123!"). Then run
-- this file to insert the matching public.officials row.
-- =========================================================================

-- -------------------------------------------------------------------------
-- Seed one test official.
-- Replace the UUID below with the auth.users.id of the user you created.
-- Or use this two-step pattern in the SQL editor:
--
--   select id from auth.users where email = 'official@civicsays.local';
--   -- copy the id, then run:
--   insert into public.officials (id, email, full_name) values
--     ('<paste-id-here>', 'official@civicsays.local', 'Test Official');
--
-- The block below does an upsert by email so re-runs are safe.
-- -------------------------------------------------------------------------
insert into public.officials (id, email, full_name, is_active)
select
  u.id,
  u.email,
  'Test Official',
  true
from auth.users u
where u.email = 'official@civicsays.local'
on conflict (id) do update set
  full_name = excluded.full_name,
  is_active = excluded.is_active;

-- -------------------------------------------------------------------------
-- Realtime: enable publication for tables the client subscribes to.
-- Supabase uses a publication called "supabase_realtime" and we add our
-- tables to it so .subscribe() channels receive change events.
-- -------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tickets'
  ) then
    execute 'alter publication supabase_realtime add table public.tickets';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ticket_comments'
  ) then
    execute 'alter publication supabase_realtime add table public.ticket_comments';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ticket_status_history'
  ) then
    execute 'alter publication supabase_realtime add table public.ticket_status_history';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inquiries'
  ) then
    execute 'alter publication supabase_realtime add table public.inquiries';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inquiry_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.inquiry_messages';
  end if;
end
$$;
