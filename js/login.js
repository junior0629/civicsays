// =========================================================================
// CivicSays — login.js
// Sign-in form for staff. Uses js/auth.js → signIn(), redirects to the
// `return` query param (sanitised) on success, shows a friendly error
// on failure.
// =========================================================================

import { signIn, getCurrentOfficial } from './auth.js';
import { injectSprite } from './icons.js';
import { buttonBusy } from './ui.js';

injectSprite();

var form = document.getElementById('login-form');
var emailEl = document.getElementById('f-email');
var passwordEl = document.getElementById('f-password');
var emailErr = document.getElementById('err-email');
var passwordErr = document.getElementById('err-password');
var formError = document.getElementById('form-error');
var submitBtn = document.getElementById('login-submit');

/**
 * Read the `return` query param and validate it as a relative path.
 * Rejects anything with a protocol or `//` (open redirect protection).
 */
function readReturnPath() {
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

// Clear field errors as the user types.
[emailEl, passwordEl].forEach(function (el, i) {
  var errEl = i === 0 ? emailErr : passwordErr;
  el.addEventListener('input', function () {
    setFieldError(el, errEl, null);
    showFormError(null);
  });
});

form.addEventListener('submit', async function (e) {
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
    // Success — bounce to the return target.
    window.location.replace(readReturnPath());
  } catch (err) {
    var msg = (err && err.message) || 'Sign in failed. Please try again.';
    // Map auth-specific errors to the field they belong to.
    if (/not registered as an official/i.test(msg)) {
      setFieldError(emailEl, emailErr, 'This email is not registered as a staff account.');
      emailEl.focus();
    } else if (/deactivated/i.test(msg)) {
      setFieldError(emailEl, emailErr, 'This account has been deactivated. Contact your administrator.');
      emailEl.focus();
    } else {
      showFormError(msg);
      passwordEl.focus();
      passwordEl.select();
    }
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
