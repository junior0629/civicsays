-- =========================================================================
-- CivicSays — rename ticket kind 'complaint' → 'report'
--
-- One-paste script. Run in Supabase Studio → SQL editor → New query.
-- Idempotent: drop + update + add.
--
-- The 50 demo tickets in this dev database were created with the old
-- 'complaint' value. The UPDATE block here maps them to 'report' so the
-- new CHECK constraint accepts them. If you have a clean dev database
-- (or no rows at all), the UPDATE is a no-op.
--
-- ORDER MATTERS: we DROP the old CHECK first, then UPDATE the rows, then
-- ADD the new CHECK. Adding the new CHECK before the UPDATE would fail
-- with 23514 ("check constraint violated by some row") because Postgres
-- validates the new constraint against all existing rows immediately.
--
-- After running, refresh /admin.html — the "Report" filter pill will
-- now show the previously-complaint rows. New tickets via /submit.html
-- will save with kind='report'.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Drop the old CHECK constraint. We drop without re-adding yet.
--    If you've already run this script once, the constraint is already
--    gone (or already the new one) — the IF EXISTS makes this a no-op.
-- -------------------------------------------------------------------------

alter table public.tickets
  drop constraint if exists tickets_kind_check;

-- -------------------------------------------------------------------------
-- 2. Migrate existing rows.
--    No-op if there are no 'complaint' rows (the typical case after the
--    rename block has already been applied once).
-- -------------------------------------------------------------------------

update public.tickets
  set kind = 'report'
  where kind = 'complaint';

-- -------------------------------------------------------------------------
-- 3. Add the new CHECK constraint with the new (request, report) values.
--    Now safe — all rows are either 'request' or 'report'.
-- -------------------------------------------------------------------------

alter table public.tickets
  add constraint tickets_kind_check
  check (kind in ('request', 'report'));

-- -------------------------------------------------------------------------
-- 4. Sanity check — expect ONLY 'request' and 'report' rows. Any
--    'complaint' row would mean the rename was incomplete.
-- -------------------------------------------------------------------------

select kind, count(*)
from public.tickets
group by kind
order by kind;
