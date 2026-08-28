-- =========================================================================
-- CivicSays — 0004_storage.sql
-- Storage bucket: ticket-attachments
-- Public read, anon upload (with image MIME + 5MB cap enforced via policy).
-- =========================================================================

-- Create the bucket if missing. Public = anyone with the URL can read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ticket-attachments',
  'ticket-attachments',
  true,
  5242880,  -- 5 MiB
  array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public           = excluded.public,
  file_size_limit  = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- -------------------------------------------------------------------------
-- Policies on storage.objects for the ticket-attachments bucket
-- -------------------------------------------------------------------------

-- Drop any prior versions to keep idempotent.
drop policy if exists "ticket attachments public read"  on storage.objects;
drop policy if exists "ticket attachments anon upload"  on storage.objects;
drop policy if exists "ticket attachments official delete" on storage.objects;

-- Public read (bucket is public anyway, but explicit for clarity).
create policy "ticket attachments public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'ticket-attachments');

-- Anon upload allowed (residents submit photos without accounts).
-- Size + MIME enforcement is in the bucket config above; this policy just
-- gates access.
create policy "ticket attachments anon upload"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'ticket-attachments');

-- Officials may delete (e.g. removal of inappropriate content during triage).
create policy "ticket attachments official delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'ticket-attachments'
    and public.current_official_id() is not null
  );
