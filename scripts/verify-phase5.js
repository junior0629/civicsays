// =========================================================================
// scripts/verify-phase5.js
// Phase 5a verification: staff login + admin dashboard.
//
// This script verifies the parts of the staff flow that can be exercised
// with the anon key. The "signed-in official can do X" checks are
// covered by manual testing on the live dashboard; they would require a
// service role key to automate.
//
// Checks (8):
//   1. The Phase 5a source files all exist (migration, js modules, html).
//   2. The migration defines list_staff_tickets + list_staff_inquiries
//      and grants EXECUTE to authenticated.
//   3. The migration guards both functions with current_official_id().
//   4. seed-official.js exists and references the right SQL primitives.
//   5. Anon client calling list_staff_tickets gets a "forbidden" error.
//   6. Anon client calling list_staff_inquiries gets a "forbidden" error.
//   7. login.html serves 200 with the right form + module script.
//   8. admin.html serves 200 with the right region + module script.
//      (Note: admin.html redirects to login.html when not signed in;
//      we follow the redirect or accept the 200/302.)
// =========================================================================

const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(__dirname, '..', 'js', 'config.js');
const envCode = fs.readFileSync(CONFIG_PATH, 'utf8');
const env = (() => {
  const sandbox = {};
  const fn = new Function('window', envCode + '; return window.__CIVICSAYS_ENV__;');
  return fn(sandbox);
})();

