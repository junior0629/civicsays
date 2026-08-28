# CivicSays — Build Checklist

> **Purpose**: This is the project's source of truth for what's done and what's next.
> Whenever work is paused, the next session should open this file, see exactly
> which checkboxes are ticked, and resume from the first unticked item.
>
> **Convention**:
> - `[x]` = done
> - `[ ]` = pending
> - Use this file as a living progress log. Update it at the end of every session
>   (or whenever a meaningful chunk of work lands) so continuity is preserved.
>
> **Plan reference**: `C:\Users\ADMIN\.claude\plans\mighty-bubbling-hollerith.md`
> contains the full architecture & rationale. This file tracks execution.

---

## Phase 0 — Design System Foundation

- [x] `style/tokens.css` — CSS custom properties (colors, glass, borders, accent, text, status, shadows, radii, spacing, typography, motion, layout, z-index)
- [x] `style/base.css` — reset, body, typography, focus rings, scrollbar, reduced-motion, fade-in animation
- [x] `style/components.css` — `.glass-card`, `.btn-*`, `.input`, `.select`, `.textarea`, `.field`, `.badge*`, `.tabs`, `.tab`, `.progress`, `.stat`, `.avatar`, `.divider`, `.toast`, `.modal*`, `.empty-state`, `.skeleton`, `.spinner`, `.fab`, `.chat-bubble`
- [x] `style/layout.css` — `.container`, `.stack`, `.row`, `.grid`, `.page`, `.page-main`, `.navbar`, `.footer`, `.hero`, `.section`, `.feature-card`, `.step`, `.form-grid`, `.ticket-list`, `.comment`, `.detail-grid`, `.admin-layout`, `.inquiry-list`, `.chat-panel`, `.dropzone`, `.auth-page`
- [x] `assets/icons.svg` — line icon sprite (~30 icons: home, ticket, search, send, message, user, shield, clock, check, x, arrow, upload, image, video, map-pin, logout, login, lock, mail, phone, file, alert, info, copy, sparkles, history, inbox, bar-chart, help, eye, refresh, chevron-*)
- [x] `js/icons.js` — `iconHref()`, `icon()`, `injectSprite()` helpers
- [x] `index.html` — placeholder landing (will be enhanced in Phase 2) with full navbar, hero, features, how-it-works, footer
- [x] `js/landing.js` — navbar scroll shadow + icon sprite injection

**Phase 0 demo**: open `index.html` → dark glassmorphism renders, navbar floats, hero/feature/step cards visible.

---

## Phase 1 — Supabase Backend Bootstrap

### 1A. Migrations (SQL files)
- [x] `supabase/migrations/0001_init.sql` — tables: `officials`, `tickets`, `ticket_comments`, `ticket_status_history`, `inquiries`, `inquiry_messages` + indexes + CHECK constraints
- [x] `supabase/migrations/0002_rls.sql` — enable RLS on all tables, policies for anon + authenticated roles + `current_official_id()` helper + `post_resident_comment()` and `post_inquiry_message()` RPC functions
- [x] `supabase/migrations/0003_triggers.sql` — `tickets_update_guard` (immutability) + `on_ticket_status_change` (history + system comment) + `on_ticket_resolved` (stamp `resolved_at`) + `on_inquiry_resolved` (stamp + closing message)
- [x] `supabase/migrations/0004_storage.sql` — Storage bucket `ticket-attachments` (public, 5MB cap, image MIME only) + RLS policies
- [x] `supabase/migrations/0005_seed.sql` — test official upsert by email + Realtime publication for all 5 tables (idempotent `do $$` block)
- [x] `supabase/README.md` — how to apply migrations (via Supabase dashboard SQL editor or `supabase db push`)

