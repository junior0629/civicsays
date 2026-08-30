// =========================================================================
// CivicSays — login.js
// Sign-in form for staff. Uses js/auth.js → signIn(), redirects to the
// `return` query param (sanitised) on success, shows a friendly error
// on failure.
//
// SECURITY: the three possible sign-in failures (wrong password, account
// doesn't exist, account deactivated) are collapsed to a single error
// string with a fixed 1.5s delay, and a 2x backoff on consecutive
// failures. This prevents email enumeration via timing or message
// differences. Deactivated is kept distinct because legitimate staff
// have to know to contact the admin — but only after the same delay.
// =========================================================================

import { signIn, getCurrentOfficial, SignInError } from './auth.js';
import { injectSprite } from './icons.js';
import { buttonBusy } from './ui.js';

injectSprite();

// DOM-element lookups. Guarded so the module can be imported under
// Node/test environments without throwing.
var form = typeof document !== 'undefined' ? document.getElementById('login-form') : null;
var emailEl = typeof document !== 'undefined' ? document.getElementById('f-email') : null;
var passwordEl = typeof document !== 'undefined' ? document.getElementById('f-password') : null;
var emailErr = typeof document !== 'undefined' ? document.getElementById('err-email') : null;
var passwordErr = typeof document !== 'undefined' ? document.getElementById('err-password') : null;
var formError = typeof document !== 'undefined' ? document.getElementById('form-error') : null;
var submitBtn = typeof document !== 'undefined' ? document.getElementById('login-submit') : null;

/**
 * Map a sign-in failure code to the user-facing message. 'deactivated' is
 * kept distinct (after the same anti-enumeration delay) so legitimate
 * staff know to contact the admin. All other failures collapse to a
 * single "Sign in failed" string to prevent email enumeration.
 *
 * @param {string} code  one of SignInError.*
 * @returns {string}
 */
export function signInErrorMessage(code) {
  if (code === SignInError.Deactivated) {
    return 'This account has been deactivated. Contact your administrator.';
  }
  return 'Sign in failed. Please check your email and password.';
}

/** @returns {string} safe relative path or 'admin.html'. */
export function readReturnPath() {
  try {
    var raw = new URLSearchParams(window.location.search).get('return');
    if (!raw) return 'admin.html';
    // Must start with a single `/` (relative path) and not contain `//`.
    if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
    return 'admin.html';
  } catch (e) {
    return 'admin.html';
  }
}

function setFieldError(input, errEl, message) {
  if (!errEl) return;
  if (message) {
    errEl.textContent = message;
    var fieldEl = input.closest('.field');
    if (fieldEl) fieldEl.classList.add('invalid');
    input.setAttribute('aria-invalid', 'true');
  } else {
    errEl.textContent = '';
    var fieldEl2 = input.closest('.field');
    if (fieldEl2) fieldEl2.classList.remove('invalid');
    input.removeAttribute('aria-invalid');
  }
}

function showFormError(message) {
  if (!formError) return;
  if (message) {
    formError.textContent = message;
    formError.hidden = false;
  } else {
    formError.textContent = '';
    formError.hidden = true;
  }
}

function validate() {
  var ok = true;
  var firstInvalid = null;

  var email = (emailEl.value || '').trim();
  if (!email) {
    setFieldError(emailEl, emailErr, 'Please enter your email.');
    firstInvalid = firstInvalid || emailEl;
    ok = false;
  } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    setFieldError(emailEl, emailErr, 'Please enter a valid email address.');
    firstInvalid = firstInvalid || emailEl;
    ok = false;
  } else {
    setFieldError(emailEl, emailErr, null);
  }

  var password = passwordEl.value || '';
  if (!password) {
    setFieldError(passwordEl, passwordErr, 'Please enter your password.');
    firstInvalid = firstInvalid || passwordEl;
    ok = false;
  } else {
    setFieldError(passwordEl, passwordErr, null);
  }

  return { ok: ok, firstInvalid: firstInvalid };
}

// Fixed anti-enumeration delay. Slightly longer than the typical
// sign-in round-trip so the user can't tell AuthFailed from NotOfficial
// by timing.
var ENUMERATION_DELAY_MS = 1500;
var BACKOFF_KEY = 'civicsays:login:fail-count';

function getFailCount() {
  try {
    return parseInt(sessionStorage.getItem(BACKOFF_KEY) || '0', 10) || 0;
  } catch (e) { return 0; }
}

function setFailCount(n) {
  try { sessionStorage.setItem(BACKOFF_KEY, String(n)); } catch (e) {}
}

function clearFailCount() {
  try { sessionStorage.removeItem(BACKOFF_KEY); } catch (e) {}
}

function delayBeforeError() {
  var n = getFailCount();
  // 1.5s base, doubles on consecutive failures (capped at 6s).
  var ms = ENUMERATION_DELAY_MS * Math.pow(2, Math.min(n, 2));
  setFailCount(n + 1);
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// Clear field errors as the user types.
if (form && emailEl && passwordEl) {
  [emailEl, passwordEl].forEach(function (el, i) {
    var errEl = i === 0 ? emailErr : passwordErr;
    el.addEventListener('input', function () {
      setFieldError(el, errEl, null);
      showFormError(null);
    });
  });
}

if (form) form.addEventListener('submit', async function (e) {
  e.preventDefault();
  var v = validate();
  if (!v.ok) {
    if (v.firstInvalid) v.firstInvalid.focus();
    return;
  }

  submitBtn.setAttribute('aria-busy', 'true');
  var restore = buttonBusy(submitBtn);
  try {
    await signIn(emailEl.value.trim(), passwordEl.value);
    clearFailCount();
    // Success — bounce to the return target.
    window.location.replace(readReturnPath());
  } catch (err) {
    // Always wait the anti-enumeration delay before showing the error.
    await delayBeforeError();

    // The three failure codes all become the same user-facing string,
    // except 'deactivated' which we expose (after the same delay) so
    // legitimate staff know to contact the admin.
    var code = err && err.code;
    setFieldError(emailEl, emailErr, signInErrorMessage(code));
    emailEl.focus();
  } finally {
    submitBtn.removeAttribute('aria-busy');
    restore();
  }
});

// If already signed in, skip the form.
(async function autoRedirect() {
  try {
    var official = await getCurrentOfficial();
    if (official) {
      window.location.replace(readReturnPath());
    }
  } catch (e) {
    // Stay on the form; the user can still sign in manually.
  }
})();
