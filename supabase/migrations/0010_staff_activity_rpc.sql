-- =========================================================================
-- CivicSays — 0010_staff_activity_rpc.sql
-- Phase 5b: recent-activity feed for the staff dashboard right rail.
--
-- One RPC, list_recent_staff_activity(p_limit), returns a merged feed of
-- the most recent staff-relevant events:
--   - status transitions (rows from ticket_status_history)
--   - official replies (rows from ticket_comments where author_role='official')
--
-- The dashboard renders this as the "Recent activity" panel. We UNION ALL
-- instead of two separate RPCs because it's a single round-trip and the
-- panel is one widget, not two.
--
-- Same guard + clamp pattern as 0009:
--   - SECURITY DEFINER
--   - current_official_id() must be set, else 42501
--   - LIMIT clamped to 1-50 (default 10)
--   - grant EXECUTE to `authenticated` only
-- =========================================================================

create or replace function public.list_recent_staff_activity(
  p_limit int default 10
)
returns table (
  activity_id  uuid,
  kind         text,        -- 'status_change' | 'official_reply'
  ticket_id    text,
  actor_name   text,
  summary      text,
  detail       text,        -- the reply body, or null for status_change
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

comment on function public.list_recent_staff_activity(int) is
  'Staff-only merged feed of status transitions + official replies. LIMIT clamped to 1-50.';