### 1B. JS client + config
- [x] `js/env.js` — `getEnv()`, `hasEnv()`, `saveEnv()`, `clearEnv()` + `REQUIRES_ENV` set
- [x] `env-loader.js` — synchronous boot script: reads localStorage, sets `window.__CIVICSAYS_ENV__`, lazy-loads Supabase SDK, redirects to `setup.html?return=...` if a page needs env
- [x] `env.local.example.js` — template for `env.local.js` (gitignored) that pre-populates the app for local development without pasting into DevTools each reload
- [x] `js/supabase.js` — `getClient()` returns singleton; exports `T` table-name constants + `BUCKET_TICKET_ATTACHMENTS`; helpers: `getSession()`, `friendlyError()`, `unwrap()`, `getPublicUrl()`, `uploadAttachment()`
- [x] `js/realtime.js` — `subscribeTicket(id, cb)`, `subscribeTicketComments(id, cb)`, `subscribeInquiries(cb)`, `subscribeInquiry(id, cb)`, `subscribeInquiryMessages(id, cb)` — each returns unsubscribe function
- [x] `js/auth.js` — `signIn(email, password)`, `signOut()`, `getCurrentOfficial()`, `onAuthChange(cb)`, `requireOfficial(returnPath)` redirect guard
- [x] `js/format.js` — `generateTrackingId()`, `isValidTrackingId()`, `formatDate()`, `formatDateShort()`, `formatRelative()`, `ticketStatusLabel()`, `inquiryStatusLabel()`, `statusBadgeClass()`, `formatPhone()`, `formatBytes()`, `ticketKindLabel()`, `escapeHtml()`, `encodeQuery()`, `truncate()`, `youtubeEmbedUrl()`
- [x] `js/ui.js` — `toast(msg, kind)`, `openModal(builder, opts)`, `confirmModal(opts)`, `openLightbox(src, alt)`, `copyToClipboard(text)`, `buttonBusy(btn)`

### 1C. Setup helpers
- [x] `js/setup.js` — first-run UI: validates URL format, validates JWT, probes Supabase REST endpoint, saves to localStorage, redirects to `?return=...` (legacy, no longer reachable now that `js/config.js` is committed)
- [x] `setup.html` — standalone setup page (legacy, no longer reachable)

### 1D. Page integration
- [x] `index.html` — added `<script src="env-loader.js">` to head
- [x] `submit.html` — has `<script src="env-loader.js">` (built in Phase 3)
- [ ] Other HTML pages (track, ticket, login, admin) still need `<script src="env-loader.js">` in head — will be added as each page is built in later phases

**Phase 1 demo**: from browser devtools, `await supabase.from('tickets').select()` returns empty array (RLS allows SELECT). Trying to INSERT without proper role fails. Can sign in as test official.

---

## Phase 2 — Landing Page

- [x] Polish `index.html` — full redesign with realistic ticket preview in hero, "How it works" timeline, trust strip, FAQ accordion, CTA section
- [x] Hero now shows a mock ticket detail card (with timeline + status badge) on the right + floating "Live updates" + "Two-way chat" pills
- [x] Three alternating feature rows (Submit, Track, Live Chat) each with a visual mock — replaces 4-col generic grid
- [x] Trust strip with checkmarks (no account / always free / open)
- [x] 4-cell stats strip below hero (3 min / 100% / 24/7 / $0)
- [x] Timeline section (3 steps with connecting line)
- [x] Testimonial quote section with avatar
- [x] FAQ with 6 questions, accordion behavior
- [x] Final CTA card with ambient glow
- [x] OG + Twitter Card meta tags
- [x] `js/landing.js` — FAQ accordion (close others), IntersectionObserver fade-ins, smooth-scroll for hash links
- [x] Fix alignment: hero now uses proper 1fr/1.05fr grid, mobile stacks cleanly below 1024px
- [x] Created `coming-soon.html` + 5 placeholder copies (`submit.html`, `track.html`, `ticket.html`, `login.html`, `admin.html`) so nav doesn't 404 — each dynamically shows the right "coming up" message based on filename
- [x] Hard-coded Supabase config: `js/config.js` is committed, all 7 HTML pages load it before `env-loader.js`. App works "out of the box" with no DevTools step
- [x] Placeholder pages no longer reveal the Supabase project URL or show "Configure Supabase" CTAs (env is committed, no configuration step needed)
- [x] Placeholder card now vertically centered in the available viewport (no longer hugging the navbar)
- [ ] Mobile responsive deep review (defer to Phase 10 polish)

**Phase 2 demo**: `index.html` is production-grade landing. All nav links work (placeholders show friendly "coming up" pages). Loads fast, no JS errors, fully accessible.

---

## Phase 3 — Submit Ticket (Resident)

