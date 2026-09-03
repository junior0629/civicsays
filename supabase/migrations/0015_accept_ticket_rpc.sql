-- =========================================================================
-- CivicSays — 0015_accept_ticket_rpc.sql
--
-- "Accept a ticket" — one-click workflow for the staff "Waiting to Be
-- Accepted" rail card.
--
--   Combines the three writes a staff Accept needs in a single atomic
--   SECURITY DEFINER call:
--     1. UPDATE tickets SET assigned_official_id = current_official_id()
--                              , status               = 'in_process'
--        WHERE the ticket is still unassigned AND still 'pending'.
--        The two WHERE guards make the call idempotent: a second click
--        is a no-op (it just re-returns the existing row, which the JS
--        side treats as a success).
--     2. Insert a system comment 'Ticket has been accepted by [Name].'
--        so the comment thread explains WHY the ticket changed hands.
--     3. The AFTER UPDATE OF status trigger (on_ticket_status_change,
--        0003_triggers.sql:53-101) automatically fires inside the same
--        transaction and inserts a second system comment:
--          'Status changed to In Process by [Name].'
--        plus a ticket_status_history row. Both messages are
--        intentional — the first is the human "I took this" note, the
--        second is the audit log of the status flip.
--
--   Why a dedicated RPC instead of two client-side calls:
--     - Single round-trip (perceived latency).
--     - Single transaction (no half-applied state if the network blips
--       or RLS regresses between the UPDATE and the INSERT).
--     - Reuses the same current_official_id() guard as 0009/0011/0012/
--       0013/0014, so the same friendlyErrorForStaff() mapping in
--       js/admin.js works.
--
--   RLS: no new policy required.
--     - The existing 'tickets update official' policy (0002_rls.sql)
--       already lets any active official UPDATE any ticket column.
--     - The tickets_update_guard trigger (0003_triggers.sql:16-41)
--       only blocks changes to resident_*/kind/location/title/
--       description/attachment_*/video_link. assigned_official_id and
--       status are NOT in that list, so officials can freely change
--       both.
--     - The ticket_comments INSERT policy (0002_rls.sql) lets an
--       authenticated official post comments with any author_role
--       including 'system'.
--
--   Idempotent: drop if exists + create or replace.
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
  -- Gate on the same current_official_id() check every other staff RPC
  -- uses. Raises 42501 (mapped to a friendly message in
  -- friendlyErrorForStaff() in js/admin.js).
  if v_official_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Guard against NULL / empty ticket IDs up front so a bad client
  -- payload can't silently hit the WHERE clause as IS NULL.
  if p_ticket_id is null or btrim(p_ticket_id) = '' then
    raise exception 'ticket id is required'
      using errcode = '22023';  -- invalid_parameter_value
  end if;

  -- Atomic UPDATE — sets the assignee and flips status. The two
  -- WHERE guards make this idempotent: a second concurrent Accept
  -- (or a network-retry double-click) matches zero rows because the
  -- first caller has already set assigned_official_id. We return
  -- USING RETURNING in the no-op case so the JS side can render
  -- the same "accepted" toast and not treat a race as a failure.
  update public.tickets t
     set assigned_official_id = v_official_id,
         status               = 'in_process'
   where t.id = p_ticket_id
     and t.assigned_official_id is null
     and t.status = 'pending'
  returning t.id, t.assigned_official_id, t.status
     into v_updated;

  -- If the row was already accepted (or wasn't pending) by a parallel
  -- caller, just return the current state. The client treats this as
  -- success — the desired end state is reached either way.
  if v_updated.id is null then
    return query
      select t.id, t.assigned_official_id, t.status
        from public.tickets t
       where t.id = p_ticket_id;
    return;
  end if;

  -- The AFTER UPDATE OF status trigger has already fired by now
  -- (Postgres fires AFTER triggers within the same transaction, before
  -- the statement returns) and inserted a system comment
  -- 'Status changed to In Process by [Name].' plus a history row.
  -- We add a SECOND system comment to explain the assignment action.
  -- Both messages are kept in the thread on purpose — one tells the
  -- story ("accepted by …"), the other is the audit log of the
  -- status flip.
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
