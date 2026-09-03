-- =========================================================================
-- CivicSays — apply migration 0014 (pagination: p_offset +
-- count_tickets_filtered)
--
-- One-paste script. Run in Supabase Studio → SQL editor → New query.
--
-- Adds:
--   1. `list_staff_tickets` — `create or replace` adds the new
--      `p_offset int default 0` parameter (clamped to >= 0) and bumps
--      the LIMIT clamp ceiling from 100 to 200. Same WHERE/ORDER
--      shape as 0013, just `limit v_limit offset v_offset` at the end.
--   2. `count_tickets_filtered(p_status_filter, p_kind_filter,
--      p_assignee_filter, p_from_date, p_to_date) returns bigint` —
--      sibling aggregate that mirrors the list_staff_tickets WHERE
--      conditions. Powers the pagination footer total.
--
-- IMPORTANT: Supabase Studio wraps multi-statement scripts in a
-- transaction. If any statement in the script raises an error, the
-- whole transaction rolls back — including the CREATE FUNCTIONs that
-- succeeded earlier. So this script does NOT include a sanity-check
-- SELECT at the end (it would raise 42501 when run by the service
-- role, which is what the SQL Editor uses, and roll everything back).
-- To verify everything applied, run these in the editor after:
--
--   -- both functions exist with the new signatures:
--   select proname, pg_get_function_identity_arguments(oid)
--   from pg_proc
--   where proname in ('list_staff_tickets', 'count_tickets_filtered')
--   order by proname;
--   -- expect: 2 rows; list_staff_tickets's arg list ends with
--   --         'text, text, text, text, text, integer, integer'
--
--   -- exercise the offset (will fail with 42501 under the service
--   -- role because current_official_id() is null):
--   --   select * from public.list_staff_tickets(
--   --     p_status_filter := null, p_kind_filter := null,
--   --     p_assignee_filter := null, p_from_date := null,
--   --     p_to_date := null, p_limit := 5, p_offset := 10);
--
-- After applying, hard-refresh /admin.html. The pagination footer
-- should appear below the tickets table:
--   - With 24 demo tickets and the default page size of 20, the
--     footer shows "Showing 1 to 20 of 24 tickets" and the buttons
--     "< 1 2 >" with 1 highlighted in orange.
--   - Clicking 2 re-fetches page 2 (rows 21-24).
--   - Changing the page size to 10 re-fetches and shows 3 pages.
--   - Applying any filter resets to page 1.
--   - Realtime ticket insert resets to page 1.
-- =========================================================================

-- 1. list_staff_tickets (replaced with p_offset, LIMIT clamp 200)
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

-- 2. count_tickets_filtered — sibling aggregate
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
