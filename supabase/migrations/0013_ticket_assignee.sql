-- =========================================================================
-- CivicSays — 0013_ticket_assignee.sql
--
-- Ticket assignment for staff:
--   1. Add `assigned_official_id` (uuid, nullable, FK to officials) to
--      `public.tickets` — same shape as `inquiries.assigned_official_id`
--      (0001_init.sql:100).
--   2. Index the new column for the aggregate RPC + filter queries.
--   3. New aggregate RPC `count_tickets_by_assignee()` — whole-table
--      counts grouped by `assigned_official_id` (NULL = unassigned),
--      same `current_official_id()` guard as 0011 / 0012.
--   4. `create or replace` of `list_staff_tickets` — adds the new
--      `assigned_official_id` + `assigned_official_name` (LEFT JOIN to
--      officials) columns and a new `p_assignee_filter text` parameter
--      that drives the new Assignee filter pills on the staff
--      dashboard.
--
-- RLS: no new policy required.
--   - The existing `tickets update official` policy (0002_rls.sql:164-169)
--     already lets any active official UPDATE any ticket column.
--   - The `tickets_update_guard` trigger (0003_triggers.sql:16-41) only
--     blocks changes to resident_* / kind / location / title /
--     description / attachment_* / video_link. `assigned_official_id`
--     is NOT in that list, so officials can freely assign tickets.
--
-- Historical note: 0009_staff_listing_rpc.sql:22-26 contains a NOTE
-- explaining why `assigned_official_id` was omitted from the original
-- `list_staff_tickets` SELECT. That note is now historical — the
-- column exists. We leave 0009 alone (no cross-migration edit) so a
-- future `git revert` of 0013 doesn't have to also re-edit 0009.
--
-- Idempotent: every statement uses `if not exists` / `or replace` /
-- `drop if exists`. Safe to re-run.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. The column
-- -------------------------------------------------------------------------
alter table public.tickets
  add column if not exists assigned_official_id uuid null
    references public.officials(id) on delete set null;

comment on column public.tickets.assigned_official_id is
  'UUID of the staff official this ticket is assigned to. NULL = unassigned.';

-- -------------------------------------------------------------------------
-- 2. The index
-- -------------------------------------------------------------------------
create index if not exists tickets_assigned_official_idx
  on public.tickets(assigned_official_id);

-- -------------------------------------------------------------------------
-- 3. The aggregate count RPC
--    Same shape as count_tickets_by_status() (0011) but groups by
--    `assigned_official_id` and returns the unassigned bucket as
--    `assigned_official_id IS NULL` (Postgres aggregates NULLs into a
--    single row automatically when grouping by a nullable column).
-- -------------------------------------------------------------------------
drop function if exists public.count_tickets_by_assignee();

create or replace function public.count_tickets_by_assignee()
returns table (
  assigned_official_id uuid,
  count               bigint
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if public.current_official_id() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select t.assigned_official_id, count(*)::bigint
    from public.tickets t
    group by t.assigned_official_id;
end;
$$;

grant execute on function public.count_tickets_by_assignee() to authenticated;

comment on function public.count_tickets_by_assignee() is
  'Staff-only aggregate count of all tickets grouped by assigned_official_id (NULL = unassigned). No LIMIT — used for Assignee filter pills.';

-- -------------------------------------------------------------------------
-- 4. list_staff_tickets — add the assignee column, the assignee-name
--    column (via LEFT JOIN), the new p_assignee_filter parameter, and
--    the new p_from_date / p_to_date parameters for the Date filter.
--
--    The p_assignee_filter text accepts:
--      NULL      = no filter
--      'unassigned' = t.assigned_official_id IS NULL
--      anything else = t.assigned_official_id = p_assignee_filter::uuid
--
--    The p_from_date / p_to_date parameters are inclusive on each
--    end. To is implemented as `created_at < (to_date + 1 day)` so
--    the full day is included regardless of timezone. Both default
--    to null (no date filter). All date math happens on
--    t.created_at (matches the Ticket Trend chart, which buckets
--    on `(created_at at time zone 'UTC')::date`).
--
--    The dev/0008 apply script runs this same CREATE OR REPLACE in
--    one paste, so the production function is updated atomically with
--    the column add.
-- -------------------------------------------------------------------------
create or replace function public.list_staff_tickets(
  p_status_filter    text default null,
  p_kind_filter      text default null,
  p_assignee_filter  text default null,
  p_from_date        text default null,
  p_to_date          text default null,
  p_limit            int  default 50
)
returns table (
  id                    text,
  status                text,
  kind                  text,
  title                 text,
  resident_name         text,
  assigned_official_id  uuid,
  assigned_official_name text,
  created_at            timestamptz,
  resolved_at           timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_assignee_filter text := p_assignee_filter;
begin
  if public.current_official_id() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select
      t.id,
      t.status,
      t.kind,
      t.title,
      t.resident_name,
      t.assigned_official_id,
      o.full_name as assigned_official_name,
      t.created_at,
      t.resolved_at
    from public.tickets t
    left join public.officials o on o.id = t.assigned_official_id
    where (p_status_filter is null or t.status = p_status_filter)
      and (p_kind_filter   is null or t.kind   = p_kind_filter)
      and (
        v_assignee_filter is null
        or (v_assignee_filter = 'unassigned' and t.assigned_official_id is null)
        or (v_assignee_filter <> 'unassigned' and t.assigned_official_id = v_assignee_filter::uuid)
      )
      and (p_from_date is null or t.created_at >= p_from_date::date)
      and (p_to_date   is null or t.created_at <  (p_to_date::date + interval '1 day'))
    order by t.created_at desc
    limit v_limit;
end;
$$;

grant execute on function public.list_staff_tickets(text, text, text, text, text, int) to authenticated;

comment on function public.list_staff_tickets(text, text, text, text, text, int) is
  'Staff-only list of tickets with optional status, kind, assignee, and date filters. LIMIT clamped to 1-100. Assignee: null=all, ''unassigned''=NULL bucket, otherwise=uuid. Date: both null=no filter, p_from_date inclusive, p_to_date inclusive (full day via to_date+1day comparison).';
