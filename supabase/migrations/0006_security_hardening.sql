-- =========================================================================
-- CivicSays — 0006_security_hardening.sql
-- Backend hardening based on Phase 3 security audit (C-1 through C-3, M-4).
-- Idempotent: safe to re-run.
-- =========================================================================

-- -------------------------------------------------------------------------
-- C-1: Restrict anon INSERT on tickets to status='pending'.
-- Prevents an attacker from pre-marking tickets as 'solved' or 'in_process'
-- via direct anon INSERT (the update trigger only blocked UPDATEs).
-- -------------------------------------------------------------------------
drop policy if exists "tickets insert public" on public.tickets;
create policy "tickets insert public"
  on public.tickets for insert
  to anon, authenticated
  with check (status = 'pending');

-- -------------------------------------------------------------------------
-- C-3: attachment_mime must be a known image type or NULL.
-- The client sends this value from File.type, which is untrusted.
-- -------------------------------------------------------------------------
alter table public.tickets
  drop constraint if exists tickets_attachment_mime_check;
alter table public.tickets
  add constraint tickets_attachment_mime_check
  check (attachment_mime is null
         or attachment_mime in ('image/png','image/jpeg','image/gif','image/webp'));

-- -------------------------------------------------------------------------
-- Minimum lengths on title and description.
-- The 0001_init.sql allowed length(title) >= 3 and length(description) >= 1,
-- which let in junk like "aaa" or ".". Bump to meaningful minimums.
-- -------------------------------------------------------------------------
alter table public.tickets
  drop constraint if exists tickets_title_check;
alter table public.tickets
  add constraint tickets_title_check
  check (length(title) between 10 and 200);

alter table public.tickets
  drop constraint if exists tickets_description_check;
alter table public.tickets
  add constraint tickets_description_check
  check (length(description) between 20 and 5000);

-- -------------------------------------------------------------------------
-- M-4: video_link must be from YouTube or Vimeo.
-- Prevents phishing links to internal hosts or random URLs being shown
-- to officials in the ticket detail view.
-- -------------------------------------------------------------------------
alter table public.tickets
  drop constraint if exists tickets_video_link_check;
alter table public.tickets
  add constraint tickets_video_link_check
  check (
    video_link is null
    or video_link ~* '^https?://(www\.)?(youtube\.com|youtu\.be|vimeo\.com)/'
  );

-- -------------------------------------------------------------------------
-- C-2: Restrict Storage upload path to CIV-XXXXXX/... or _pending/...
-- Anon can only upload under one of these two prefixes. Prevents:
--   - filling the bucket with junk at top-level paths
--   - uploading to another user's ticket by guessing the path
-- -------------------------------------------------------------------------
drop policy if exists "ticket attachments anon upload" on storage.objects;
create policy "ticket attachments anon upload"
  on storage.objects for insert
  to anon, authenticated
  with check (
    bucket_id = 'ticket-attachments'
    and (name ~ '^CIV-[A-HJ-NP-Z2-9]{6}/' or name ~ '^_pending/')
  );

-- -------------------------------------------------------------------------
-- Restrict mime type on Storage uploads (defense-in-depth).
-- The bucket's allowed_mime_types is enforced by Supabase, but this is a
-- belt-and-suspenders check at the policy layer.
-- -------------------------------------------------------------------------
-- (Skipped: storage.objects doesn't expose a useful mime column in the
-- WITH CHECK expression; the bucket-level allowed_mime_types is the
-- canonical gate. Re-apply in 0004_storage.sql if you need a stricter rule.)

-- -------------------------------------------------------------------------
-- Remove SVG from allowed_mime_types (was XSS-able if served as image).
-- (Already not in the JS allowlist, but harden at the bucket level too.)
-- -------------------------------------------------------------------------
update storage.buckets
   set allowed_mime_types = array['image/png','image/jpeg','image/jpg','image/webp','image/gif']
 where id = 'ticket-attachments'
   and 'image/svg+xml' = any(allowed_mime_types);

-- -------------------------------------------------------------------------
-- Verify: report ticket count, inquiry count, and current policies.
-- (Useful for sanity-checking after the migration runs.)
-- -------------------------------------------------------------------------
do $$
declare
  v_tickets int;
  v_inquiries int;
begin
  select count(*) into v_tickets from public.tickets;
  select count(*) into v_inquiries from public.inquiries;
  raise notice 'Security hardening applied. Existing rows: tickets=%, inquiries=%', v_tickets, v_inquiries;
  raise notice 'NOTE: if any existing tickets have title < 10 chars or description < 20 chars, they will still be readable but new INSERTs will be rejected.';
end $$;
