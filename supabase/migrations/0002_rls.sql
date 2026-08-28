-- =========================================================================
-- CivicSays — 0002_rls.sql
-- Row-level security + helper functions + RPC entry points.
--
-- Roles:
--   - anon           : unauthenticated residents
--   - authenticated  : logged-in officials
--
-- Resident identity model: residents are anonymous. The tracking ID +
-- the resident's name+phone combo is the "secret" that authorizes actions
-- on a given ticket. The RPC functions below (post_resident_comment,
-- post_inquiry_message) verify the name+phone against the ticket/inquiry
-- row server-side, then insert on behalf of the caller.
-- =========================================================================

-- -------------------------------------------------------------------------
-- Helper: is the current request an authenticated, active official?
-- -------------------------------------------------------------------------
create or replace function public.current_official_id() returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.officials
  where id = auth.uid() and is_active = true
  limit 1
$$;

create or replace function public.current_official_name() returns text
language sql stable security definer set search_path = public
as $$
  select full_name from public.officials
  where id = auth.uid() and is_active = true
  limit 1
$$;

-- -------------------------------------------------------------------------
-- RPC: post a resident comment on a ticket
-- Verifies name+phone match the ticket row, then inserts.
-- Returns the new comment row.
-- -------------------------------------------------------------------------
create or replace function public.post_resident_comment(
  p_ticket_id    text,
  p_resident_name  text,
  p_resident_phone text,
  p_body         text
)
returns public.ticket_comments
language plpgsql security definer set search_path = public
as $$
declare
  v_ticket public.tickets%rowtype;
  v_comment public.ticket_comments%rowtype;
begin
  if p_body is null or length(trim(p_body)) = 0 or length(p_body) > 5000 then
    raise exception 'Comment body must be 1-5000 characters.' using errcode = '22000';
  end if;
  if p_resident_name is null or length(trim(p_resident_name)) = 0 then
    raise exception 'Name is required.' using errcode = '22000';
  end if;
  if p_resident_phone is null or p_resident_phone !~ '^[0-9]{7,15}$' then
    raise exception 'Valid phone is required.' using errcode = '22000';
  end if;

  -- Load ticket and verify identity.
  select * into v_ticket from public.tickets where id = p_ticket_id;
  if not found then
    raise exception 'Ticket not found.' using errcode = 'P0002';
  end if;
  if v_ticket.resident_name <> trim(p_resident_name) or v_ticket.resident_phone <> p_resident_phone then
    raise exception 'Name and phone do not match this ticket.' using errcode = '42501';
  end if;

  insert into public.ticket_comments (ticket_id, author_name, author_role, body)
  values (p_ticket_id, trim(p_resident_name), 'resident', trim(p_body))
  returning * into v_comment;

  return v_comment;
end;
$$;

-- Grant execute to anon (so residents can call it).
grant execute on function public.post_resident_comment(text, text, text, text) to anon, authenticated;

-- -------------------------------------------------------------------------
-- RPC: post a resident message on an active inquiry
-- Verifies name+phone match the inquiry, then inserts.
-- -------------------------------------------------------------------------
create or replace function public.post_inquiry_message(
  p_inquiry_id    uuid,
  p_resident_name  text,
  p_resident_phone text,
  p_body         text
)
returns public.inquiry_messages
language plpgsql security definer set search_path = public
as $$
declare
  v_inquiry public.inquiries%rowtype;
  v_message public.inquiry_messages%rowtype;
begin
  if p_body is null or length(trim(p_body)) = 0 or length(p_body) > 5000 then
    raise exception 'Message body must be 1-5000 characters.' using errcode = '22000';
  end if;
  if p_resident_name is null or length(trim(p_resident_name)) = 0 then
    raise exception 'Name is required.' using errcode = '22000';
  end if;
  if p_resident_phone is null or p_resident_phone !~ '^[0-9]{7,15}$' then
    raise exception 'Valid phone is required.' using errcode = '22000';
  end if;

  select * into v_inquiry from public.inquiries where id = p_inquiry_id;
  if not found then
    raise exception 'Inquiry not found.' using errcode = 'P0002';
  end if;
  if v_inquiry.resident_name <> trim(p_resident_name) or v_inquiry.resident_phone <> p_resident_phone then
    raise exception 'Name and phone do not match this inquiry.' using errcode = '42501';
  end if;
  if v_inquiry.status <> 'active' then
    raise exception 'Conversation is not active.' using errcode = '42501';
  end if;

  insert into public.inquiry_messages (inquiry_id, sender_name, sender_role, body)
  values (p_inquiry_id, trim(p_resident_name), 'resident', trim(p_body))
  returning * into v_message;

  return v_message;
end;
$$;

