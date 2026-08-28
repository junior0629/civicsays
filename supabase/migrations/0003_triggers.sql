-- =========================================================================
-- CivicSays — 0003_triggers.sql
-- Triggers:
--   1. tickets_update_guard        : restrict UPDATEs to status/resolved_at
--   2. on_ticket_status_change     : append history + system comment
--   3. on_ticket_resolved          : set resolved_at when status -> solved
--   4. on_inquiry_resolved         : set resolved_at + post system message
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Block non-official UPDATE columns on tickets
-- Officials may only change status, resolved_at. Other columns (resident_*
-- name/phone/email, kind, location, title, description, attachments) are
-- write-once.
-- -------------------------------------------------------------------------
create or replace function public.tickets_update_guard() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Only block if updater is NOT a service-role bypass (e.g. system process).
  -- For authenticated officials (via RLS), restrict to safe columns.
  if auth.uid() is not null then
    -- Resident fields must not change.
    if new.resident_name   is distinct from old.resident_name   or
       new.resident_phone  is distinct from old.resident_phone  or
       new.resident_email  is distinct from old.resident_email  or
       new.kind            is distinct from old.kind            or
       new.location        is distinct from old.location        or
       new.title           is distinct from old.title           or
       new.description     is distinct from old.description     or
       new.attachment_path is distinct from old.attachment_path or
       new.attachment_mime is distinct from old.attachment_mime or
       new.video_link      is distinct from old.video_link
    then
      raise exception 'Ticket content is immutable after submission.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tickets_update_guard on public.tickets;
create trigger trg_tickets_update_guard
  before update on public.tickets
  for each row execute function public.tickets_update_guard();

-- -------------------------------------------------------------------------
-- 2. When status changes, append a history row AND a system comment.
--    Uses public.current_official_name() when auth.uid() is set, else
--    'Resident' (e.g. if we ever add a "resident reopen" path).
-- -------------------------------------------------------------------------
create or replace function public.on_ticket_status_change() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_changer_name text;
  v_changer_role text;
  v_status_label text;
begin
  if (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    -- Determine who changed it.
    if auth.uid() is not null and public.current_official_id() is not null then
      v_changer_name := public.current_official_name();
      v_changer_role := 'official';
    else
      v_changer_name := 'Resident';
      v_changer_role := 'resident';
    end if;

    -- Map status to human label.
    v_status_label := case new.status
      when 'pending'    then 'Pending'
      when 'in_process' then 'In Process'
      when 'hold'       then 'On Hold'
      when 'solved'     then 'Solved'
      else initcap(new.status)
    end;

    -- Append history row.
    insert into public.ticket_status_history
      (ticket_id, from_status, to_status, changed_by_name, changed_by_role)
    values
      (new.id, old.status, new.status, v_changer_name, v_changer_role);

    -- Append system comment to thread.
    insert into public.ticket_comments
      (ticket_id, author_name, author_role, body)
    values
      (new.id, 'System', 'system',
       format('Status changed to %s by %s.', v_status_label, v_changer_name));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ticket_status_change on public.tickets;
create trigger trg_ticket_status_change
  after update of status on public.tickets
  for each row execute function public.on_ticket_status_change();

-- -------------------------------------------------------------------------
-- 3. Stamp resolved_at when status transitions to 'solved'.
-- -------------------------------------------------------------------------
create or replace function public.on_ticket_resolved() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'solved' and old.status is distinct from 'solved' then
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;
  if new.status <> 'solved' and old.status = 'solved' then
    -- Reopened: clear resolved_at.
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ticket_resolved on public.tickets;
create trigger trg_ticket_resolved
  before update on public.tickets
  for each row execute function public.on_ticket_resolved();

-- -------------------------------------------------------------------------
-- 4. When an inquiry is resolved, stamp metadata + post a system message.
-- -------------------------------------------------------------------------
create or replace function public.on_inquiry_resolved() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_resolver text;
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.resolved_at := coalesce(new.resolved_at, now());
    v_resolver := coalesce(new.resolved_by_name, public.current_official_name(), 'An official');
    new.resolved_by_name := v_resolver;

    insert into public.inquiry_messages
      (inquiry_id, sender_name, sender_role, body)
    values
      (new.id, 'System', 'system',
       format('This conversation was closed by %s.', v_resolver));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_inquiry_resolved on public.inquiries;
create trigger trg_inquiry_resolved
  before update on public.inquiries
  for each row execute function public.on_inquiry_resolved();
