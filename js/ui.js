// =========================================================================
// CivicSays — ui.js
// Toast, modal, confirm, copy, lightbox helpers. DOM-only, no deps.
// =========================================================================

import { icon } from './icons.js';

// -------------------------------------------------------------------------
// Toast — small notification, auto-dismiss
// -------------------------------------------------------------------------

/**
 * @typedef {'info'|'success'|'warning'|'error'} ToastKind
 */

let toastContainer = null;
function getToastContainer() {
  if (toastContainer && document.body.contains(toastContainer)) return toastContainer;
  toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container';
  Object.assign(toastContainer.style, {
    position: 'fixed',
    right: '24px',
    bottom: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    zIndex: 'var(--z-toast)',
    pointerEvents: 'none',
  });
  document.body.appendChild(toastContainer);
  return toastContainer;
}

/**
 * Show a toast.
 * @param {string} message
 * @param {ToastKind} [kind='info']
 * @param {number} [duration=3500]
 */
export function toast(message, kind = 'info', duration = 3500) {
  var c = getToastContainer();
  var el = document.createElement('div');
  el.className = 'toast is-' + kind;
  el.style.pointerEvents = 'auto';

  var iconName = ({ success: 'check-circle', error: 'x-circle', warning: 'alert', info: 'info' })[kind] || 'info';
  el.appendChild(icon(iconName, { size: 18 }));

  var text = document.createElement('div');
  text.textContent = message;
  text.style.flex = '1';
  el.appendChild(text);

  c.appendChild(el);

  setTimeout(function () {
    el.style.transition = 'opacity 200ms, transform 200ms';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(function () { el.remove(); }, 220);
  }, duration);
}

// -------------------------------------------------------------------------
// Modal — open/close with a builder function
// -------------------------------------------------------------------------

/**
 * Open a modal overlay. The builder is called with a container element to
 * populate. Returns a controller with .close() and a promise that resolves
 * with the value passed to .close(value), or undefined if dismissed.
 *
 * @template T
 * @param {(container: HTMLElement, ctx: { setFooter: (footer: HTMLElement) => void, close: (value?: T) => void }) => void} builder
 * @param {object} [opts]  { title, subtitle, dismissible=true, size='md' }
 * @returns {{ close: (value?: T) => void, promise: Promise<T|undefined>, backdrop: HTMLElement }}
 */
export function openModal(builder, opts = {}) {
  var o = Object.assign({ dismissible: true, size: 'md' }, opts);

  var backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'presentation');

  var modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  if (o.title) modal.setAttribute('aria-labelledby', 'modal-title-' + Date.now());
  if (o.size === 'sm') modal.style.maxWidth = '380px';
  if (o.size === 'lg') modal.style.maxWidth = '640px';

  if (o.title || o.dismissible) {
    var header = document.createElement('div');
    header.className = 'modal-header';
    var titles = document.createElement('div');
    if (o.title) {
      var h = document.createElement('h2');
      h.className = 'modal-title';
      h.id = 'modal-title-' + Date.now();
      h.textContent = o.title;
      titles.appendChild(h);
    }
    if (o.subtitle) {
      var sub = document.createElement('p');
      sub.className = 'modal-subtitle';
      sub.textContent = o.subtitle;
      titles.appendChild(sub);
    }
    header.appendChild(titles);
    if (o.dismissible) {
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'icon-btn';
      closeBtn.setAttribute('aria-label', 'Close dialog');
      closeBtn.appendChild(icon('x', { size: 18 }));
      closeBtn.addEventListener('click', function () { ctrl.close(); });
      header.appendChild(closeBtn);
    }
    modal.appendChild(header);
  }

  var body = document.createElement('div');
  body.className = 'modal-body';
  modal.appendChild(body);

  var footerEl = null;
  var resolvePromise;
  var promise = new Promise(function (res) { resolvePromise = res; });

  function teardown(value) {
    if (!document.body.contains(backdrop)) return;
    backdrop.style.animation = 'fade-in 200ms reverse';
    setTimeout(function () {
      if (document.body.contains(backdrop)) backdrop.remove();
      document.removeEventListener('keydown', onKeydown);
      if (lastFocused && lastFocused.focus) lastFocused.focus();
      resolvePromise(value);
    }, 180);
  }

  function onKeydown(e) {
    if (e.key === 'Escape' && o.dismissible) {
      e.preventDefault();
      teardown(undefined);
    }
  }
  document.addEventListener('keydown', onKeydown);

  // Focus trap (simple): focus first focusable on open, restore on close.
  var lastFocused = document.activeElement;
  setTimeout(function () {
    var f = modal.querySelector('input, textarea, select, button, [tabindex]:not([tabindex="-1"])');
    if (f) f.focus();
  }, 30);

  var ctrl = {
    close: teardown,
    promise: promise,
    backdrop: backdrop,
    setFooter: function (footer) {
      if (footerEl) footerEl.remove();
      footerEl = document.createElement('div');
      footerEl.className = 'modal-footer';
      footerEl.appendChild(footer);
      modal.appendChild(footerEl);
    },
  };

  builder(body, ctrl);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // Click outside the modal (on backdrop) dismisses.
  backdrop.addEventListener('click', function (e) {
    if (e.target === backdrop && o.dismissible) teardown(undefined);
  });

  return ctrl;
}