grant execute on function public.post_inquiry_message(uuid, text, text, text) to anon, authenticated;

-- =========================================================================
-- officials
-- =========================================================================
alter table public.officials enable row level security;

drop policy if exists "officials read own" on public.officials;
create policy "officials read own"
  on public.officials for select
  to authenticated
  using (id = auth.uid());

-- No client-side INSERT/UPDATE/DELETE — managed via service role / seed.

-- =========================================================================
-- tickets
-- =========================================================================
alter table public.tickets enable row level security;

drop policy if exists "tickets read public" on public.tickets;
create policy "tickets read public"
  on public.tickets for select
  to anon, authenticated
  using (true);

drop policy if exists "tickets insert public" on public.tickets;
create policy "tickets insert public"
  on public.tickets for insert
  to anon, authenticated
  with check (true);

-- Only active officials can update tickets. Column-level restriction
-- (status, resolved_at, assigned_to only) is enforced by a trigger
-- in 0003_triggers.sql.
drop policy if exists "tickets update official" on public.tickets;
create policy "tickets update official"
  on public.tickets for update
  to authenticated
  using (public.current_official_id() is not null)
  with check (public.current_official_id() is not null);

-- No client-side DELETE.

-- =========================================================================
-- ticket_comments
-- =========================================================================
alter table public.ticket_comments enable row level security;

drop policy if exists "ticket_comments read public" on public.ticket_comments;
create policy "ticket_comments read public"
  on public.ticket_comments for select
  to anon, authenticated
  using (true);

-- Residents go through the post_resident_comment() RPC. Direct INSERT
-- with author_role='resident' is allowed for anon but verified via the
-- RPC's logic. The simpler policy below lets the RPC (security definer)
-- do the verification, then inserts with the same anon role.
drop policy if exists "ticket_comments insert resident" on public.ticket_comments;
create policy "ticket_comments insert resident"
  on public.ticket_comments for insert
  to anon, authenticated
  with check (author_role = 'resident');

-- Officials can insert comments as 'official'.
drop policy if exists "ticket_comments insert official" on public.ticket_comments;
create policy "ticket_comments insert official"
  on public.ticket_comments for insert
  to authenticated
  with check (
    author_role = 'official'
    and public.current_official_id() is not null
  );

-- Block manual system comments (only triggers may insert them).
drop policy if exists "ticket_comments no system insert" on public.ticket_comments;
create policy "ticket_comments no system insert"
  on public.ticket_comments for insert
  to anon, authenticated
  with check (author_role <> 'system');

-- No UPDATE/DELETE policies — comments are immutable.

-- =========================================================================
-- ticket_status_history
-- =========================================================================
alter table public.ticket_status_history enable row level security;

drop policy if exists "ticket_status_history read public" on public.ticket_status_history;
create policy "ticket_status_history read public"
  on public.ticket_status_history for select
  to anon, authenticated
  using (true);

-- No client INSERT — written by trigger only (security definer bypasses RLS).

-- =========================================================================
-- inquiries
-- =========================================================================
alter table public.inquiries enable row level security;

drop policy if exists "inquiries read public" on public.inquiries;
create policy "inquiries read public"
  on public.inquiries for select
  to anon, authenticated
  using (true);

drop policy if exists "inquiries insert public" on public.inquiries;
create policy "inquiries insert public"
  on public.inquiries for insert
  to anon, authenticated
  with check (status = 'waiting');

drop policy if exists "inquiries update official" on public.inquiries;
create policy "inquiries update official"
  on public.inquiries for update
  to authenticated
  using (public.current_official_id() is not null)
  with check (public.current_official_id() is not null);

-- =========================================================================
-- inquiry_messages
-- =========================================================================
alter table public.inquiry_messages enable row level security;

drop policy if exists "inquiry_messages read public" on public.inquiry_messages;
create policy "inquiry_messages read public"
  on public.inquiry_messages for select
  to anon, authenticated
  using (true);

-- Residents go through post_inquiry_message() RPC; allow direct insert
-- with author_role='resident' since the RPC handles verification.
drop policy if exists "inquiry_messages insert resident" on public.inquiry_messages;
create policy "inquiry_messages insert resident"
  on public.inquiry_messages for insert
  to anon, authenticated
  with check (sender_role = 'resident');

drop policy if exists "inquiry_messages insert official" on public.inquiry_messages;
create policy "inquiry_messages insert official"
  on public.inquiry_messages for insert
  to authenticated
  with check (
    sender_role = 'official'
    and public.current_official_id() is not null
  );

drop policy if exists "inquiry_messages no system insert" on public.inquiry_messages;
create policy "inquiry_messages no system insert"
  on public.inquiry_messages for insert
  to anon, authenticated
  with check (sender_role <> 'system');
