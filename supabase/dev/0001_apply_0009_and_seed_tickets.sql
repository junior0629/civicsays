-- =========================================================================
-- CivicSays — apply 0009 staff RPCs + seed 10 demo tickets + a few comments
--
-- This is a one-time dev script. Run it in Supabase Studio → SQL editor →
-- New query. It is idempotent where it can be (CREATE OR REPLACE, INSERT
-- only-if-missing), but the ticket insert is intentionally not idempotent
-- because you may want to re-run and see fresh IDs.
--
-- After running:
--   1. The dashboard's "Could not find the function" error goes away.
--   2. /admin.html shows 10 tickets distributed across all 4 statuses and
--      both kinds. Click any of them to see the ticket detail page with
--      comments.
--
-- Safe to re-run if you've already applied 0009 (the RPC is CREATE OR
-- REPLACE). The ticket inserts are NOT idempotent — re-running will
-- create duplicates. To re-seed cleanly, first run:
--   delete from public.ticket_comments where ticket_id like 'CIV-DEMO%';
--   delete from public.tickets where id like 'CIV-DEMO%';
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Apply migration 0009.
--    NOT a pure CREATE OR REPLACE this time: changing the RETURNS TABLE
--    of list_staff_tickets (dropping assigned_official_id which only
--    exists on `inquiries`) requires dropping the old signature first.
--    Postgres refuses to change an existing function's row type with
--    CREATE OR REPLACE. If you haven't applied the old version yet
--    (fresh project), the DROP will warn and continue.
-- -------------------------------------------------------------------------

drop function if exists public.list_staff_tickets(text, text, int);
drop function if exists public.list_staff_inquiries(text, int);

