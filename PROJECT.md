# CivicSays

A transparent civic engagement platform that connects residents with their local government.

> **Project state:** building in public. Phases 0–2.5 (design system, backend, landing, polish) are complete. The Submit Ticket flow is next — see [CHECKLIST.md](CHECKLIST.md) for the full task list.

## What residents can do

- Submit a request or complaint and receive a unique tracking ID (`CIV-XXXXXX`)
- Track the progress of their submission in real time
- Post comments and additions to their existing ticket
- Ask an official a question via live chat (waiting → active → resolved)

## What officials can do

- Sign in to a private dashboard
- See a queue of all tickets, filter by status, search by ID/name/email/title
- Update ticket status (pending → in process → on hold → solved) with full history
- Accept resident inquiries and chat with them in real time
- Resolve inquiries and post closing messages

## Stack

- **Frontend**: plain HTML + CSS + vanilla ES modules. No build step. Hosted on GitHub Pages.
- **Backend**: Supabase free tier — Postgres, Auth, Storage, Realtime.
- **Cost**: $0 to build, $0 to run. Free tier is enough for a municipal deployment.

## Local development

```bash
node scripts/serve.js 8000
# open http://127.0.0.1:8000/
```

The dev server is a zero-dependency static file server in `scripts/serve.js`.

## Setup (one-time)

See [MANUAL_SETUP.md](MANUAL_SETUP.md) for the steps to apply the two remaining SQL migrations to your Supabase project, and [scripts/verify.js](scripts/verify.js) to confirm everything is wired:

```bash
node scripts/verify.js
# expect: 7 passed, 0 failed
```

## Project layout

```
civicsays/
├── index.html                # landing page
├── submit.html               # resident: submit a ticket (Phase 3 ✓)
├── track.html                # resident: lookup by ID
├── ticket.html               # resident + official: ticket detail
├── login.html                # official: auth
├── admin.html                # official: dashboard
├── coming-soon.html          # shared template for placeholder pages
├── setup.html                # first-run env prompt (legacy, env is now committed)
│
├── style/                    # CSS — tokens, base, components, layout
├── js/                       # vanilla ES modules
│   ├── config.js             # hard-coded Supabase project (committed)
│   ├── env.js                # env reader
│   ├── supabase.js           # singleton client + helpers
│   ├── auth.js               # sign in/out, guards
│   ├── realtime.js           # channel subscriptions
│   ├── format.js             # tracking ID, dates, status labels
│   ├── ui.js                 # toast, modal, confirm
│   ├── icons.js              # sprite injector
│   ├── setup.js              # legacy first-run flow (no longer reachable)
│   ├── submit.js             # Phase 3 — ticket form: validation, photo upload, insert, success modal
│   ├── landing.js            # landing page enhancements
│   └── env-loader.js         # boot script (loaded by every page)
│
├── env-loader.js             # synchronous boot — sets window.__CIVICSAYS_ENV__
│
├── assets/
│   ├── Logo.png              # brand logo
│   ├── logonobg.png          # logo without background
│   └── icons.svg             # line icon sprite (~30 icons)
│
├── supabase/
│   ├── README.md             # how to apply migrations
│   └── migrations/
│       ├── 0001_init.sql     # schema (6 tables, indexes, CHECK constraints)
│       ├── 0002_rls.sql      # row-level security + RPCs
│       ├── 0003_triggers.sql # status history + system comments
│       ├── 0004_storage.sql  # ticket-attachments bucket
│       └── 0005_seed.sql     # test official + Realtime publication
│
├── scripts/
│   ├── serve.js              # local dev server
│   └── verify.js             # post-setup verification
│
├── CHECKLIST.md              # the source of truth for "what's next"
├── MANUAL_SETUP.md           # one-time Supabase setup guide
├── README.md                 # the original project spec (intact)
└── PROJECT.md                # this file
```

## Security

- The anon key in [js/config.js](js/config.js) is **public by design** — it ships to every browser that loads the app. Real security lives in RLS policies ([supabase/migrations/0002_rls.sql](supabase/migrations/0002_rls.sql)).
- For a different Supabase project, edit the two values in [js/config.js](js/config.js).
- For a per-browser override, paste `localStorage.setItem('civicsays.env', JSON.stringify({...}))` into DevTools.

## License

MIT (or whichever you decide — TBD).
