# Staff login — quick reference

CivicSays has a **staff / official** side for the city hall team. Staff
sign in at `/login.html` and land on `/admin.html`, a dashboard that lists
every ticket and inquiry. Staff can change ticket status and post official
replies directly on the ticket page.

This document explains how to create the first staff account.

---

## 1. Create the account

Run the seed script from the project root:

```sh
$ node scripts/seed-official.js
```

The script has two modes:

| If `SUPABASE_SERVICE_ROLE_KEY` is set in your env… | …the script runs **fully automated**: creates the auth user + officials row, prints the email + password once. |
| Otherwise | …the script **prints a SQL block** tailored with the email + password you chose, and tells you to paste it into Supabase Studio → SQL editor → New query → Run. |

Pick your email + password (or let the script generate a random one):

```sh
# Custom credentials
$ node scripts/seed-official.js --email me@city.gov --password "MyP@ssw0rd!"

# Random password (printed once, never again)
$ node scripts/seed-official.js --email me@city.gov --gen-password

# Defaults: staff@civicsays.local / random password / "Staff Member"
$ node scripts/seed-official.js
```

The script is **idempotent** — re-running it does not create a duplicate
account or fail.

### To enable fully-automated mode

1. Open the Supabase dashboard for this project
   (`https://hkzaxdcoopscuvvbithx.supabase.co`).
2. Go to **Settings → API → service_role** and copy the secret.
3. Add it to your shell env (do **not** commit it):
   ```sh
   export SUPABASE_SERVICE_ROLE_KEY='eyJ…'
   ```
4. Re-run `node scripts/seed-official.js`. The script will use the
   service role to create the user directly and print the credentials.

---

## 2. Sign in

1. Open `/login.html` in a browser.
2. Enter the email + password from step 1.
3. You land on `/admin.html` (the dashboard).

If you're already signed in, `/login.html` automatically redirects to
`/admin.html`.

---

## 3. What staff can do

On **`/admin.html`** (the dashboard):

- See all tickets in a list, filter by status (Pending, In Process,
  On Hold, Solved) and type (Request, Complaint).
- See all inquiries in a separate tab, filter by status.
- Click a ticket row → opens `/ticket.html?id=…` for that ticket.
- Live updates: a new ticket or status change anywhere shows up in the
  list within ~1 second.

On **`/ticket.html?id=…`** while signed in:

- A **status updater** appears at the top — pick a status and click
  Update.
- A **comment form** appears with no name/phone fields (your identity is
  derived from the signed-in session). Posted comments show an
  "Official" badge and an orange left-border accent.
- Sign out from the navbar (`Signed in as {name} · Sign out`).

---

## 4. Add more officials

Re-run the seed script with a different email:

```sh
$ node scripts/seed-official.js --email other-official@city.gov --gen-password
```

Each official has their own login.

---

## 5. Deactivate an official

The `public.officials` table has an `is_active` boolean. To deactivate:

```sql
update public.officials set is_active = false where email = 'old-official@city.gov';
```

The official's auth.users row stays (so their email is reserved), but
they'll see "This account has been deactivated" if they try to sign in.
Flip `is_active = true` to restore access.

To **permanently delete** an official, remove both rows:

```sql
delete from public.officials where email = 'old-official@city.gov';
delete from auth.users where email = 'old-official@city.gov';
```

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Account is not registered as an official." | The `officials` row is missing. | Re-run the seed script. |
| "This account has been deactivated." | `is_active = false`. | `update public.officials set is_active = true where email = …` |
| Sign-in succeeds but dashboard is empty | No tickets in the database. | Submit a test ticket from `/submit.html`. |
| "Email not confirmed" error | The auth user's `email_confirmed_at` is null. | `update auth.users set email_confirmed_at = now() where email = …` (the seed script sets this automatically). |
| "Invalid email or password." | Wrong credentials, or no auth.users row. | Re-run the seed script. |

For anything else, see `js/auth.js` and `supabase/migrations/0002_rls.sql`
for the underlying RLS rules.
