# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

CivicSays is a two-sided civic engagement platform: **residents** submit tickets and chat with city hall via the public site (`index.html`, `submit.html`, `ticket.html`, `track.html`); **staff/officials** manage tickets and inquiries via the dashboard (`login.html` → `admin.html`, with detail at `ticket.html?id=…`). Backed entirely by Supabase (Postgres + Auth + Storage + Realtime) — no custom server.

The product goal, resident flow, official flow, and status vocabularies are documented in `README.md`. The staff-onboarding doc is `docs/STAFF_LOGIN.md` (covers the seed script and account lifecycle).

## Common commands

```sh
# Dev server (port 8000 by default). The committed script is dependency-free.
node scripts/serve.js            # or: node scripts/serve.js 8080

# Unit tests
npm test                         # one-shot
npm run test:watch               # watch mode
npx vitest run tests/buildTicketRow.test.js   # one file

# Syntax-check an ES module
node --input-type=module --check < js/admin.js

# Create the first staff account (idempotent)
node scripts/seed-official.js
node scripts/seed-official.js --email me@city.gov --gen-password
```

There is no build step, linter, or formatter. CSS + vanilla ES modules ship as-is.

## Architecture at a glance

### Page → script → data

| Page | Entry script | Auth gate | Talks to Supabase via |
|---|---|---|---|
| `index.html` | `js/landing.js` | none | read-only RPCs |
| `submit.html` | `js/submit.js` | none | insert + storage |
| `track.html` | `js/track.js` | none | read by tracking ID |
| `ticket.html` | `js/ticket.js` | optional (staff) | read + insert comment + status change |
| `login.html` | `js/login.js` | public (sign-in) | auth + `officials` |
| `admin.html` | `js/admin.js` | staff required | staff RPCs + realtime |

### Supabase env resolution

`js/config.js` is a **classic** (non-module) `<script>` that sets `window.__CIVICSAYS_ENV__` with the committed anon key. The anon key is public-by-design — real security is in RLS (`supabase/migrations/0002_rls.sql`). For a different project, run `setup.html` (writes to `localStorage["civicsays.env"]`, takes precedence).

`env-loader.js` runs after `config.js`: resolves env (localStorage → window → setup redirect), then lazy-loads the Supabase UMD bundle from `cdn.jsdelivr.net` so the SDK is only fetched when env is configured.

`js/supabase.js` exports a singleton `getClient()` plus a frozen `T` map of table names — **always import `T` instead of hard-coding table strings**.

### RPC layer (the data contract)

All staff-side reads and most writes go through SECURITY DEFINER RPCs in `supabase/migrations/0009_*.sql` through `0014_*.sql`. The RPCs gate on `current_official_id()` and raise `42501` (forbidden) for non-staff. The JS side translates that into a friendly error in `friendlyErrorForStaff()` in `js/admin.js` — when you add a new RPC that the staff dashboard depends on, update that function so a stale Supabase cache produces an actionable message instead of a raw error.

For a fresh Supabase project, apply migrations `0001` → `0014` in order, then run `0005_seed.sql` *after* creating the auth user. The `dev/` directory contains one-paste Studio scripts (e.g. `0009_apply_0014_pagination.sql`) that re-apply a single migration to a project already on an older baseline. **Supabase Studio wraps multi-statement scripts in a transaction — one failed `RAISE` rolls back the whole batch, so the dev scripts omit a trailing `SELECT` for verification (it would 42501 under the service role).**

### Test surface

`tests/setup.js` stubs `window.__CIVICSAYS_ENV__` so jsdom can import `js/admin.js` without throwing. Vitest is configured in `vitest.config.js` (jsdom env, only `tests/**/*.test.js`). Tests target the **pure helpers** in `js/admin.js` (and a few other files) — `buildTicketRow`, `buildTicketCard`, `buildKpiCards`, `buildActivityRow`, `buildTrendSvg`, `formatTrendLabel`, `buildTrendAriaLabel`, `donutSegments`, `resolveDatePreset`, `signInErrorMessage`, `readReturnPath`, `activateTab`. New pure functions should be added in this same style (exported, no DOM, no `getClient()` calls) so they can be unit-tested in isolation.

### Styling

`style/tokens.css` is the single source of truth for design tokens (colors, spacing, radii, typography, motion). All component CSS reads from these custom properties — do not hard-code hex values in component files. Three-column admin layout tokens live at the bottom of `tokens.css` (sidebar/right-rail widths, admin header height). `style/admin.css` has a `/* Dashboard fit — 1080p */` block scoped to `@media (min-width: 1200px)` that controls the desktop layout for fitting 1920×1080 without scrolling.

## Conventions worth preserving

