-- =========================================================================
-- CivicSays — 0012_ticket_trend_rpc.sql
--
-- Aggregate ticket counts by day for the dashboard's Ticket Trend card.
-- Returns one row per day in the inclusive [p_start_date, p_end_date]
-- range, including zero-count days. No LIMIT — the chart sizes itself
-- to the result length (typically 7 for the "Last 7 days" chip).
--
-- Why a separate RPC instead of just calling list_staff_tickets:
--   list_staff_tickets is paginated to 50 rows and ordered by
--   created_at desc, so it would silently cap the trend at the most
--   recent 50 days. This RPC bucketing by (created_at at time zone
--   'UTC')::date and LEFT JOIN'd against a generate_series spine
--   gives an honest per-day count, including empty days, with no
--   upper bound on the range the user could ask for later.
--
-- Same SECURITY DEFINER + current_official_id() guard as
-- 0011_ticket_status_counts.sql and 0009_staff_listing_rpc.sql.
--
-- Idempotent: drop if exists + create or replace.
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
