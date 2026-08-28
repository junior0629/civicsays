// =========================================================================
// CivicSays — scripts/verify-security-fixes.js
// Verifies the security audit fixes actually landed in the code.
// Run with: node scripts/verify-security-fixes.js
// =========================================================================

const fs = require('fs');
const path = require('path');

let allPass = true;
function check(name, pass, detail) {
  const tag = pass ? 'OK' : 'MISS';
  console.log('  ' + tag + '  ' + name + (detail ? ' — ' + detail : ''));
  if (!pass) allPass = false;
}

console.log('Phase 3 security fix verification\n');

// --- Fix 1: No upsert:true anywhere in the photo upload path ---
{
  const js = fs.readFileSync('js/submit.js', 'utf8');
  check('Fix 1: no upsert:true in submit.js (rename removed entirely)',
        !/upsert:\s*true/.test(js));
}

// --- Fix 2: Path restriction to CIV-______/ or _pending/ ---
{
  const js = fs.readFileSync('js/submit.js', 'utf8');
  // The Storage path should start with id + '/', where id is from generateTrackingId.
  check('Fix 2: photo path starts with generated ID',
        /attachmentPath\s*=\s*id\s*\+\s*'\/'/.test(js));
}

// --- Fix 3: CustomEvent instead of global ---
{
  const js = fs.readFileSync('js/submit.js', 'utf8');
  check('Fix 3: CustomEvent used for success',
        /CustomEvent\(['"]civicsays:ticket-submitted['"]/.test(js));
  check('Fix 3: __CIVICSAYS_LAST_TICKET__ removed',
        !/__CIVICSAYS_LAST_TICKET__/.test(js));
}

// --- Fix 4: Video allowlist ---
{
  const js = fs.readFileSync('js/submit.js', 'utf8');
  check('Fix 4: video allowlist (YouTube, Vimeo)',
        /ALLOWED_VIDEO_HOSTS/.test(js) &&
        /youtube\\\.com/.test(js) &&
        /vimeo\\\.com/.test(js));
}

// --- Fix 5: aria-describedby on inputs ---
{
  const html = fs.readFileSync('submit.html', 'utf8');
  const count = (html.match(/aria-describedby=/g) || []).length;
  check('Fix 5: aria-describedby on all relevant inputs (8 expected)', count >= 8, 'count=' + count);
}

// --- Fix 6: aria-busy on submit button ---
{
  const js = fs.readFileSync('js/submit.js', 'utf8');
  check('Fix 6: aria-busy toggled on submit button',
        /submitBtn\.setAttribute\(['"]aria-busy['"]/.test(js) &&
        /submitBtn\.removeAttribute\(['"]aria-busy['"]/.test(js));
}

// --- Fix 7: CSP on all pages ---
// Note: frame-ancestors is NOT expected — it only works as an HTTP header,
// not via <meta>. GitHub Pages sends X-Frame-Options: DENY, which serves
// the same purpose. We check for the rest of the policy and the jsDelivr
// host (env-loader.js pulls the Supabase SDK from cdn.jsdelivr.net).
{
  const pages = ['submit.html','index.html','admin.html','login.html','track.html','ticket.html','coming-soon.html'];
  for (const p of pages) {
    if (!fs.existsSync(p)) continue;
    const html = fs.readFileSync(p, 'utf8');
    const hasCsp = html.includes('Content-Security-Policy');
    const hasJsdelivr = html.includes('cdn.jsdelivr.net');
    const noFrameAncestors = !html.includes('frame-ancestors');
    check('Fix 7: CSP on ' + p, hasCsp && hasJsdelivr && noFrameAncestors);
  }
}

// --- Fix 8: Dropzone is a <label> ---
{
  const html = fs.readFileSync('submit.html', 'utf8');
  check('Fix 8: dropzone is <label class="dropzone" for="f-photo">',
        /<label class="dropzone"[^>]*for="f-photo"/.test(html));
  check('Fix 8: dropzone is no longer role="button"',
        !/class="dropzone"[^>]*role="button"/.test(html));
}

// --- Fix 9: Filename sanitizer strips leading dots ---
{
  const js = fs.readFileSync('js/submit.js', 'utf8');
  const hasStrip = new RegExp("replace\\(/\\^\\\\\\.\\+/, ''\\)").test(js);
  check('Fix 9: safeFilename strips leading dots', hasStrip);
}

// --- CSP loaded correctly in serve.js? No changes needed; static files only. ---

// --- Migration 0006 exists and is non-trivial ---
{
  const m = 'supabase/migrations/0006_security_hardening.sql';
  if (fs.existsSync(m)) {
    const text = fs.readFileSync(m, 'utf8');
    check('Migration 0006 exists and is non-trivial',
          text.length > 1000 && /tickets_title_check/.test(text) && /tickets_video_link_check/.test(text),
          'length=' + text.length);
  } else {
    check('Migration 0006 exists', false);
  }
}

console.log('\n' + (allPass ? '✓ All security fixes present' : '✗ Some fixes missing — see above'));
process.exit(allPass ? 0 : 1);