- **No build / no framework.** Plain ES modules (`<script type="module">`) + classic scripts for the env boot. Don't introduce a bundler or framework without an explicit decision.
- **No commits without explicit "push it".** The user manages the push cadence — stage + commit when asked, but never `git push` without the literal phrase.
- **Pure helpers stay pure.** The render code in `js/admin.js` is split into `buildXxx(data) → DOM nodes` (pure, exported, testable) and `renderXxx()` (impure, looks up `document.getElementById`, mutates state). When adding a new section, mirror this split so it can be unit-tested.
- **Friendly errors are the contract.** `friendlyErrorForStaff()` in `js/admin.js` is the only place that maps raw Supabase errors to user-readable text. New RPCs need entries there; new error shapes (e.g. "PGRST116 no rows") should be added in the same place.
- **CSS uses tokens, not literals.** New component CSS reads `var(--space-3)` etc. — no inline `#FF8A2A`, no magic 16px.
- **The committed Supabase project is real.** `js/config.js` points at `hkzaxdcoopscuvvbithx.supabase.co`. Don't paste other credentials into it; use `setup.html` or `localStorage` for overrides.

## Routing — agents and skills first, then plan, then code

Every non-trivial request should be routed through an installed agent or skill **before** planning or editing. Match the request shape to the right entry point below and invoke it as the very first action. If multiple apply, run them in this order: design critique → design system → implementation. Do not skip this even when the request looks small.

### Agents (`.claude/agents/`)

| Request shape | Agent | When to invoke |
|---|---|---|
| Visual / dashboard / screenshot / layout / accessibility critique | **`ui-ux-designer`** | Screenshot attached, "looks weird / static / ugly / empty", new widget, font/color/spacing decision, anything "is this good?" |
| New SQL migration, RPC, RLS, or Supabase schema design | **`backend-architect`** | New staff RPC, new table, new index, RLS policy, query performance question |
| Full-stack or framework-shaped frontend work (React/Vue/Angular) | **`frontend-developer`** | Only if the user asks for a non-vanilla rebuild — this project is vanilla ES modules, so usually skip |
| Security review, secrets, RLS, auth, exposure of staff endpoints | **`security-auditor`** | Before commit to a sensitive area, or when RLS/anon-key/storage policy is in play |

The `ui-ux-designer` agent is the one most often relevant. The user's memory `ui-ux-designer-agent.md` records its checklist (NN Group research, anti-generic-SaaS, CivicSays aesthetic north star). Read that memory before invoking the agent so the prompt can reference it.

### Skills (`.claude/skills/`)

| Request shape | Skill | When to invoke |
|---|---|---|
| "Build a new page / component / poster / dashboard / artifact" | **`/frontend-design`** | Distinctive production-grade UI work. Invokes via the `Skill` tool when the user types the slash command or the prompt matches its description (triggers on: websites, landing pages, dashboards, React/HTML/CSS layouts, styling/beautifying any web UI) |
| "Review / fix / improve / enhance UI, design system, colors, typography" | **`/ui-ux-pro-max`** | Pulls from a 50-style / 97-palette / 99-UX-rule database. Start with `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<keywords>" --design-system -p "<project>"` to get a complete design system, then drill in with `--domain <style\|color\|typography\|ux\|chart\|landing>` for specifics |

### Routing rules of thumb

1. **Screenshot + complaint** → `ui-ux-designer` agent first (it has CivicSays context from memory). Don't just patch the CSS.
2. **"Make it look like X"** with a reference image → `ui-ux-pro-max` skill (`--design-system` to pick a style, then implement).
3. **"Build a new thing from scratch"** → `frontend-design` skill (creative, distinctive, anti-AI-slop output).
4. **New RPC or table** → `backend-architect` agent to design, then implement and mirror the migration in `supabase/dev/`.
5. **Pure visual tweak** (one selector, one number) → no agent needed; just edit. The rule is for *non-trivial* requests.
6. **Always** end with `npx vitest run` and `node --input-type=module --check < js/admin.js` before committing.
7. **Never** `git push` without the literal phrase "push it" from the user.

## Key entry points for new work

- Staff dashboard: `js/admin.js` (one big file — the side panel, KPI row, trend chart, table, pagination, inquiries rail, activity feed are all here)
- Public ticket detail: `js/ticket.js` (the status changer + comment form for staff live here)
- New staff RPC: add a `supabase/migrations/00NN_*.sql`, mirror it in `supabase/dev/` as a one-paste Studio script, then call it from `js/admin.js` and surface a friendly error in `friendlyErrorForStaff`
- New dashboard widget: add a `<section>` in `admin.html`, a `buildXxx()` + `renderXxx()` pair in `js/admin.js`, styles in `style/admin.css` using tokens, plus a vitest spec for the pure helper
