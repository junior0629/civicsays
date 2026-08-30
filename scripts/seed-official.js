// =========================================================================
// scripts/seed-official.js
// Phase 5a: bootstrap a staff account.
//
// Two modes:
//   1. If SUPABASE_SERVICE_ROLE_KEY is set in env, fully automated:
//      creates the auth.users row + officials row, prints the credentials.
//   2. Otherwise (no service role), prints a ready-to-paste SQL block
//      tailored with the chosen email + password, and instructions for
//      running it in Supabase Studio's SQL editor.
//
// Usage:
//   $ node scripts/seed-official.js
//   $ node scripts/seed-official.js --email me@city.gov --password "MyP@ssw0rd!"
//   $ node scripts/seed-official.js --email me@city.gov --gen-password
//   (env: STAFF_EMAIL, STAFF_PASSWORD also accepted)
//
// Idempotent: re-running the script is safe. In service-role mode it
// checks for an existing user/official first.
// =========================================================================

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ----- Args -----
function parseArgs(argv) {
  var out = { email: null, password: null, genPassword: false, fullName: null };
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--email' && argv[i + 1]) { out.email = argv[++i]; }
    else if (a === '--password' && argv[i + 1]) { out.password = argv[++i]; }
    else if (a === '--full-name' && argv[i + 1]) { out.fullName = argv[++i]; }
    else if (a === '--gen-password') { out.genPassword = true; }
    else if (a === '-h' || a === '--help') { out.help = true; }
  }
  return out;
}

function showHelp() {
  console.log('Usage: node scripts/seed-official.js [options]\n');
  console.log('Options:');
  console.log('  --email <addr>       Email for the staff account (default: staff@civicsays.local)');
  console.log('  --password <pwd>     Password (default: random 16 chars; printed once)');
  console.log('  --gen-password       Force a random password even if --password is set');
  console.log('  --full-name <name>   Display name (default: "Staff Member")');
  console.log('  -h, --help           Show this help');
  console.log('');
  console.log('Env:');
  console.log('  STAFF_EMAIL, STAFF_PASSWORD, STAFF_FULL_NAME also accepted.');
  console.log('');
  console.log('Service role:');
  console.log('  If SUPABASE_SERVICE_ROLE_KEY is set, the script runs in');
  console.log('  automated mode. Otherwise, it prints SQL to paste into');
  console.log('  Supabase Studio.');
}

// ----- Defaults -----
function randomPassword(len) {
  // URL-safe, no ambiguous chars (0/O/1/l/I).
  var alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  var bytes = crypto.randomBytes(len);
  var out = '';
  for (var i = 0; i < len; i++) out += alpha[bytes[i] % alpha.length];
  return out;
}

function resolveConfig(args) {
  var cfg = {
    email: args.email || process.env.STAFF_EMAIL || 'staff@civicsays.local',
    password: args.password || process.env.STAFF_PASSWORD || null,
    fullName: args.fullName || process.env.STAFF_FULL_NAME || 'Staff Member',
  };
  if (args.genPassword || !cfg.password) {
    cfg.password = randomPassword(16);
    cfg._generatedPassword = true;
  }
  return cfg;
}

// ----- Supabase config (anon + optional service role) -----
const CONFIG_PATH = path.join(__dirname, '..', 'js', 'config.js');
const envCode = fs.readFileSync(CONFIG_PATH, 'utf8');
const env = (() => {
  const sandbox = {};
  const fn = new Function('window', envCode + '; return window.__CIVICSAYS_ENV__;');
  return fn(sandbox);
})();

if (!env || !env.supabaseUrl) {
  console.error('Could not read Supabase URL from js/config.js');
  process.exit(1);
}

const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || null;
const HAS_SERVICE_ROLE = !!SERVICE_ROLE;

// ----- bcrypt (only needed for SQL mode) -----
function bcryptHash(pw) {
  // Use whichever bcrypt lib is available. We don't add a dep — try
  // common paths, otherwise fall back to a precomputed hash + warning.
  try {
    return require('@node-rs/bcrypt').hashSync(pw, 10);
  } catch (e) {}
  try {
    return require('bcrypt').hashSync(pw, 10);
  } catch (e2) {}
  return null;
}