/**
 * Convenience: show a confirmation modal. Returns a promise<boolean>.
 * @param {object} opts  { title, message, confirmText='Confirm', cancelText='Cancel', kind='primary' }
 */
export function confirmModal(opts) {
  var o = Object.assign({ confirmText: 'Confirm', cancelText: 'Cancel', kind: 'primary' }, opts);
  return new Promise(function (resolve) {
    var decided = false;
    openModal(function (body, ctx) {
      var p = document.createElement('p');
      p.textContent = opts.message || '';
      p.style.color = 'var(--text-secondary)';
      p.style.lineHeight = 'var(--lh-relaxed)';
      body.appendChild(p);

      var footer = document.createElement('div');
      footer.style.display = 'flex';
      footer.style.justifyContent = 'flex-end';
      footer.style.gap = '12px';
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn btn-ghost';
      cancel.textContent = o.cancelText;
      cancel.addEventListener('click', function () { decided = true; ctx.close(false); });
      var confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = o.kind === 'danger' ? 'btn btn-danger' : 'btn btn-primary';
      confirm.textContent = o.confirmText;
      confirm.addEventListener('click', function () { decided = true; ctx.close(true); });
      footer.appendChild(cancel);
      footer.appendChild(confirm);
      ctx.setFooter(footer);
    }, { title: opts.title, dismissible: true }).promise.then(function (v) {
      resolve(decided ? !!v : false);
    });
  });
}

// -------------------------------------------------------------------------
// Lightbox — simple image overlay
// -------------------------------------------------------------------------

export function openLightbox(src, alt) {
  var backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.style.cursor = 'zoom-out';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-label', alt || 'Image preview');

  var img = document.createElement('img');
  img.src = src;
  img.alt = alt || '';
  img.style.maxWidth = '92vw';
  img.style.maxHeight = '92vh';
  img.style.borderRadius = 'var(--radius-md)';
  img.style.boxShadow = 'var(--shadow-lg)';
  backdrop.appendChild(img);

  function close() { backdrop.remove(); }
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
  document.body.appendChild(backdrop);
}

// -------------------------------------------------------------------------
// Copy to clipboard
// -------------------------------------------------------------------------

export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Fallback: textarea
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// -------------------------------------------------------------------------
// Loading state on a button
// -------------------------------------------------------------------------

/**
 * Disable a button, show a spinner, and return a restore function.
 * @param {HTMLButtonElement} btn
 * @returns {() => void}  restore
 */
export function buttonBusy(btn) {
  if (!btn) return function () {};
  var originalHtml = btn.innerHTML;
  var originalDisabled = btn.disabled;
  btn.disabled = true;
  btn.innerHTML = '';
  var sp = document.createElement('span');
  sp.className = 'spinner';
  btn.appendChild(sp);
  var text = document.createElement('span');
  text.textContent = btn.dataset.busyText || 'Working…';
  text.style.marginLeft = '8px';
  btn.appendChild(text);
  return function restore() {
    btn.disabled = originalDisabled;
    btn.innerHTML = originalHtml;
  };
}
