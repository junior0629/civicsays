-- =========================================================================
-- CivicSays — 0009_staff_listing_rpc.sql
-- Phase 5a: RPCs for the staff admin dashboard.
--   - list_staff_tickets   : filtered, paginated list of all tickets
--   - list_staff_inquiries : filtered, paginated list of all inquiries
--                            (with last_message_at computed)
--
-- Both functions:
--   - require the caller to be an active, signed-in official
--   - return SECURITY DEFINER to allow server-side filtering + LIMIT
--   - clamp LIMIT to at most 100 to avoid runaway responses
--   - grant EXECUTE to `authenticated` only (residents are anon)
--
-- Why RPC instead of direct SELECT? RLS already permits anon + authenticated
-- to SELECT all rows on `tickets` and `inquiries`. The RPC is purely for
-- ergonomics (single round-trip, server-side filter+limit, computed columns)
-- and to keep the staff query shape stable as the schema evolves.
-- =========================================================================

-- -------------------------------------------------------------------------
-- list_staff_tickets
-- -------------------------------------------------------------------------
create or replace function public.list_staff_tickets(
  p_status_filter text default null,
  p_kind_filter   text default null,
  p_limit         int  default 50
)
returns table (
  id                   text,
  status               text,
  kind                 text,
  title                text,
  resident_name        text,
  created_at           timestamptz,
  resolved_at          timestamptz,
  assigned_official_id uuid
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
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
      t.created_at,
      t.resolved_at,
      t.assigned_official_id
    from public.tickets t
    where (p_status_filter is null or t.status   = p_status_filter)
      and (p_kind_filter   is null or t.kind     = p_kind_filter)
    order by t.created_at desc
    limit v_limit;
end;
$$;

grant execute on function public.list_staff_tickets(text, text, int) to authenticated;

comment on function public.list_staff_tickets(text, text, int) is
  'Staff-only list of tickets with optional status and kind filters. LIMIT clamped to 1-100.';

-- -------------------------------------------------------------------------
-- list_staff_inquiries
-- -------------------------------------------------------------------------
create or replace function public.list_staff_inquiries(
  p_status_filter text default null,
  p_limit         int  default 50
)
returns table (
  id              uuid,
  resident_name   text,
  subject         text,
  status          text,
  created_at      timestamptz,
  resolved_at     timestamptz,
  last_message_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if public.current_official_id() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select
      i.id,
      i.resident_name,
      i.subject,
      i.status,
      i.created_at,
      i.resolved_at,
      (
        select max(m.created_at)
        from public.inquiry_messages m
        where m.inquiry_id = i.id
      ) as last_message_at
    from public.inquiries i
    where (p_status_filter is null or i.status = p_status_filter)
    order by i.created_at desc
    limit v_limit;
end;
$$;

grant execute on function public.list_staff_inquiries(text, int) to authenticated;

comment on function public.list_staff_inquiries(text, int) is
  'Staff-only list of inquiries with optional status filter and computed last_message_at. LIMIT clamped to 1-100.';
