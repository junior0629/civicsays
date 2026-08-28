// =========================================================================
// CivicSays — scripts/verify-phase3.js
// Phase 3 integration test: generate ID, upload photo, insert ticket,
// verify in DB. Mirrors what submit.js does, then cleans up.
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

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateTrackingId() {
  let out = 'CIV-';
  for (let i = 0; i < 6; i++) {
    out += ID_ALPHABET.charAt(Math.floor(Math.random() * ID_ALPHABET.length));
  }
  return out;
}

const checks = [];
function ok(name) { checks.push({ name, pass: true }); console.log('  ✓', name); }
function fail(name, e) { checks.push({ name, pass: false, err: e }); console.error('  ✗', name, '—', e); }

async function req(method, path, body, contentType) {
  const headers = { apikey: env.supabaseAnonKey, Authorization: 'Bearer ' + env.supabaseAnonKey };
  if (contentType) headers['Content-Type'] = contentType;
  const res = await fetch(env.supabaseUrl + path, { method, headers, body });
  const text = await res.text();
  return { status: res.status, body: text };
}

(async function main() {
  console.log('Phase 3 verification — submit flow\n');

  // ---- 1. Generate ID
  const id = generateTrackingId();
  if (/^CIV-[A-HJ-NP-Z2-9]{6}$/.test(id)) ok('Tracking ID has valid format: ' + id);
  else fail('Tracking ID format', id);

  // ---- 2. Upload photo to ticket-attachments bucket
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
  );
  const photoPath = 'CIV-VERIFY/' + Date.now() + '.png';
  let r = await req(
    'POST',
    '/storage/v1/object/ticket-attachments/' + photoPath,
    tinyPng,
    'image/png'
  );
  if (r.status === 200 || r.status === 201) ok('Photo uploaded to bucket (' + r.status + ')');
  else fail('Photo upload', r.status + ' ' + r.body);

  // ---- 3. Insert ticket row (anon INSERT, RLS allows)
  const row = {
    id,
    resident_name: 'Phase 3 Verify',
    resident_phone: '5550000001',
    resident_email: 'phase3-verify@example.com',
    kind: 'request',
    location: '123 Civic Test Lane',
    title: 'Phase 3 verification ticket',
    description: 'This is a programmatic ticket created by verify-phase3.js to confirm the submit flow works end-to-end.',
    attachment_path: photoPath,
    attachment_mime: 'image/png',
    video_link: null,
    status: 'pending',
  };
  const ins = await c.from('tickets').insert(row).select('id, status, created_at').single();
  if (ins.error) fail('Ticket INSERT', ins.error.message);
  else if (ins.data && ins.data.id === id) ok('Ticket row created (id=' + ins.data.id + ', status=' + ins.data.status + ')');
  else fail('Ticket INSERT', 'unexpected response: ' + JSON.stringify(ins));

  // ---- 4. Read it back as anon
  const sel = await c.from('tickets').select('id, status, resident_name').eq('id', id).single();
  if (sel.error) fail('Ticket SELECT', sel.error.message);
  else if (sel.data && sel.data.id === id) ok('Ticket readable as anon');
  else fail('Ticket SELECT', 'unexpected: ' + JSON.stringify(sel));

  // ---- 5. PK collision: try to insert the same ID again → should fail with 23505
  const dup = await c.from('tickets').insert(row);
  if (dup.error && /duplicate key|23505/i.test(dup.error.message)) {
    ok('PK collision detected (this is what retry loop catches)');
  } else if (dup.error) {
    fail('PK collision', 'unexpected error: ' + dup.error.message);
  } else {
    fail('PK collision', 'duplicate insert succeeded — UNIQUE constraint missing!');
  }

  // ---- 6. Cleanup: delete ticket + storage object
  const del = await c.from('tickets').delete().eq('id', id);
  if (del.error) console.warn('  ! cleanup ticket:', del.error.message);
  else ok('Test ticket cleaned up');

  // Storage delete requires auth, may fail as anon — that's fine.
  const del2 = await req('DELETE', '/storage/v1/object/ticket-attachments/' + photoPath);
  if (del2.status >= 200 && del2.status < 300) ok('Test photo cleaned up');
  else console.warn('  ! cleanup photo: ' + del2.status + ' (anon cannot delete from public bucket; harmless)');

  // ---- 7. Server-render check
  const r3 = await fetch('http://127.0.0.1:8000/submit.html');
  const html = await r3.text();
  if (r3.status === 200 && /js\/submit\.js/.test(html) && /id="ticket-form"/.test(html)) {
    ok('submit.html served with form + module script');
  } else {
    fail('submit.html render', r3.status + ' — missing markup');
  }

  // ---- Summary
  console.log('\n' + (checks.filter(c => c.pass).length) + '/' + checks.length + ' passed');
  process.exit(checks.every(c => c.pass) ? 0 : 1);
})().catch(function (e) {
  console.error('Fatal:', e);
  process.exit(1);
});
