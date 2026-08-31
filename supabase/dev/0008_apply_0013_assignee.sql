-- =========================================================================
-- CivicSays — apply migration 0013 (ticket assignment + count RPC +
-- list_staff_tickets with assignee)
--
-- One-paste script. Run in Supabase Studio → SQL editor → New query.
--
-- Adds:
--   1. `tickets.assigned_official_id` (uuid, nullable, FK to officials)
--   2. `tickets_assigned_official_idx` (index for the aggregate RPC)
--   3. `count_tickets_by_assignee()` — aggregate, no LIMIT
--   4. `list_staff_tickets` — `create or replace` adds the new
--      `assigned_official_id` + `assigned_official_name` columns and
--      the new `p_assignee_filter` parameter.
--
-- IMPORTANT: Supabase Studio wraps multi-statement scripts in a
-- transaction. If any statement in the script raises an error, the
-- whole transaction rolls back — including the CREATE FUNCTIONs that
-- succeeded earlier. So this script does NOT include a sanity-check
-- SELECT at the end (it would raise 42501 when run by the service
-- role, which is what the SQL Editor uses, and roll everything back).
-- To verify everything applied, run these in the editor after:
--
--   -- column exists:
--   \d public.tickets
--   -- expect: column "assigned_official_id" uuid NULL
--
--   -- functions exist:
--   select proname from pg_proc
--   where proname in ('count_tickets_by_assignee', 'list_staff_tickets')
--   order by proname;
--   -- expect: 2 rows
--
--   -- list_staff_tickets returns the new columns (will fail with 42501
--   -- under the service role because current_official_id() is null):
--   --   select assigned_official_id, assigned_official_name
--   --   from public.list_staff_tickets(null, null, null, 1);
--
-- After applying, hard-refresh /admin.html. The new filter rows
-- (Assignee + Date) should appear below Status + Type, the Assignee
-- column should appear in the table between Resident and Status, and
-- every existing ticket should show "Unassigned" in muted italic
-- (because 0013 just added the column, so no rows have an assignee
-- yet).
-- =========================================================================

-- 1. Column
alter table public.tickets
  add column if not exists assigned_official_id uuid null
    references public.officials(id) on delete set null;

comment on column public.tickets.assigned_official_id is
  'UUID of the staff official this ticket is assigned to. NULL = unassigned.';

-- 2. Index
create index if not exists tickets_assigned_official_idx
  on public.tickets(assigned_official_id);

-- 3. count_tickets_by_assignee
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

-- 4. list_staff_tickets (replaced with the new signature)
create or replace function public.list_staff_tickets(
  p_status_filter    text default null,
  p_kind_filter      text default null,
  p_assignee_filter  text default null,
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
    order by t.created_at desc
    limit v_limit;
end;
$$;

grant execute on function public.list_staff_tickets(text, text, text, int) to authenticated;

comment on function public.list_staff_tickets(text, text, text, int) is
  'Staff-only list of tickets with optional status, kind, and assignee filters. LIMIT clamped to 1-100. Assignee: null=all, ''unassigned''=NULL bucket, otherwise=uuid.';
