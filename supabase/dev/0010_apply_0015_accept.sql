-- =========================================================================
-- CivicSays — apply migration 0015 (accept_ticket RPC for the
-- "Waiting to Be Accepted" rail card)
--
-- One-paste script. Run in Supabase Studio → SQL editor → New query.
--
-- Adds:
--   1. public.accept_ticket(p_ticket_id text) — staff-only RPC that
--      atomically (1) sets tickets.assigned_official_id to the current
--      official, (2) flips status from 'pending' to 'in_process', and
--      (3) inserts a system comment 'Ticket has been accepted by
--      [Official Name].' The on_ticket_status_change trigger (0003)
--      auto-posts a second system comment for the status flip and a
--      ticket_status_history row, all in the same transaction.
--
-- IMPORTANT: Supabase Studio wraps multi-statement scripts in a
-- transaction. If any statement in the script raises an error, the
-- whole transaction rolls back — including the CREATE FUNCTION that
-- succeeded earlier. So this script does NOT include a sanity-check
-- SELECT at the end (it would raise 42501 when run by the service
-- role, which is what the SQL Editor uses, and roll everything back).
-- To verify the function applied, run this in the editor after:
--
--   -- function exists:
--   select proname, pg_get_function_identity_arguments(oid)
--   from pg_proc
--   where proname = 'accept_ticket';
--   -- expect: 1 row, arg = 'text'
--
--   -- exercise it (will fail with 42501 under the service role
--   -- because current_official_id() is null — that's the same
--   -- gate every other staff RPC uses):
--   --   select * from public.accept_ticket('CIV-XXXXXX');
--
-- After applying, hard-refresh /admin.html. The new "Waiting to Be
-- Accepted" card should appear in the right rail, between Inquiries
-- and Recent activity. It lists every ticket where
-- assigned_official_id IS NULL AND status = 'pending'. Clicking the
-- per-row Accept button calls accept_ticket() — the row vanishes from
-- the queue within ~1s, the ticket detail page shows two new system
-- comments, and the ticket's status badge flips to "In Process" with
-- the current staff member's name in the Assignee column.
-- =========================================================================

drop function if exists public.accept_ticket(text);

create or replace function public.accept_ticket(
  p_ticket_id text
)
returns table (
  id                    text,
  assigned_official_id  uuid,
  status                text
)
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_official_id  uuid := public.current_official_id();
  v_official_name text := public.current_official_name();
  v_updated record;
begin
  if v_official_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_ticket_id is null or btrim(p_ticket_id) = '' then
    raise exception 'ticket id is required'
      using errcode = '22023';
  end if;

  update public.tickets t
     set assigned_official_id = v_official_id,
         status               = 'in_process'
   where t.id = p_ticket_id
     and t.assigned_official_id is null
     and t.status = 'pending'
  returning t.id, t.assigned_official_id, t.status
     into v_updated;

  if v_updated.id is null then
    return query
      select t.id, t.assigned_official_id, t.status
        from public.tickets t
       where t.id = p_ticket_id;
    return;
  end if;

  insert into public.ticket_comments
    (ticket_id, author_name, author_role, body)
  values
    (v_updated.id, 'System', 'system',
     format('Ticket has been accepted by %s.', v_official_name));

  return query
    select v_updated.id, v_updated.assigned_official_id, v_updated.status;
end;
$$;

grant execute on function public.accept_ticket(text) to authenticated;

comment on function public.accept_ticket(text) is
  'Staff-only: atomically (1) assign ticket to the current official, (2) flip status from pending to in_process, and (3) post a system comment ''Ticket has been accepted by [Name].'' Idempotent: a second call on the same ticket is a no-op. The on_ticket_status_change trigger (0003) auto-posts a second system comment for the status flip and a ticket_status_history row, all in the same transaction.';
