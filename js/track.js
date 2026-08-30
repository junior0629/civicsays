// =========================================================================
// CivicSays — track.js
// Single-input lookup form. On valid submit, redirect to ticket.html?id=...
// =========================================================================

import { isValidTrackingId } from './format.js';
import { injectSprite } from './icons.js';

// -------------------------------------------------------------------------
// DOM refs
// -------------------------------------------------------------------------

var form = document.getElementById('track-form');
var input = document.getElementById('f-id');
var errEl = document.getElementById('err-id');
var fieldEl = input ? input.closest('.field') : null;

// -------------------------------------------------------------------------
// Init
// -------------------------------------------------------------------------

injectSprite();

// If we landed here with ?id=… in the URL, pre-fill the input and
// auto-redirect after a brief moment (so the user sees the value that
// was looked up). The redirect is gated on validity — invalid IDs
// just show the inline error.
try {
  var params = new URLSearchParams(window.location.search);
  var incoming = params.get('id');
  if (incoming && input) {
    input.value = incoming.trim().toUpperCase();
  }
} catch { /* URLSearchParams unavailable — ignore */ }

// Auto-focus the input. This is the highest-frequency action on this page
// and the field is short — jumping straight to it is the right call.
if (input) input.focus();

// -------------------------------------------------------------------------
// Validation
// -------------------------------------------------------------------------

function setError(message) {
  if (errEl) errEl.textContent = message;
  if (fieldEl) fieldEl.classList.add('invalid');
  if (input) input.setAttribute('aria-invalid', 'true');
}

function clearError() {
  if (errEl) errEl.textContent = '';
  if (fieldEl) fieldEl.classList.remove('invalid');
  if (input) input.removeAttribute('aria-invalid');
}

function liveNormalize() {
  // Auto-uppercase + strip whitespace as the user types. We keep only the
  // allowed alphabet in the tail. The literal "CIV-" prefix is preserved
  // verbatim — the "I" in "CIV" looks like a disallowed char (the 6-char
  // tail alphabet excludes I), but stripping it would break the prefix.
  if (!input) return;
  var v = input.value.toUpperCase().replace(/\s+/g, '');

  // If the user typed/pasted "CIVYQYK9U" (no dash), inject the dash.
  // Match CIV immediately followed by a tail char.
  if (/^CIV[A-HJ-NP-Z2-9]/.test(v)) {
    v = 'CIV-' + v.slice(3);
  }

  // Strip any disallowed char from the tail. The tail is everything after
  // the literal "CIV-" prefix (which we never touch).
  if (v.length > 4) {
    var prefix = v.slice(0, 4); // "CIV-"
    var tail = v.slice(4).replace(/[^A-HJ-NP-Z2-9]/g, '');
    v = prefix + tail;
  }

  if (v !== input.value) input.value = v;
  clearError();
}

if (input) {
  input.addEventListener('input', liveNormalize);
  input.addEventListener('change', liveNormalize);
}

// -------------------------------------------------------------------------
// Submit
// -------------------------------------------------------------------------

function onSubmit(e) {
  e.preventDefault();
  if (!input) return;

  // Run the live normalizer once more in case the user pasted + clicked
  // (which may not fire `input` reliably across all browsers).
  liveNormalize();

  var raw = input.value || '';
  var normalized = raw.trim().toUpperCase();

  if (!normalized) {
    setError('Please enter your tracking ID.');
    input.focus();
    return;
  }
  if (!isValidTrackingId(normalized)) {
    setError('Please enter a valid tracking ID like CIV-XXXXXX.');
    input.focus();
    return;
  }

  // Redirect to the detail page. encodeURIComponent is defensive — the
  // ID format restricts the alphabet, but a defense-in-depth pass costs
  // nothing.
  window.location.href = 'ticket.html?id=' + encodeURIComponent(normalized);
}

if (form) form.addEventListener('submit', onSubmit);