- [x] `submit.html` — full form: name, phone, email, kind (request/complaint radio), location, title, description, photo upload (dropzone), video link (URL input)
- [x] `js/submit.js` — client-side validation (required, email format, phone digits-only 7–15, URL format for video) + photo upload + ticket INSERT + PK collision retry + success modal + draft preservation in sessionStorage
- [x] `js/format.js` — `generateTrackingId()` returns `CIV-` + 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; `isValidTrackingId(id)` for reverse validation (consolidated into `format.js`; no separate `ticket-id.js` needed)
- [x] Photo upload → `ticket-attachments` Storage bucket at `_pending/<timestamp>_<name>`, then moved to `<CIV-ID>/<name>` after ticket insert; store `attachment_path` + `attachment_mime`
- [x] Submit → insert row into `tickets` (RLS allows anon INSERT)
- [x] Success modal: show tracking ID, copy-to-clipboard, "Track this ticket" button, "Submit another" button
- [x] Error modal: validation errors (inline on each field) + network errors (toast via `friendlyError()`)
- [x] Loading state on submit button (`buttonBusy()` from `ui.js`)
- [x] Preserve form data in `sessionStorage` so accidental refresh doesn't lose input
- [x] `scripts/verify-phase3.js` — 7/7 integration test: ID format, photo upload, ticket insert, anon read-back, PK collision detection, cleanup, page render

**Phase 3 demo**: `node scripts/verify-phase3.js` → 7/7 green. Open `http://127.0.0.1:8000/submit.html`, fill the form, attach a photo, submit → success modal shows `CIV-XXXXXX` with copy button + "Track this ticket" link → verify in Supabase `tickets` table.

### Phase 3 security hardening (post-audit)

After a security audit applying the lenses from `backend-architect.md`, `frontend-developer.md`, and `security-auditor.md`, the following fixes landed (all 9 frontend + 1 migration, verified by `scripts/verify-security-fixes.js`):

- [x] **Fix 1**: `upsert: true` on the photo rename removed entirely (path now scoped to `<CIV-ID>/<name>` from the start)
- [x] **Fix 2**: Photo Storage path is `<tracking-id>/<timestamp>_<safe-filename>` — never `_pending/`, never an unprefixed path
- [x] **Fix 3**: `window.__CIVICSAYS_LAST_TICKET__` removed; success dispatches `CustomEvent('civicsays:ticket-submitted', { detail })` instead
- [x] **Fix 4**: Video link allowlist (YouTube + Vimeo only) — no more `https://internal-server.local/...` phishing vectors
- [x] **Fix 5**: `aria-describedby` on every input pointing to its hint + error spans; `aria-invalid` toggled by validation
- [x] **Fix 6**: `aria-busy="true"` toggled on the submit button while in flight (for screen readers)
- [x] **Fix 7**: Content-Security-Policy meta tag on all 7 HTML pages — `frame-ancestors 'none'` (anti-clickjacking), restricted `script-src`/`connect-src`/`img-src`
- [x] **Fix 8**: Dropzone is now a real `<label for="f-photo">` instead of a `tabindex="0" role="button"` div — semantic + keyboard-correct
- [x] **Fix 9**: `safeFilename()` strips leading dots — prevents `..png` path traversal
- [x] **Migration `0006_security_hardening.sql`**: server-side enforcement
  - `tickets.attachment_mime` CHECK constraint (image MIME whitelist)
  - `tickets.title` minimum raised to 10 chars
  - `tickets.description` minimum raised to 20 chars
  - `tickets.video_link` CHECK (YouTube/Vimeo only)
  - `tickets INSERT` policy requires `status = 'pending'` (no more pre-solved inserts)
  - Storage upload policy requires path prefix `CIV-______/` or `_pending/`
  - `image/svg+xml` removed from `allowed_mime_types` (XSS via SVG)
- [x] `scripts/verify-security-fixes.js` — 19/19 checks green

---

## Phase 4 — Track + Ticket Detail (Resident)

