-- =========================================================================
-- CivicSays — one-paste demo data mixer
--
-- Resets all 50 demo tickets to a realistic status distribution
-- (40% pending, 25% in_process, 15% hold, 20% solved) AND clears the
-- 50 "Resident changed status" history rows that would otherwise flood
-- the Recent Activity feed.
--
-- Idempotent: safe to re-run. If you've already run 0003, the only
-- effect is re-bucketing (the result is the same target distribution).
--
-- How to run:
--   Supabase Studio -> SQL Editor -> New query -> paste -> Run.
--   Then hard-refresh /admin.html. The donut should show roughly:
--     pending ~20, in_process ~12, hold ~8, solved ~10
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Re-bucket the 50 tickets. Newest 20% of the table becomes 'solved'
--    so the dashboard shows recent activity; oldest 40% stays 'pending'
--    so the warm amber bar dominates the donut.
-- -------------------------------------------------------------------------
with ordered as (
  select
    id,
    created_at,
    row_number() over (order by created_at desc) as rn,
    count(*) over () as total
  from public.tickets
),
bucketed as (
  select
    id,
    case
      when rn <= (total * 0.40)::int                            then 'pending'
      when rn <= (total * 0.65)::int                            then 'in_process'
      when rn <= (total * 0.80)::int                            then 'hold'
      else                                                          'solved'
    end as new_status,
    case
      when rn <= (total * 0.80)::int then null
      else created_at + interval '6 hours'   -- solved resolved_at = 6h after creation
    end as new_resolved_at
  from ordered
)
update public.tickets t
set
  status      = b.new_status,
  resolved_at = b.new_resolved_at
from bucketed b
where t.id = b.id;

-- -------------------------------------------------------------------------
-- 2. Wipe the 50 status-change rows the trigger just created, so the
--    "Recent updates" feed on the right rail stays clean. We only delete
--    the rows this script just produced (changed_at within the last
--    2 minutes) — leaves any real human-driven history untouched.
-- -------------------------------------------------------------------------
delete from public.ticket_status_history
where changed_at > now() - interval '2 minutes';

-- -------------------------------------------------------------------------
-- 3. Sanity check — expect roughly 20/12/8/10 for 50 rows.
-- -------------------------------------------------------------------------
select status, count(*)
from public.tickets
group by status
order by status;
