-- =========================================================================
-- CivicSays — apply migration 0012 (count_tickets_by_day RPC)
--
-- One-paste script. Run in Supabase Studio → SQL editor → New query.
--
-- Adds count_tickets_by_day(p_start_date date, p_end_date date) — an
-- aggregate RPC that returns one row per day in the inclusive range,
-- including zero-count days. The dashboard's Ticket Trend card calls
-- this once with (today - 6 days, today) to draw the 7-day line chart.
--
-- IMPORTANT: Supabase Studio wraps multi-statement scripts in a
-- transaction. If any statement in the script raises an error, the
-- whole transaction rolls back — including the CREATE FUNCTION that
-- succeeded earlier. So this script does NOT include a sanity-check
-- SELECT at the end (it would raise 42501 when run by the service
-- role, which is what the SQL Editor uses, and roll everything back).
-- To verify the function exists, run this in the editor after:
--
--   select proname from pg_proc where proname = 'count_tickets_by_day';
--   -- expected: one row, proname = 'count_tickets_by_day'
--
-- To exercise it (this WILL return rows under the service role if you
-- temporarily bypass the guard — see below):
--
--   -- direct equivalent of the dashboard's call, but be aware this
--   -- will raise 42501 because the service role has no auth.uid() and
--   -- so current_official_id() returns null. To test from the editor
--   -- without going through the dashboard, comment out the guard:
--   --   update pg_proc set prosrc = replace(prosrc,
--   --     'if public.current_official_id() is null then', 'if false then')
--   --   where proname = 'count_tickets_by_day';
--   --   select * from public.count_tickets_by_day(
--   --     (current_date - interval '6 days')::date, current_date
--   --   ) order by day;
--   --   -- (remember to revert the guard afterward)
--
-- After applying, hard-refresh /admin.html. The Ticket Trend card
-- should appear between the KPI row and the Tabs row, with a 7-day
-- line chart drawn from real tickets.created_at data.
-- =========================================================================

drop function if exists public.count_tickets_by_day(date, date);

create or replace function public.count_tickets_by_day(
  p_start_date date,
  p_end_date   date
)
returns table (
  day    date,
  count  bigint
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if public.current_official_id() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    with day_spine as (
      select generate_series(p_start_date, p_end_date, interval '1 day')::date as d
    )
    select
      s.d::date                              as day,
      coalesce(t.cnt, 0)::bigint             as count
    from day_spine s
    left join (
      select (created_at at time zone 'UTC')::date as d, count(*) as cnt
      from public.tickets
      where (created_at at time zone 'UTC')::date between p_start_date and p_end_date
      group by 1
    ) t on t.d = s.d
    order by s.d;
end;
$$;

grant execute on function public.count_tickets_by_day(date, date) to authenticated;

comment on function public.count_tickets_by_day(date, date) is
  'Staff-only per-day ticket count for an inclusive date range. Returns one row per day including zero-count days. Used by the Ticket Trend chart on the staff dashboard.';