- [ ] `track.html` — single input for tracking ID, "Track" button → redirects to `ticket.html?id=...`
- [ ] `js/track.js` — ID format validation client-side, redirect on valid format
- [ ] `ticket.html` — three-section layout: info (left), issue (center), comments + history (right)
- [ ] `js/ticket.js`:
  - [ ] Load ticket by ID from URL query
  - [ ] Render info section (ID, kind, status badge, submitted date, contact)
  - [ ] Render issue section (location, title, description, photo, video link)
  - [ ] Load + render comments chronologically
  - [ ] Load + render status history timeline
  - [ ] Resident comment form: name, phone (verify against ticket row), body → INSERT
  - [ ] 404 state if ticket not found
  - [ ] Realtime subscription: when status changes or new comment posted, refresh affected section without full reload
- [ ] Empty state: "No comments yet" for tickets with zero comments
- [ ] Photo: thumbnail in issue section, click to open full-size in lightbox modal
- [ ] Video link: show as a card with thumbnail (if YouTube) + "Open video" link

**Phase 4 demo**: take a Phase 3 ID, enter on track page, see full detail. Post a resident comment. Refresh — comment persists. Change status from admin (Phase 7 prep) — see live update.

---

## Phase 5 — Official Authentication

- [ ] `login.html` — email + password form, centered glass card, "Forgot password" link (placeholder), "Don't have an account? Contact admin" hint
- [ ] `js/login.js` — `signIn()`, on success redirect to `admin.html`; on error show inline error
- [ ] `js/auth.js` enhancements:
  - [ ] `requireOfficial()` — call at top of `admin.html` scripts, redirect to `login.html` if not authed
  - [ ] `onAuthChange()` — update navbar login/logout state across all pages
- [ ] Navbar — shows "Log in" when anon, "Log out" + official name badge when authed
- [ ] Session persistence: Supabase handles via localStorage automatically
- [ ] Logout: clear session, redirect to `index.html`
- [ ] Update `index.html`, `submit.html`, `track.html`, `ticket.html` to include auth-aware navbar (or a shared `js/navbar.js` that injects)

**Phase 5 demo**: log in with seeded test official → navbar shows name → click "Admin" → loads `admin.html`. Hit `admin.html` while logged out → redirects to login. Logout → navbar reverts.

---

## Phase 6 — Admin Dashboard Shell

- [ ] `admin.html` — two-panel layout (inquiries left 340px, tickets right fluid)
- [ ] `js/admin.js`:
  - [ ] Fetch + render stats grid: Total, Pending, In Process, On Hold, Solved
  - [ ] Fetch + render ticket list (sorted by `created_at DESC`, paginated 50 at a time)
  - [ ] Status filter tabs (All / Pending / In Process / On Hold / Solved) with counts
  - [ ] Free-text search (ID, resident name, email, title) with debounce
  - [ ] Click ticket → navigate to `ticket.html?id=...`
  - [ ] Inquiries panel: 3 counters (Waiting / Active / Resolved)
  - [ ] Inquiries list (scrollable, most recent first)
  - [ ] Empty states for both panels
  - [ ] Loading skeletons on first load
- [ ] Realtime subscription: new inquiries appear in panel instantly
- [ ] Inquiries panel: click an inquiry opens chat overlay (skeleton, real impl in Phase 9)

**Phase 6 demo**: log in, see stats reflecting Phase 3 ticket (e.g. 1 pending). Filter by status works. Search works. New inquiry from resident (Phase 8) appears without refresh.

---

## Phase 7 — Ticket Management (Official)

- [ ] On `ticket.html`, when official is authed:
  - [ ] Status selector dropdown + "Update Status" button in info section
  - [ ] On status change: UPDATE `tickets.status` → trigger fires → history row + system comment auto-created
  - [ ] Optimistic UI update (assume success, rollback on error)
- [ ] Official comment form: pre-filled name from session, "Government Official" badge on posted comments
- [ ] Status history timeline visible (from `ticket_status_history` table)
- [ ] Disable status control if ticket is `solved` (or allow re-open with explicit confirmation)
- [ ] Show "Last updated" timestamp
- [ ] Visual indication when ticket was updated by which official (in history)

**Phase 7 demo**: open ticket as official, change status to `in_process` → history row appears → system comment appears in thread. Back to resident browser → refresh → see updated status.

---

## Phase 8 — Resident Live Chat (Inquiry)

