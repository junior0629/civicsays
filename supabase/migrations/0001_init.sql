-- =========================================================================
-- CivicSays — 0001_init.sql
-- Schema: tables, indexes, CHECK constraints, enums (as CHECKs)
-- Idempotent: safe to re-run
-- =========================================================================

-- Required for gen_random_uuid()
create extension if not exists "pgcrypto";

-- -------------------------------------------------------------------------
-- Officials — extends Supabase Auth's auth.users
-- -------------------------------------------------------------------------
create table if not exists public.officials (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text unique not null,
  full_name   text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.officials is
  'Government officials. id is FK to auth.users (Supabase Auth).';

-- -------------------------------------------------------------------------
-- Tickets — the core entity
-- -------------------------------------------------------------------------
create table if not exists public.tickets (
  id                text primary key,
  resident_name     text not null check (length(resident_name) between 1 and 100),
  resident_phone    text not null check (resident_phone ~ '^[0-9]{7,15}$'),
  resident_email    text not null check (resident_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  kind              text not null check (kind in ('request', 'report')),
  location          text not null check (length(location) between 1 and 300),
  title             text not null check (length(title) between 3 and 200),
  description       text not null check (length(description) between 1 and 5000),
  attachment_path   text null,
  attachment_mime   text null,
  video_link        text null check (video_link is null or video_link ~* '^https?://'),
  status            text not null default 'pending'
                      check (status in ('pending', 'in_process', 'hold', 'solved')),
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz null
);

comment on table public.tickets is
  'Resident-submitted tickets. id is the public CIV-XXXXXX tracking code.';

create index if not exists tickets_status_idx       on public.tickets(status);
create index if not exists tickets_created_at_idx   on public.tickets(created_at desc);
create index if not exists tickets_resident_email_idx on public.tickets(resident_email);

-- -------------------------------------------------------------------------
-- Ticket comments — comments posted on a ticket
-- -------------------------------------------------------------------------
create table if not exists public.ticket_comments (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   text not null references public.tickets(id) on delete cascade,
  author_name text not null check (length(author_name) between 1 and 100),
  author_role text not null check (author_role in ('resident', 'official', 'system')),
  body        text not null check (length(body) between 1 and 5000),
  created_at  timestamptz not null default now()
);

comment on table public.ticket_comments is
  'Comments on a ticket. author_role=system entries are auto-generated (e.g. status changes).';

create index if not exists ticket_comments_ticket_idx
  on public.ticket_comments(ticket_id, created_at);

-- -------------------------------------------------------------------------
-- Ticket status history — explicit audit trail
-- -------------------------------------------------------------------------
create table if not exists public.ticket_status_history (
  id              uuid primary key default gen_random_uuid(),
  ticket_id       text not null references public.tickets(id) on delete cascade,
  from_status     text null check (from_status is null or from_status in ('pending', 'in_process', 'hold', 'solved')),
  to_status       text not null check (to_status in ('pending', 'in_process', 'hold', 'solved')),
  changed_by_name text not null check (length(changed_by_name) between 1 and 100),
  changed_by_role text not null check (changed_by_role in ('resident', 'official', 'system')),
  changed_at      timestamptz not null default now()
);

comment on table public.ticket_status_history is
  'One row per status transition. Inserted by trigger on tickets.status update.';

create index if not exists ticket_status_history_ticket_idx
  on public.ticket_status_history(ticket_id, changed_at desc);

-- -------------------------------------------------------------------------
-- Inquiries — ad-hoc resident questions (live chat containers)
-- -------------------------------------------------------------------------
create table if not exists public.inquiries (
  id                  uuid primary key default gen_random_uuid(),
  resident_name       text not null check (length(resident_name) between 1 and 100),
  resident_phone      text not null check (resident_phone ~ '^[0-9]{7,15}$'),
  subject             text not null check (length(subject) between 1 and 200),
  question            text not null check (length(question) between 1 and 2000),
  status              text not null default 'waiting'
                        check (status in ('waiting', 'active', 'resolved')),
  assigned_official_id uuid null references public.officials(id) on delete set null,
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz null,
  resolved_by_name    text null
);

comment on table public.inquiries is
  'Ad-hoc resident questions. waiting → active → resolved.';

create index if not exists inquiries_status_idx     on public.inquiries(status);
create index if not exists inquiries_created_at_idx on public.inquiries(created_at desc);

-- -------------------------------------------------------------------------
-- Inquiry messages — chat messages inside an inquiry
-- -------------------------------------------------------------------------
create table if not exists public.inquiry_messages (
  id           uuid primary key default gen_random_uuid(),
  inquiry_id   uuid not null references public.inquiries(id) on delete cascade,
  sender_name  text not null check (length(sender_name) between 1 and 100),
  sender_role  text not null check (sender_role in ('resident', 'official', 'system')),
  body         text not null check (length(body) between 1 and 5000),
  created_at   timestamptz not null default now()
);

comment on table public.inquiry_messages is
  'Chat messages for an inquiry. sender_role=system entries are auto-generated (e.g. closure).';

create index if not exists inquiry_messages_inquiry_idx
  on public.inquiry_messages(inquiry_id, created_at);

-- -------------------------------------------------------------------------
-- Idempotent rename block (Phase 5b): the kind enum was historically
-- 'complaint' but was renamed to 'report' to reduce adoption friction
-- (residents read "report" as factual, "complaint" as adversarial). The
-- inline CHECK on line 32 was updated; the block below re-applies the
-- constraint against an existing dev/prod database that has the old
-- CHECK in place. Safe to re-run.
--
-- ORDER MATTERS: drop the old CHECK, then UPDATE the rows, then add the
-- new CHECK. Doing the ADD before the UPDATE fails with 23514 because
-- Postgres validates the new constraint against all existing rows
-- immediately.
-- -------------------------------------------------------------------------

alter table public.tickets
  drop constraint if exists tickets_kind_check;

-- Existing rows: map any old 'complaint' values to 'report' so the new
-- CHECK does not reject them on insert. Idempotent — no-op if there are
-- no 'complaint' rows.
update public.tickets
  set kind = 'report'
  where kind = 'complaint';

alter table public.tickets
  add constraint tickets_kind_check
  check (kind in ('request', 'report'));