create or replace function public.list_staff_tickets(
  p_status_filter text default null,
  p_kind_filter   text default null,
  p_limit         int  default 50
)
returns table (
  id              text,
  status          text,
  kind            text,
  title           text,
  resident_name   text,
  created_at      timestamptz,
  resolved_at     timestamptz
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
      t.resolved_at
    from public.tickets t
    where (p_status_filter is null or t.status   = p_status_filter)
      and (p_kind_filter   is null or t.kind     = p_kind_filter)
    order by t.created_at desc
    limit v_limit;
end;
$$;

grant execute on function public.list_staff_tickets(text, text, int) to authenticated;

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

-- -------------------------------------------------------------------------
-- 2. Seed 10 demo tickets. Status distribution: 4 pending, 2 in_process,
--    2 hold, 2 solved. Kind distribution: 5 request, 5 report.
--    All created_at spread over the last 14 days so the dashboard shows
--    realistic relative times.
-- -------------------------------------------------------------------------

insert into public.tickets
  (id, resident_name, resident_phone, resident_email, kind, location,
   title, description, status, created_at, resolved_at)
values
  -- 4 pending (warm left bar, eye lands here first)
  ('CIV-DEMOA1', 'Maria Santos',     '09171234567', 'maria.s@example.com',
   'request', 'Main St & 5th Ave',
   'Broken streetlight on Main St',
   'The streetlight at the corner of Main St and 5th Ave has been out for two weeks. It is a safety hazard for the evening foot traffic.',
   'pending', now() - interval '2 hours', null),

  ('CIV-DEMOA2', 'Joey Cruz',        '09181234567', 'joey.c@example.com',
   'report', 'Riverside Park, north entrance',
   'Uncollected garbage for 5 days',
   'The dumpster by the north park entrance has not been emptied in five days. The smell is becoming unbearable on warm days.',
   'pending', now() - interval '1 day', null),

  ('CIV-DEMOA3', 'Aisha Bernardo',   '09191234567', 'aisha.b@example.com',
   'request', 'Barangay Hall, Room 3',
   'Request for additional street sweeper shift',
   'Could the city add an afternoon street sweeper shift in the commercial district? Morning-only sweeps do not keep up with the foot traffic.',
   'pending', now() - interval '3 days', null),

  ('CIV-DEMOA4', 'Pedro Reyes',      '09201234567', 'pedro.r@example.com',
   'report', '7th Ave, between Oak and Pine',
   'Pothole causing tire damage',
   'There is a deep pothole on 7th Ave between Oak and Pine. Two residents have reported tire damage this week.',
   'pending', now() - interval '5 days', null),

  -- 2 in_process (blue left bar — being worked on)
  ('CIV-DEMOB1', 'Lina Garcia',      '09211234567', 'lina.g@example.com',
   'request', 'City Library, 2nd floor',
   'Air conditioning not working in reading room',
   'The 2nd-floor reading room AC has been broken for a week. With summer temperatures, it is unusable during the afternoon.',
   'in_process', now() - interval '4 days', null),

  ('CIV-DEMOB2', 'Marco Villanueva', '09221234567', 'marco.v@example.com',
   'report', 'Elm St, near Elementary School',
   'Speeding vehicles during school hours',
   'Cars regularly exceed the 30 km/h school zone limit on Elm St between 7:30-8:30 AM. Requesting a speed bump or crossing guard.',
   'in_process', now() - interval '6 days', null),

  -- 2 hold (muted left bar — waiting on something)
  ('CIV-DEMOC1', 'Rita Aquino',      '09231234567', 'rita.a@example.com',
   'request', 'Barangay 12 covered court',
   'Request for additional basketball hoop',
   'The covered court only has one basketball hoop. A second one would let more kids play at the same time.',
   'hold', now() - interval '7 days', null),

  ('CIV-DEMOC2', 'Diego Mendoza',    '09241234567', 'diego.m@example.com',
   'report', 'Riverside Park, west side',
   'Stray dogs near the playground',
   'A pack of stray dogs has been hanging around the west-side playground. Parents are afraid to let small children play there.',
   'hold', now() - interval '9 days', null),

  -- 2 solved (green + faded — eye skips)
  ('CIV-DEMOD1', 'Sofia Castillo',   '09251234567', 'sofia.c@example.com',
   'request', 'Cedar St, lot 14',
   'Fallen tree blocking sidewalk',
   'A large tree branch fell during the last storm and is blocking half the sidewalk on Cedar St.',
   'solved', now() - interval '11 days', now() - interval '8 days'),

  ('CIV-DEMOD2', 'Andres Tolentino', '09261234567', 'andres.t@example.com',
   'report', 'Maple Ave, 3rd block',
   'Noisy karaoke past midnight',
   'A neighbor runs karaoke until 2-3 AM most nights. Multiple complaints from the block. Requesting noise enforcement visit.',
   'solved', now() - interval '13 days', now() - interval '10 days');

-- -------------------------------------------------------------------------
-- 3. Seed a few comments so the ticket detail view has something to show.
--    Mix of resident follow-ups and a couple of official replies.
-- -------------------------------------------------------------------------

insert into public.ticket_comments (ticket_id, author_name, author_role, body, created_at) values
  ('CIV-DEMOB1', 'Lina Garcia',   'resident',
   'Any update? The library is still very hot in the afternoon.',
   now() - interval '3 days'),
  ('CIV-DEMOB1', 'Staff Member',  'official',
   'A technician is scheduled for Friday. We will post an update once the AC is restored.',
   now() - interval '2 days'),
  ('CIV-DEMOC1', 'Rita Aquino',   'resident',
   'I understand the budget is tight. Happy to discuss fundraising options if helpful.',
   now() - interval '5 days'),
  ('CIV-DEMOD1', 'Sofia Castillo','resident',
   'Thank you! The sidewalk is clear now.',
   now() - interval '7 days'),
  ('CIV-DEMOD1', 'Staff Member',  'official',
   'Branch removed by the parks crew. Marking this resolved.',
   now() - interval '8 days');

-- -------------------------------------------------------------------------
-- 4. Sanity check — should return 10 rows with the expected status counts.
-- -------------------------------------------------------------------------
select
  status,
  count(*) as n
from public.tickets
where id like 'CIV-DEMO%'
group by status
order by status;