- [ ] Floating "Ask a Question" button (`.fab`) on `submit.html`, `track.html`, `ticket.html` (hidden on `admin.html` and `login.html`)
- [ ] Click → multi-step modal:
  - [ ] Step 1: name + phone
  - [ ] Step 2: subject + question
  - [ ] Step 3: "Waiting for an official…" with cancel button
- [ ] On submit: INSERT into `inquiries` (status `waiting`)
- [ ] Realtime subscription on the inquiry row: when status → `active`, transition to chat view
- [ ] Chat view: message list + composer, send button
- [ ] Realtime subscription on `inquiry_messages` for this inquiry
- [ ] When status → `resolved`, show "This conversation has been closed" message
- [ ] Persist current inquiry ID in `localStorage` so page reload resumes the chat
- [ ] Different visual treatment between resident + official messages (`.chat-bubble.incoming` vs `.outgoing`)

**Phase 8 demo**: from one browser, resident asks question → waiting screen. From second browser (official logged in), see inquiry in panel, accept → resident's browser transitions to chat live. Exchange messages.

---

## Phase 9 — Official Live Chat

- [ ] On `admin.html` inquiry panel: clicking an inquiry opens a chat overlay (floating window, bottom-right)
- [ ] Chat overlay shows inquiry details (resident name, phone, subject)
- [ ] For `waiting` inquiries: "Accept" button → UPDATE status to `active` (also assigns `assigned_official_id`)
- [ ] For `active` inquiries: message list + composer, send button
- [ ] Realtime subscription for messages + status changes
- [ ] "Resolve" button → UPDATE status to `resolved`, post a system message ("This conversation was closed by [official name]"), close overlay
- [ ] Inquiries panel item: highlight when `active` and assigned to current official
- [ ] Show typing indicator (optional, nice-to-have — skip if time-constrained)

**Phase 9 demo**: integrate with Phase 8. Full round-trip: resident asks → official accepts → both exchange messages → official resolves → resident sees closure message.

---

## Phase 10 — Polish & Edge Cases

### Empty states
- [ ] Admin: "No tickets yet" when DB is empty
- [ ] Admin: "No inquiries waiting" when none in queue
- [ ] Ticket detail: "No comments yet" when empty thread
- [ ] Track page: "No ticket found" + back-to-home CTA when ID invalid
- [ ] Search: "No results match 'foo'" when filter empty

### Error states
- [ ] Network failure toast on every Supabase call (try/catch wrapper in `js/supabase.js`)
- [ ] Invalid login: inline error, no leak of "user exists vs password wrong"
- [ ] Expired session: auto-redirect to login with toast "Session expired"
- [ ] Permission denied (RLS block): friendly error, not raw Postgres error

### Loading states
- [ ] Skeleton cards for ticket list, inquiry list, comments
- [ ] Spinner on all submit buttons during async work
- [ ] Disabled state on buttons while in-flight

### Responsive design
- [ ] Test on 360px, 768px, 1024px, 1440px viewports
- [ ] Hero stacks vertically below 960px
- [ ] Admin panels stack below 1100px
- [ ] Detail grid stacks below 1100px
- [ ] Navbar links hide below 640px, brand + primary CTA remain
- [ ] Form grid stacks below 640px

### Accessibility (WCAG 2.2 AA)
- [ ] All interactive elements have `:focus-visible` rings (already in base.css — verify everywhere)
- [ ] All touch targets ≥ 24×24px (verify with browser devtools)
- [ ] All images have `alt` text (or `alt=""` if decorative)
- [ ] All form inputs have associated `<label>` or `aria-label`
- [ ] All buttons have accessible names
- [ ] Modals trap focus + restore on close
- [ ] Color contrast: verify accent orange on dark bg meets 4.5:1 for text
- [ ] Skip-to-content link (already in HTML)
- [ ] Semantic HTML: `<nav>`, `<main>`, `<header>`, `<footer>`, `<article>`, `<section>` used correctly
- [ ] Keyboard nav: tab through entire app, no traps, no skip-overs

### Performance
- [ ] Image lazy-loading on ticket attachments
- [ ] Realtime channels: unsubscribe on page unload
- [ ] Initial paint: no flash of unstyled content (FOUC)
- [ ] Lighthouse run: Performance ≥ 90, Accessibility ≥ 90, Best Practices ≥ 90, SEO ≥ 80

