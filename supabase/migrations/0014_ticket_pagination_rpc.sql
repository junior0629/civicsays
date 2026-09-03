-- =========================================================================
-- CivicSays — 0014_ticket_pagination_rpc.sql
--
-- Pagination for the staff tickets table.
--
-- Two coordinated changes:
--   1. Extend `list_staff_tickets` (0013) with a new `p_offset int
--      default 0` parameter (clamped to >= 0) and bump the LIMIT
--      clamp ceiling from 100 to 200. The page-size selector on the
--      dashboard offers 10/20/50; 50 × 4 = 200 max possible page
--      window, so 200 is the honest upper bound. Same WHERE/ORDER
--      shape as 0013 — just `limit v_limit offset v_offset`.
--   2. New aggregate RPC `count_tickets_filtered(p_status_filter
--      text, p_kind_filter text, p_assignee_filter text,
--      p_from_date text, p_to_date text) returns bigint` that runs
--      the SAME WHERE conditions as `list_staff_tickets`. Powers the
--      pagination footer ("Showing 1 to 20 of 24 tickets") under any
--      active filter combination.
--
-- Why a sibling RPC instead of client-side counting: the dashboard
-- already runs `count_tickets_by_status` + `count_tickets_by_assignee`
-- for the KPI cards / Assignee pills (those are unfiltered whole-
-- table counts), so adding a third sibling for the FILTERED count
-- is the honest pattern. The new RPC is small and shares the same
-- `current_official_id()` guard as 0011 / 0012 / 0013.
--
-- RLS: no new policy required. Both functions are SECURITY DEFINER
-- and gated on `current_official_id()`.
--
-- Idempotent: drop if exists + create or replace.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. list_staff_tickets — add p_offset, raise LIMIT clamp to 200
-- -------------------------------------------------------------------------
drop function if exists public.list_staff_tickets(text, text, text, text, text, int, int);

create or replace function public.list_staff_tickets(
  p_status_filter    text default null,
  p_kind_filter      text default null,
  p_assignee_filter  text default null,
  p_from_date        text default null,
  p_to_date          text default null,
  p_limit            int  default 50,
  p_offset           int  default 0
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
  v_limit  int := least(greatest(coalesce(p_limit,  50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
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
    limit v_limit
    offset v_offset;
end;
$$;

grant execute on function public.list_staff_tickets(text, text, text, text, text, int, int) to authenticated;

comment on function public.list_staff_tickets(text, text, text, text, text, int, int) is
  'Staff-only list of tickets with optional status, kind, assignee, and date filters. LIMIT clamped to 1-200, OFFSET clamped to >=0. Assignee: null=all, ''unassigned''=NULL bucket, otherwise=uuid. Date: both null=no filter, p_from_date inclusive, p_to_date inclusive (full day via to_date+1day comparison).';

-- -------------------------------------------------------------------------
-- 2. count_tickets_filtered — sibling aggregate that mirrors the
--    list_staff_tickets WHERE conditions. Returns the total row
--    count under the same filter combination so the pagination
--    footer can render "Showing X to Y of Z tickets" honestly.
-- -------------------------------------------------------------------------
drop function if exists public.count_tickets_filtered(text, text, text, text, text);

create or replace function public.count_tickets_filtered(
  p_status_filter    text default null,
  p_kind_filter      text default null,
  p_assignee_filter  text default null,
  p_from_date        text default null,
  p_to_date          text default null
)
returns bigint
language plpgsql stable security definer set search_path = public
as $$
declare
  v_total           bigint;
  v_assignee_filter text := p_assignee_filter;
begin
  if public.current_official_id() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select count(*)
    into v_total
    from public.tickets t
   where (p_status_filter is null or t.status = p_status_filter)
     and (p_kind_filter   is null or t.kind   = p_kind_filter)
     and (
       v_assignee_filter is null
       or (v_assignee_filter = 'unassigned' and t.assigned_official_id is null)
       or (v_assignee_filter <> 'unassigned' and t.assigned_official_id = v_assignee_filter::uuid)
     )
     and (p_from_date is null or t.created_at >= p_from_date::date)
     and (p_to_date   is null or t.created_at <  (p_to_date::date + interval '1 day'));

  return coalesce(v_total, 0);
end;
$$;

grant execute on function public.count_tickets_filtered(text, text, text, text, text) to authenticated;

comment on function public.count_tickets_filtered(text, text, text, text, text) is
  'Staff-only aggregate count of tickets matching the same WHERE conditions as list_staff_tickets. Returns bigint (0 when no rows). Drives the pagination footer total.';
