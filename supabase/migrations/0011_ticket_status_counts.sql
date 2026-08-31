-- =========================================================================
-- CivicSays — 0011_ticket_status_counts.sql
--
-- Aggregate ticket counts by status for the dashboard's KPI cards and
-- the "All tickets" donut chart.
--
-- Why a new RPC instead of just calling list_staff_tickets:
--   list_staff_tickets is paginated — it caps the result at 100 rows
--   and orders by created_at desc. The dashboard was computing its KPI
--   counts and donut segments from that paginated slice, which means
--   once the table has more than ~50 tickets the counts reflect only
--   the most-recent 50, not the whole table. With 75+ demo tickets the
--   donut looked 30/19/1/0 (newest 50) when the real table was
--   30/19/11/15 (all 75).
--
-- This function counts the WHOLE table, grouped by status. No LIMIT, no
-- ordering. Returns one row per status. Same SECURITY DEFINER +
-- current_official_id() guard as the other 0009 RPCs.
--
-- Idempotent: drop + create.
-- =========================================================================

drop function if exists public.count_tickets_by_status();

create or replace function public.count_tickets_by_status()
returns table (
  status  text,
  count   bigint
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if public.current_official_id() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select t.status::text, count(*)::bigint
    from public.tickets t
    group by t.status;
end;
$$;

grant execute on function public.count_tickets_by_status() to authenticated;

comment on function public.count_tickets_by_status() is
  'Staff-only aggregate count of all tickets grouped by status. No LIMIT — used for KPI cards and the donut chart.';
