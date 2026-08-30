-- =========================================================================
-- CivicSays — apply 0010 (recent-activity RPC) for the staff dashboard
-- right rail.
--
-- One-paste script. Run in Supabase Studio → SQL editor → New query.
-- Idempotent: drop + create or replace + grant.
--
-- After running, refresh /admin.html — the "Recent activity" panel
-- populates with real rows from ticket_status_history + official
-- ticket_comments.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Apply migration 0010.
--    drop-then-create is needed because the function's RETURNS TABLE shape
--    is set when it's first created. (Same caveat as 0001_apply_0009.)
-- -------------------------------------------------------------------------

drop function if exists public.list_recent_staff_activity(int);

create or replace function public.list_recent_staff_activity(
  p_limit int default 10
)
returns table (
  activity_id  uuid,
  kind         text,
  ticket_id    text,
  actor_name   text,
  summary      text,
  detail       text,
  created_at   timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  if public.current_official_id() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select * from (
      select
        h.id               as activity_id,
        'status_change'    as kind,
        h.ticket_id        as ticket_id,
        h.changed_by_name  as actor_name,
        coalesce('Status: ' ||
          case h.from_status
            when 'pending' then 'Pending'
            when 'in_process' then 'In Process'
            when 'hold' then 'On Hold'
            when 'solved' then 'Solved'
            else coalesce(h.from_status, 'New')
          end || ' → ' ||
          case h.to_status
            when 'pending' then 'Pending'
            when 'in_process' then 'In Process'
            when 'hold' then 'On Hold'
            when 'solved' then 'Solved'
            else h.to_status
          end,
          'Status changed') as summary,
        null::text         as detail,
        h.changed_at       as created_at
      from public.ticket_status_history h

      union all

      select
        c.id               as activity_id,
        'official_reply'   as kind,
        c.ticket_id        as ticket_id,
        c.author_name      as actor_name,
        'Official reply posted' as summary,
        c.body             as detail,
        c.created_at       as created_at
      from public.ticket_comments c
      where c.author_role = 'official'
    ) feed
    order by feed.created_at desc
    limit v_limit;
end;
$$;

grant execute on function public.list_recent_staff_activity(int) to authenticated;

-- -------------------------------------------------------------------------
-- 2. Sanity check — should return at least 1 row (the demo comments +
--    status changes from supabase/dev/0001_apply_0009_and_seed_tickets.sql).
-- -------------------------------------------------------------------------
select
  kind,
  ticket_id,
  summary,
  created_at
from public.list_recent_staff_activity(10);
