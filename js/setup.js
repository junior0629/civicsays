// =========================================================================
// CivicSays — setup.js
// First-run configuration: validate the user's Supabase URL + anon key by
// hitting the public REST endpoint, then save to localStorage and redirect.
// =========================================================================

import { saveEnv, hasEnv } from './env.js';
import { buttonBusy, toast } from './ui.js';

var form        = document.getElementById('setup-form');
var urlInput    = document.getElementById('supabase-url');
var keyInput    = document.getElementById('supabase-key');
var toggleBtn   = document.getElementById('toggle-key');
var eyeIcon     = document.getElementById('eye-icon');
var submitBtn   = document.getElementById('setup-submit');
var errorEl     = document.getElementById('setup-error');
var returnPath   = new URLSearchParams(window.location.search).get('return') || 'index.html';

// Pre-fill if we already have something.
if (hasEnv()) {
  // Already configured — just redirect away.
  window.location.replace(returnPath);
}

// Toggle password visibility.
var keyVisible = false;
toggleBtn.addEventListener('click', function () {
  keyVisible = !keyVisible;
  keyInput.type = keyVisible ? 'text' : 'password';
  eyeIcon.querySelector('use').setAttribute('href',
    keyVisible ? 'assets/icons.svg#i-eye-off' : 'assets/icons.svg#i-eye');
  toggleBtn.setAttribute('aria-label', keyVisible ? 'Hide key' : 'Show key');
});

form.addEventListener('submit', onSubmit);

async function onSubmit(e) {
  e.preventDefault();
  errorEl.style.display = 'none';

  var url = urlInput.value.trim();
  var key = keyInput.value.trim();

  // Basic format validation.
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) {
    showError('That doesn\'t look like a Supabase URL. Expected: https://your-project.supabase.co');
    urlInput.focus();
    return;
  }
  if (!key || key.length < 50 || !key.startsWith('eyJ')) {
    showError('That doesn\'t look like a Supabase anon key. JWTs start with "eyJ".');
    keyInput.focus();
    return;
  }

  var restore = buttonBusy(submitBtn);
  try {
    // Validate by hitting the public REST endpoint. A 200 or 401 both
    // confirm the project exists; a network failure or 404 means bad URL.
    var probe = await fetch(url.replace(/\/$/, '') + '/rest/v1/', {
      method: 'GET',
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key },
    });
    if (!probe.ok && probe.status !== 401) {
      throw new Error('Unexpected response: ' + probe.status);
    }
    // Probe OK — save and continue.
    saveEnv(url.replace(/\/$/, ''), key);
    toast('Connected. Loading app…', 'success', 1500);
    setTimeout(function () { window.location.replace(returnPath); }, 600);
  } catch (err) {
    restore();
    showError(
      'Could not reach that Supabase project. Double-check the URL and that the project is active. ' +
      'Original error: ' + (err && err.message ? err.message : String(err))
    );
  }
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
}
