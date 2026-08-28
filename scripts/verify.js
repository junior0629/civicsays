// Verify all CivicSays infrastructure is in place after manual migration.
// Usage: node scripts/verify.js
import https from 'node:https';
import { URL as NodeURL } from 'node:url';

const URL = 'https://hkzaxdcoopscuvvbithx.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhremF4ZGNvb3BzY3V2dmJpdGh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4NDI4MDgsImV4cCI6MjEwMzQxODgwOH0.LcsOD_IrR3PWfFIquTTXewWlPgFfi_6RYaxbw6-I1DI';

function req(method, path, body, contentType) {
  return new Promise((resolve, reject) => {
    const u = new NodeURL(URL + path);
    const r = https.request({
      method, hostname: u.hostname, path: u.pathname + u.search,
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': contentType || 'application/json' },
    }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', reject);
    if (body) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  const icon = ok ? '✓' : '✗';
  const color = ok ? '\x1b[32m' : '\x1b[31m';
  console.log(`  ${color}${icon}\x1b[0m ${label}${detail ? ' — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

console.log('\n\x1b[1mCivicSays — Setup verification\x1b[0m\n');

// 1. Storage bucket
// Note: GET /storage/v1/bucket requires the service_role key. With the anon
// key we instead probe by attempting a tiny PNG upload with a unique path
// each run (the same call the app will make), which is what we actually
// care about. 200/201 = success, 400 with "Duplicate" = bucket exists
// (we just left a probe file from a prior run — anon can't delete).
const probeName = '_verify_probe_' + Date.now() + '.png';
const probeUpload = await req(
  'POST',
  '/storage/v1/object/ticket-attachments/' + probeName,
  // 1x1 transparent PNG, base64-decoded
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'),
  'image/png'
);
const bucketOk = probeUpload.status === 200 || probeUpload.status === 201;
check(
  'Storage bucket "ticket-attachments" exists and accepts image uploads',
  bucketOk,
  bucketOk ? `(HTTP ${probeUpload.status})` : `(HTTP ${probeUpload.status} — ${probeUpload.body.slice(0, 120)})`
);

// 2. Test official user
const login = await req('POST', '/auth/v1/token?grant_type=password', {
  email: 'official@civicsays.local',
  password: 'ChangeMe123!',
});
const loginOk = login.status === 200;
check('Test official auth user exists and password works', loginOk,
  loginOk ? '(HTTP 200)' : `(HTTP ${login.status})`);

if (loginOk) {
  const token = JSON.parse(login.body).access_token;
  const userId = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()).sub;

  // 3. Test official row in public.officials.
  // NOTE: RLS on public.officials is "officials read own" using (id = auth.uid()).
  // So we must use the authed access token here, not the anon key.
  const officialsRes = await new Promise((resolve, reject) => {
    const u = new NodeURL(URL + `/rest/v1/officials?id=eq.${userId}&select=*`);
    const r = https.request({
      method: 'GET', hostname: u.hostname, path: u.pathname + u.search,
      headers: { apikey: KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    }, (res) => {
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', reject); r.end();
  });
  let rows = [];
  try { rows = JSON.parse(officialsRes.body); } catch {}
  check(
    'public.officials row exists for the test user',
    rows.length === 1 && rows[0].email === 'official@civicsays.local',
    rows.length === 1 ? `(${rows[0].full_name}, active=${rows[0].is_active})` : `(found ${rows.length} row(s))`
  );
}

// 4. Anon can submit a ticket (use unique ID per run so re-runs don't collide)
const verifyId = 'CIV-V' + Date.now().toString(36).toUpperCase().slice(-5);
const ticket = await req('POST', '/rest/v1/tickets', {
  id: verifyId,
  resident_name: 'Verifier',
  resident_phone: '5550000000',
  resident_email: 'verify@test.com',
  kind: 'request',
  location: 'Test',
  title: 'Verify setup',
  description: 'Auto-inserted by scripts/verify.js',
  status: 'pending',
});
check('Anon can insert into tickets (RLS allows)', ticket.status === 201, `(HTTP ${ticket.status})`);

// 5. Cleanup (best-effort: anon DELETE is blocked by RLS, which is the
//    expected secure behavior. Either 204 (rare) or 401/403 are both fine.)
if (ticket.status === 201) {
  const del = await req('DELETE', `/rest/v1/tickets?id=eq.${verifyId}`);
  check('Test row cleanup (anon DELETE blocked is correct)', del.status === 204 || del.status === 401 || del.status === 403, `(HTTP ${del.status})`);
}

// 6. RPC exists
const rpc = await req('POST', '/rest/v1/rpc/post_resident_comment', {
  p_ticket_id: 'CIV-DOESNTEXIST',
  p_resident_name: 'Test',
  p_resident_phone: '5550000000',
  p_body: 'hi',
});
const rpcBody = JSON.parse(rpc.body);
check(
  'RPC post_resident_comment exists and runs',
  rpc.status === 500 && rpcBody.code === 'P0002',
  `(returns "${rpcBody.message}" for missing ticket — correct)`
);

// 7. Existing test ticket from earlier probe
const existing = await req('GET', '/rest/v1/tickets?id=eq.CIV-TEST01&select=id');
let existingRows = [];
try { existingRows = JSON.parse(existing.body); } catch {}
if (existingRows.length === 1) {
  const del = await req('DELETE', '/rest/v1/tickets?id=eq.CIV-TEST01');
  check('Cleaned up stale CIV-TEST01 from earlier probes', del.status === 204, '');
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail === 0) {
  console.log('\n\x1b[32m✓ CivicSays is fully configured and ready to use.\x1b[0m\n');
  console.log('Next steps:');
  console.log('  1. Open index.html in your browser');
  console.log('  2. Open DevTools (F12) → Console');
  console.log('  3. Paste the env-config one-liner (see MANUAL_SETUP.md)');
  console.log('  4. Try submitting a ticket at submit.html');
} else {
  console.log('\n\x1b[31m✗ Some checks failed. See MANUAL_SETUP.md for troubleshooting.\x1b[0m\n');
}
process.exit(fail === 0 ? 0 : 1);
