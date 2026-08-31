-- =========================================================================
-- CivicSays — re-mix ticket statuses
--
-- The 50 tickets in the dev database have piled up with mostly-pending
-- status (from automated testing of the submit form). This re-spreads them
-- across the four statuses so the dashboard's KPI cards + ticket overview
-- bar chart show a realistic mix.
--
-- Target distribution (works for any number ≥ 4):
--   40% pending, 25% in_process, 15% hold, 20% solved
--
-- Idempotent: every row is rewritten. The created_at is preserved so the
-- "relative time" column still shows a sensible history. resolved_at is
-- stamped for solved rows (the DB trigger only fires on UPDATEs to status,
-- not on direct seed-time updates, so we set it here for the dashboard
-- overview to look right).
--
-- Safe to re-run any time.
-- =========================================================================

with ordered as (
  select
    id,
    row_number() over (order by created_at desc) as rn,
    count(*) over () as total
  from public.tickets
),
bucketed as (
  select
    id,
    case
      when rn <= (total * 0.40)::int                                then 'pending'
      when rn <= (total * 0.65)::int                                then 'in_process'
      when rn <= (total * 0.80)::int                                then 'hold'
      else                                                            'solved'
    end as new_status,
    case
      when rn <= (total * 0.80)::int then null
      else now() - (rn * interval '1 hour')
    end as new_resolved_at
  from ordered
)
update public.tickets t
set
  status      = b.new_status,
  resolved_at = b.new_resolved_at
from bucketed b
where t.id = b.id;

-- Sanity check — counts per status. Expect roughly 40/25/15/20 split.
select status, count(*)
from public.tickets
group by status
order by status;
