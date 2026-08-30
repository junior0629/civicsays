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

// --- Fix 4: Video allowlist (6 hosts) ---
// In js/submit.js each host is part of a regex literal like
//   /^https?:\/\/(www\.)?youtube\.com\//i
// To verify the host appears, we look for "<host>" + a literal backslash
// + a literal dot + the TLD. The source bytes are 6-backslashes-in-source
// long: 4 in the RegExp string (2 for the literal backslash, 1 for the
// escape of the dot, 1 for the dot itself).
{
  const js = fs.readFileSync('js/submit.js', 'utf8');
  // Pattern shape: <host>\\\.com
  // In source:   <host>\\\\\\.com  (6 backslashes before .com in the
  //                                 RegExp constructor argument)
  const patterns = [
    'youtube\\\\\\.com',
    'youtu\\\\\\.be',
    'vimeo\\\\\\.com',
    'tiktok\\\\\\.com',
    'drive\\\\\\.google\\\\\\.com',
    'facebook\\\\\\.com',
    'fb\\\\\\.watch',
    'twitter\\)\\\\\\.com', // (x|twitter) — the closing paren is between host and \.com
  ];
  const missing = patterns.filter(function (p) {
    return !new RegExp(p).test(js);
  });
  check('Fix 4: video allowlist (YouTube, Vimeo, TikTok, Drive, FB, X)',
        missing.length === 0, missing.length ? 'missing=' + missing.join(',') : 'all 8 hosts present');
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

// --- Migration 0007 exists and covers all 6 video hosts ---
{
  const m = 'supabase/migrations/0007_video_hosts.sql';
  if (fs.existsSync(m)) {
    const text = fs.readFileSync(m, 'utf8');
    const hosts = ['youtube', 'vimeo', 'tiktok', 'drive\\.google', 'facebook', 'twitter'];
    const missing = hosts.filter(function (h) {
      return !new RegExp(h).test(text);
    });
    check('Migration 0007 exists and covers 6 hosts',
          missing.length === 0, missing.length ? 'missing=' + missing.join(',') : 'all 6 hosts present');
  } else {
    check('Migration 0007 exists', false);
  }
}

// --- Phase 4: video embed helper in js/format.js ---
{
  const js = fs.readFileSync('js/format.js', 'utf8');
  // Must be a named export (used by ticket.js).
  check('Phase 4: videoEmbedUrl exported from format.js',
        /export function videoEmbedUrl\b/.test(js));
  check('Phase 4: isExternalVideoLink exported from format.js',
        /export function isExternalVideoLink\b/.test(js));
  // Must handle the four embed hosts.
  const embedHosts = ['youtube\\.com', 'youtu\\.be', 'vimeo\\.com', 'tiktok\\.com', 'drive\\.google\\.com'];
  const missing = embedHosts.filter(function (h) { return !new RegExp(h).test(js); });
  check('Phase 4: videoEmbedUrl covers 4 embed hosts', missing.length === 0,
        missing.length ? 'missing=' + missing.join(',') : 'YouTube, youtu.be, Vimeo, TikTok, Drive');
}

// --- Phase 4: track.html + ticket.html exist with the new structure ---
{
  const track = fs.readFileSync('track.html', 'utf8');
  check('Phase 4: track.html has #track-form', /id="track-form"/.test(track));
  check('Phase 4: track.html loads js/track.js (module)', /<script type="module" src="js\/track\.js">/.test(track));

  const ticket = fs.readFileSync('ticket.html', 'utf8');
  check('Phase 4: ticket.html has #ticket-region (skeleton mount point)',
        /id="ticket-region"/.test(ticket));
  check('Phase 4: ticket.html loads js/ticket.js (module)',
        /<script type="module" src="js\/ticket\.js">/.test(ticket));
  // CSP: must include frame-src for the four embed hosts.
  check('Phase 4: ticket.html CSP allows YouTube + Vimeo + TikTok + Drive in frame-src',
        /frame-src[^;]*youtube\.com/.test(ticket)
        && /frame-src[^;]*vimeo\.com/.test(ticket)
        && /frame-src[^;]*tiktok\.com/.test(ticket)
        && /frame-src[^;]*drive\.google\.com/.test(ticket));
  // CSP: img-src must allow Drive thumbnails.
  check('Phase 4: ticket.html CSP allows googleusercontent thumbnails in img-src',
        /img-src[^;]*googleusercontent\.com/.test(ticket));
}

console.log('\n' + (allPass ? '✓ All security fixes present' : '✗ Some fixes missing — see above'));
process.exit(allPass ? 0 : 1);
