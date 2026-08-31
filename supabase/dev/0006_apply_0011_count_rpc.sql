-- =========================================================================
-- CivicSays — apply migration 0011 (count_tickets_by_status RPC)
--
-- One-paste script. Run in Supabase Studio → SQL editor → New query.
--
-- Adds count_tickets_by_status() — an aggregate RPC that returns the
-- total ticket count per status across the WHOLE table (no LIMIT).
-- The dashboard's KPI cards and "All tickets" donut now call this
-- instead of computing counts from the paginated 50-row slice of
-- list_staff_tickets.
--
-- IMPORTANT: Supabase Studio wraps multi-statement scripts in a
-- transaction. If any statement in the script raises an error, the
-- whole transaction rolls back — including the CREATE FUNCTION that
-- succeeded earlier. So this script does NOT include a sanity-check
-- SELECT at the end (it would raise 42501 when run by the service
-- role, which is what the SQL Editor uses, and roll everything back).
-- To verify the function exists, run this in the editor after:
--   select proname from pg_proc where proname = 'count_tickets_by_status';
--   -- expected: one row, proname = 'count_tickets_by_status'
--
-- After applying, hard-refresh /admin.html. The donut should show the
-- full table's distribution (e.g. 30 pending / 19 in process /
-- 11 hold / 15 solved if you also ran 0005).
-- =========================================================================

drop function if exists public.count_tickets_by_status();

create function public.count_tickets_by_status()
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
