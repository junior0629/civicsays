# Supabase Setup Guide

This directory contains all SQL migrations for CivicSays. Apply them in order
against a fresh Supabase project.

## 1. Create a Supabase project (free tier)

1. Sign up at <https://supabase.com> (free, no credit card).
2. Create a new project. Pick the region closest to your municipality.
3. Save the **Project URL** and **anon public key** — you'll need them for the
   CivicSays app config. Find them under *Project Settings → API*.

## 2. Apply migrations in order

For each file in `migrations/` (in alphabetical order), open the
**SQL Editor** in the Supabase dashboard, paste the contents, and click **Run**.

| # | File | Purpose |
|---|---|---|
| 1 | `0001_init.sql` | Tables, indexes, CHECK constraints |
| 2 | `0002_rls.sql` | Row-level security + helper functions + RPCs |
| 3 | `0003_triggers.sql` | Status-change triggers + immutability guards |
| 4 | `0004_storage.sql` | `ticket-attachments` Storage bucket + policies |
| 5 | `0005_seed.sql` | Test official + Realtime publication |

> **Tip:** if you use the Supabase CLI, you can run all five at once with
> `supabase db push` from this directory after linking the project.

## 3. Create the test official user

`0005_seed.sql` only inserts the `public.officials` row — it does **not** create
the underlying `auth.users` row. You need to do that first:

1. In the Supabase dashboard, go to **Authentication → Users → Add user → Create new user**.
2. Use these credentials (or your own — but remember them for the app's login form):
   - Email: `official@civicsays.local`
   - Password: `ChangeMe123!`
   - Auto Confirm User: **yes**
3. Then run `0005_seed.sql`. It will pick up the new user and insert the
   matching `public.officials` row.

To create more officials, repeat: create the user, then insert a row into
`public.officials` with the same `id`.

> **Production note**: change the test password immediately. The seed account
> is a convenience for development only.

## 4. Verify

After applying all migrations, run these in the SQL editor to sanity-check:

```sql
-- Tables exist
select table_name from information_schema.tables
  where table_schema = 'public' order by table_name;

-- Should return:
--   inquiries, inquiry_messages, officials,
--   ticket_comments, ticket_status_history, tickets

-- RLS enabled
select tablename, rowsecurity from pg_tables
  where schemaname = 'public';

-- Realtime publication includes the right tables
select schemaname, tablename from pg_publication_tables
  where pubname = 'supabase_realtime';
```

## 5. CORS / Network

The free tier allows connections from any origin, so the CivicSays frontend on
GitHub Pages can hit the Supabase API directly with no extra config.

## Troubleshooting

- **"permission denied for table tickets"** — RLS is on but the policy is
  missing. Re-run `0002_rls.sql`.
- **Realtime not firing** — check that `0005_seed.sql` ran the publication
  block. You can re-run it; the `do $$` block is idempotent.
- **Storage upload fails** — confirm the bucket exists under *Storage →
  ticket-attachments* and that its `allowed_mime_types` includes the file's
  MIME type. Re-run `0004_storage.sql` to reset.
