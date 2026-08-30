-- 0008_ticket_address.sql
-- Adds a `resident_address` column to `tickets` to capture the resident's
-- home address separately from the issue's location. The existing
-- `location` column continues to mean the location of the issue itself
-- (e.g. "Pothole on Main St & 3rd Ave"). The new column is the resident's
-- mailing/home address — useful for follow-ups that need to reach the
-- resident at their home (courtesy notices, paper responses, etc.).

alter table public.tickets
  add column if not exists resident_address text null
    check (resident_address is null or length(resident_address) <= 300);

-- No NOT NULL constraint: the column is optional. A resident may not
-- want to share their home address, and the form lets them skip it.
-- We still cap length to match `location` and to keep storage bounded.

-- No RLS change needed: existing ticket policies already cover all
-- columns on `tickets` (the column is treated like any other text
-- column — readable by anyone via the public tracking page, writable
-- only via the SECURITY DEFINER RPCs used by the submit flow).