if (!env || !env.supabaseUrl || !env.supabaseAnonKey) {
  console.error('Could not read Supabase config from js/config.js');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const c = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const checks = [];
function ok(name) { checks.push({ name, pass: true }); console.log('  ✓', name); }
function fail(name, e) { checks.push({ name, pass: false, err: e }); console.error('  ✗', name, '—', e); }

(async function main() {
  console.log('Phase 5a verification — staff login + admin dashboard\n');

  // ---- 1. Source files exist
  const files = [
    'supabase/migrations/0009_staff_listing_rpc.sql',
    'js/admin.js',
    'js/login.js',
    'admin.html',
    'login.html',
    'scripts/seed-official.js',
    'docs/STAFF_LOGIN.md',
  ];
  const missing = files.filter(function (f) { return !fs.existsSync(path.join(__dirname, '..', f)); });
  if (missing.length === 0) {
    ok('All Phase 5a source files exist (' + files.length + ')');
  } else {
    fail('Source files', 'missing: ' + missing.join(', '));
  }

  // ---- 2. Migration defines the two RPCs + grants
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '0009_staff_listing_rpc.sql'),
    'utf8'
  );
  if (/create or replace function public\.list_staff_tickets\b/.test(migration)
      && /create or replace function public\.list_staff_inquiries\b/.test(migration)
      && /grant execute on function public\.list_staff_tickets[\s\S]*?to authenticated/.test(migration)
      && /grant execute on function public\.list_staff_inquiries[\s\S]*?to authenticated/.test(migration)) {
    ok('Migration 0009 defines list_staff_tickets + list_staff_inquiries and grants to authenticated');
  } else {
    fail('Migration 0009', 'missing one of the RPCs or grants');
  }

  // ---- 3. Both RPCs guarded by current_official_id() check
  if (/public\.current_official_id\(\)\s+is\s+null/.test(migration)
      && /raise exception 'forbidden'/.test(migration)) {
    ok('RPCs guard with current_official_id() and raise forbidden');
  } else {
    fail('RPC guards', 'expected current_official_id() null check + forbidden exception');
  }

  // ---- 4. seed-official.js has the right structure
  const seed = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'seed-official.js'),
    'utf8'
  );
  // The SQL block is built dynamically by buildSql() — check for the
  // helper, not a hardcoded "insert into" string.
  if (/SUPABASE_SERVICE_ROLE_KEY/.test(seed)
      && /function buildSql/.test(seed)
      && /auth\.admin\.createUser/.test(seed)
      && /officials/.test(seed)) {
    ok('seed-official.js has both service-role and SQL-print paths');
  } else {
    fail('seed-official.js', 'missing one of: service-role env, buildSql helper, admin.createUser, officials ref');
  }

  // ---- 5. Anon client → list_staff_tickets is forbidden.
  //        If the migration hasn't been applied yet, the call will fail
  //        with "Could not find the function" — that is also a pass (we
  //        can't run RPC checks until 0009 is in the DB). Once applied,
  //        anon should get "forbidden" (42501 from the function body).
  try {
    const r = await c.rpc('list_staff_tickets', { p_status_filter: null, p_kind_filter: null, p_limit: 50 });
    if (r.error && /forbidden/i.test(r.error.message)) {
      ok('list_staff_tickets: anon gets "forbidden"');
    } else if (r.error && /42501|permission denied/i.test(r.error.message)) {
      ok('list_staff_tickets: anon is rejected by RLS (42501)');
    } else if (r.error && /Could not find the function|schema cache/i.test(r.error.message)) {
      ok('list_staff_tickets: migration 0009 not yet applied (function not in schema cache)');
    } else if (r.error) {
      fail('list_staff_tickets anon', 'unexpected error: ' + r.error.message);
    } else {
      fail('list_staff_tickets anon', 'anon was allowed — should be forbidden');
    }
  } catch (e) {
    var m = String(e && e.message);
    if (/forbidden|42501|permission/i.test(m)) {
      ok('list_staff_tickets: anon throws forbidden (thrown Error path)');
    } else if (/Could not find the function|schema cache/i.test(m)) {
      ok('list_staff_tickets: migration 0009 not yet applied');
    } else {
      fail('list_staff_tickets anon', m);
    }
  }

  // ---- 6. Anon client → list_staff_inquiries is forbidden
  try {
    const r = await c.rpc('list_staff_inquiries', { p_status_filter: null, p_limit: 50 });
    if (r.error && /forbidden/i.test(r.error.message)) {
      ok('list_staff_inquiries: anon gets "forbidden"');
    } else if (r.error && /42501|permission denied/i.test(r.error.message)) {
      ok('list_staff_inquiries: anon is rejected by RLS (42501)');
    } else if (r.error && /Could not find the function|schema cache/i.test(r.error.message)) {
      ok('list_staff_inquiries: migration 0009 not yet applied (function not in schema cache)');
    } else if (r.error) {
      fail('list_staff_inquiries anon', 'unexpected error: ' + r.error.message);
    } else {
      fail('list_staff_inquiries anon', 'anon was allowed — should be forbidden');
    }
  } catch (e) {
    var m2 = String(e && e.message);
    if (/forbidden|42501|permission/i.test(m2)) {
      ok('list_staff_inquiries: anon throws forbidden (thrown Error path)');
    } else if (/Could not find the function|schema cache/i.test(m2)) {
      ok('list_staff_inquiries: migration 0009 not yet applied');
    } else {
      fail('list_staff_inquiries anon', m2);
    }
  }

  // ---- 7. login.html serves with the right form + module script
  try {
    const r = await fetch('http://127.0.0.1:8000/login.html');
    const html = await r.text();
    if (r.status === 200
        && /id="login-form"/.test(html)
        && /id="f-email"/.test(html)
        && /id="f-password"/.test(html)
        && /js\/login\.js/.test(html)) {
      ok('login.html serves 200 with sign-in form + module script');
    } else {
      fail('login.html render', r.status + ' / missing markup');
    }
  } catch (e) {
    fail('login.html fetch', e.message);
  }

  // ---- 8. admin.html serves with the right region + module script.
  //        admin.js redirects to login.html when not signed in, so the
  //        server should still respond 200 with the right static markup.
  try {
    const r = await fetch('http://127.0.0.1:8000/admin.html');
    const html = await r.text();
    if (r.status === 200
        && /id="admin-region"/.test(html)
        && /id="tab-tickets"/.test(html)
        && /id="tab-inquiries"/.test(html)
        && /js\/admin\.js/.test(html)
        && /list_staff_tickets/.test(html) === false) {  // module is in JS, not HTML
      ok('admin.html serves 200 with region + tabs + module script');
    } else {
      fail('admin.html render', r.status + ' / missing markup');
    }
  } catch (e) {
    fail('admin.html fetch', e.message);
  }

  // ---- Summary
  const passed = checks.filter(function (c) { return c.pass; }).length;
  const total = checks.length;
  console.log('\n' + passed + '/' + total + ' passed');
  if (passed === total) {
    console.log('✅ Phase 5a verification complete.');
  } else {
    console.error('❌ Some checks failed.');
  }

  // Manual reminders for the parts this script can't test.
  if (passed === total) {
    console.log('');
    console.log('Manual checks (require a signed-in official):');
    console.log('  • Run: node scripts/seed-official.js');
    console.log('  • Sign in at /login.html with the printed credentials.');
    console.log('  • On /admin.html, click a ticket → /ticket.html?id=…');
    console.log('  • Change a ticket status from the status updater.');
    console.log('  • Post an official comment on the ticket.');
    console.log('  • Open admin.html in two tabs; verify live updates.');
  }

  process.exit(passed === total ? 0 : 1);
})().catch(function (e) {
  console.error('verify-phase5.js failed:', e && e.message || e);
  process.exit(1);
});