// ----- SQL template -----
function buildSql(cfg, hash) {
  // Escape single quotes by doubling them (SQL standard).
  var escEmail = cfg.email.replace(/'/g, "''");
  var escName  = cfg.fullName.replace(/'/g, "''");
  return [
    '-- Paste this into Supabase Studio → SQL editor → New query → Run',
    '',
    '-- 1. auth.users row',
    "insert into auth.users (",
    "  instance_id, id, aud, role, email,",
    "  encrypted_password, email_confirmed_at,",
    "  recovery_sent_at, last_sign_in_at,",
    "  raw_app_meta_data, raw_user_meta_data,",
    "  created_at, updated_at, confirmation_token,",
    "  email_change, email_change_token_new, recovery_token",
    ")",
    "select",
    "  '00000000-0000-0000-0000-000000000000',",
    "  gen_random_uuid(),",
    "  'authenticated',",
    "  'authenticated',",
    "  '" + escEmail + "',",
    "  '" + hash + "',",
    "  now(),",
    "  null, null,",
    "  '{\"provider\":\"email\",\"providers\":[\"email\"]}'::jsonb,",
    "  '{}'::jsonb,",
    "  now(), now(), '',",
    "  '', '', ''",
    "where not exists (",
    "  select 1 from auth.users where email = '" + escEmail + "'",
    ");",
    '',
    '-- 2. public.officials row',
    'insert into public.officials (id, email, full_name, is_active)',
    "select u.id, u.email, '" + escName + "', true",
    'from auth.users u',
    "where u.email = '" + escEmail + "'",
    '  and not exists (',
    '    select 1 from public.officials o where o.id = u.id',
    '  );',
    '',
    '-- 3. Sanity check',
    'select',
    '  u.email              as auth_email,',
    '  u.email_confirmed_at is not null as email_confirmed,',
    '  o.full_name,',
    '  o.is_active',
    'from auth.users u',
    'left join public.officials o on o.id = u.id',
    "where u.email = '" + escEmail + "';",
  ].join('\n');
}

// ----- Service-role mode -----
async function seedViaServiceRole(cfg) {
  var supabase = require('@supabase/supabase-js');
  var admin = supabase.createClient(env.supabaseUrl, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Check if user already exists.
  var existing = await admin.auth.admin.listUsers();
  if (existing.error) {
    console.error('Could not list users (service role):', existing.error.message);
    process.exit(1);
  }
  var found = existing.data.users.find(function (u) { return u.email === cfg.email; });

  var userId;
  if (found) {
    userId = found.id;
    console.log('• auth user already exists for ' + cfg.email + ' (id=' + userId + ')');
  } else {
    var created = await admin.auth.admin.createUser({
      email: cfg.email,
      password: cfg.password,
      email_confirm: true,
    });
    if (created.error) {
      console.error('Could not create auth user:', created.error.message);
      process.exit(1);
    }
    userId = created.data.user.id;
    console.log('• Created auth user (id=' + userId + ')');
  }

  // Upsert officials row.
  var up = await admin.from('officials').upsert({
    id: userId,
    email: cfg.email,
    full_name: cfg.fullName,
    is_active: true,
  }, { onConflict: 'id' });
  if (up.error) {
    console.error('Could not upsert officials row:', up.error.message);
    process.exit(1);
  }
  console.log('• Upserted public.officials row (is_active=true)');
}

// ----- SQL-print mode -----
function printSqlMode(cfg) {
  var hash = bcryptHash(cfg.password);
  if (!hash) {
    console.error('');
    console.error('ERROR: Cannot run in SQL mode without a bcrypt library.');
    console.error('Install one of these in the project:');
    console.error('  npm install @node-rs/bcrypt   (faster, no node-gyp)');
    console.error('  npm install bcrypt            (classic)');
    console.error('');
    console.error('Or set SUPABASE_SERVICE_ROLE_KEY in your env and re-run.');
    process.exit(1);
  }
  console.log('');
  console.log('============================================================');
  console.log(' Supabase service role key not set — falling back to SQL mode');
  console.log('============================================================');
  console.log('');
  console.log('Staff account to create:');
  console.log('  email     = ' + cfg.email);
  console.log('  full name = ' + cfg.fullName);
  if (cfg._generatedPassword) {
    console.log('  password  = ' + cfg.password + '   (generated — save it now)');
  } else {
    console.log('  password  = (you provided — not echoed)');
  }
  console.log('');
  console.log('To create the account:');
  console.log('  1. Open Supabase Studio → SQL editor → New query.');
  console.log('  2. Paste the SQL below.');
  console.log('  3. Run. Expect: "Success. No rows returned" + 1 sanity row.');
  console.log('  4. Sign in at /login.html with the credentials above.');
  console.log('');
  console.log('------------------------------------------------------------');
  console.log(buildSql(cfg, hash));
  console.log('------------------------------------------------------------');
  console.log('');
  console.log('For fully-automated seeding in the future, set:');
  console.log('  SUPABASE_SERVICE_ROLE_KEY=…  node scripts/seed-official.js');
  console.log('');
}

// ----- Entry -----
(async function main() {
  var args = parseArgs(process.argv);
  if (args.help) { showHelp(); return; }
  var cfg = resolveConfig(args);

  if (HAS_SERVICE_ROLE) {
    await seedViaServiceRole(cfg);
    console.log('');
    console.log('✅ Official "' + cfg.email + '" is active.');
    if (cfg._generatedPassword) {
      console.log('   Password (save now, will not be shown again):');
      console.log('     ' + cfg.password);
    }
    console.log('   Sign in at /login.html.');
  } else {
    printSqlMode(cfg);
  }
})().catch(function (e) {
  console.error('seed-official.js failed:', e && e.message || e);
  process.exit(1);
});
