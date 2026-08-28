# CivicSays — Manual Setup (one-time)

> **Time required:** ~2 minutes
> **What it does:** Creates the Storage bucket for photo attachments, seeds the
> test official account row, and enables Realtime on the database tables.

---

## Step 1 — Open the SQL Editor

Go to: <https://supabase.com/dashboard/project/hkzaxdcoopscuvvbithx/sql/new>

You'll see a big text area. You're going to paste two SQL blocks and run each one.

---

## Step 2 — Run the storage migration

Open this file in your editor: [supabase/migrations/0004_storage.sql](supabase/migrations/0004_storage.sql)

Copy the **entire contents** and paste into the SQL Editor.

Click **Run** (or press Ctrl+Enter).

**Expected result:** A green "Success. No rows returned" message. (The bucket creation is a side effect, not a returned row.)

If you get an error like "bucket already exists" or "policy already exists", that's fine — the script is idempotent.

---

## Step 3 — Run the seed migration

Open this file: [supabase/migrations/0005_seed.sql](supabase/migrations/0005_seed.sql)

Copy the **entire contents** and paste into the SQL Editor (replace the previous content).

Click **Run**.

**Expected result:** A green "Success. No rows returned" message. The script:
- Inserts/updates a row in `public.officials` matching the user `official@civicsays.local`
- Adds the 5 main tables to the `supabase_realtime` publication

---

## Step 4 — Verify

Open a terminal in the project root and run:

```bash
node scripts/verify.js
```

You should see all green checkmarks:
- ✓ Storage bucket `ticket-attachments` exists
- ✓ Test official row exists
- ✓ Anon can submit a ticket
- ✓ Realtime is enabled on all 5 tables

If anything is red, see the Troubleshooting section below.

---

## Step 5 — Connect the app

Open `index.html` in your browser (just double-click the file).

Open DevTools (F12) → Console tab. Paste this one-liner and press Enter:

```javascript
localStorage.setItem('civicsays.env', JSON.stringify({
  supabaseUrl: 'https://hkzaxdcoopscuvvbithx.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhremF4ZGNvb3BzY3V2dmJpdGh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4NDI4MDgsImV4cCI6MjEwMzQxODgwOH0.LcsOD_IrR3PWfFIquTTXewWlPgFfi_6RYaxbw6-I1DI'
})); location.reload();
```

The page reloads. Now `submit.html` should work end-to-end.

---

## Troubleshooting

### "policy already exists" on the storage migration
That's fine — re-runs are safe.

### "duplicate key value violates unique constraint" on seed
The official row already exists. Re-running the script just updates the name. Safe.

### Anon INSERT returns 401
The RLS migration (0002) may not have been applied. Re-run it from
[supabase/migrations/0002_rls.sql](supabase/migrations/0002_rls.sql).

### Bucket not appearing in Storage UI
Wait ~5 seconds — Supabase Storage is eventually consistent. Refresh the page.

### Test official can't log in
Make sure you created the user via
<https://supabase.com/dashboard/project/hkzaxdcoopscuvvbithx/auth/users> first.
The seed only inserts the `public.officials` row, not the auth user.

---

## Security reminder

🔒 The anon key you shared is now in chat history. For a real deployment, rotate it
in *Project Settings → API → Generate new anon key* after the app goes live. RLS
limits what this key can do (read public data, insert tickets as anon) — but the
key itself is considered public and should be rotated if exposed.