**Phase 10 demo**: Lighthouse score ≥ 90 on all pages. Empty/error/loading states verified manually. Mobile responsive verified in DevTools.

---

## Phase 11 — Deployment

- [ ] `.nojekyll` file (empty, prevents GitHub Pages from running Jekyll)
- [ ] `.github/workflows/deploy.yml` — on push to `main`, deploy to GitHub Pages
- [ ] `README.md` — rewrite to focus on:
  - [ ] What CivicSays is (1 paragraph)
  - [ ] Free-tier cost principle
  - [ ] Quick start: clone, configure Supabase, deploy
  - [ ] Architecture diagram
  - [ ] How to set up Supabase (link to `supabase/README.md`)
  - [ ] Environment variables
  - [ ] Deployment to GitHub Pages
  - [ ] Contributing
  - [ ] License
- [ ] `LICENSE` — MIT (or whichever the user wants)
- [ ] `supabase/README.md` — step-by-step migration application guide
- [ ] Final smoke test: deploy to staging → run all 18 verification steps from the plan
- [ ] Verify `https://<user>.github.io/<repo>/` loads `index.html` correctly

**Phase 11 demo**: live URL works, full feature flow works end-to-end on production.

---

## Cross-cutting: Pre-Phase-1 tasks

These were scattered as I built; consolidating here so they don't get lost:

- [x] Plan written to `C:\Users\ADMIN\.claude\plans\mighty-bubbling-hollerith.md`
- [x] Three agents loaded: `frontend-developer`, `backend-architect`, `security-auditor`
- [x] README features parsed: 17 resident + 16 official + 4 ticket statuses + 3 inquiry statuses
- [x] Stack decided: plain HTML/CSS/JS + Supabase + GitHub Pages
- [x] Project structure laid out (`style/`, `js/`, `assets/`, `supabase/`)
- [x] Design system complete (Phase 0)

---

## Status Legend (update as you go)

| Phase | Status | Last updated |
|---|---|---|
| 0 — Design System | ✅ Complete | Initial build |
| 1 — Supabase Bootstrap | ✅ Complete | Phase 1 done |
| 2 — Landing Page | ✅ Complete | Redesigned + placeholders |
| 1.5 — Manual Supabase Setup | ✅ Complete | 7/7 verify.js checks green; bucket + officials row + Realtime + RPC all live |
| 3 — Submit Ticket | ✅ Complete | 7/7 verify-phase3.js checks green; submit.html + submit.js live |
| 4 — Track + Detail | 🔲 Not started | — |
| 5 — Official Auth | 🔲 Not started | — |
| 6 — Admin Shell | 🔲 Not started | — |
| 7 — Ticket Mgmt | 🔲 Not started | — |
| 8 — Resident Chat | 🔲 Not started | — |
| 9 — Official Chat | 🔲 Not started | — |
| 10 — Polish | 🔲 Not started | — |
| 11 — Deploy | 🔲 Not started | — |

**When resuming**: open this file, find the first `[ ]` checkbox in the current phase, and start there. The plan file has the *why*, this file has the *what*. Together they're everything needed to continue.

---

## Manual Supabase Setup (one-time, ~2 min)

Before any user-facing flow (Phase 3+) works end-to-end, two SQL migrations must be applied manually in the Supabase SQL editor (the anon key can't run DDL). See [MANUAL_SETUP.md](MANUAL_SETUP.md) for the step-by-step.

- [x] Apply `supabase/migrations/0004_storage.sql` in <https://supabase.com/dashboard/project/hkzaxdcoopscuvvbithx/sql/new> — creates the `ticket-attachments` bucket + RLS policies
- [x] Apply `supabase/migrations/0005_seed.sql` — seeds the `public.officials` row for the test user + enables Realtime on the 5 tables
- [x] Run `node scripts/verify.js` from the project root — 7/7 green checkmarks confirmed
- [ ] Connect the app by either:
  - (a) Opening `index.html`, then pasting the one-liner from [MANUAL_SETUP.md §5](MANUAL_SETUP.md) into DevTools console, OR
  - (b) Copying `env.local.example.js` → `env.local.js`, filling in the values, and including `<script src="env.local.js"></script>` before `env-loader.js` in each HTML page
