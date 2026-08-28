// =========================================================================
// CivicSays — format.js
// Date, phone, status, byte, escape helpers. Pure functions, no deps.
// =========================================================================

// -------------------------------------------------------------------------
// Ticket ID generation & validation
// -------------------------------------------------------------------------

/**
 * Alphabet that excludes easily-confused characters: no I, O, 0, 1.
 * 31 characters: ABCDEFGHJKLMNPQRSTUVWXYZ23456789
 */
export const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generate a new tracking ID like "CIV-AB3K9X".
 * Client-side uniqueness is probabilistic (collision chance ~ 1 in 887M for
 * 6 chars). The DB enforces uniqueness via PK constraint; if a collision
 * happens, the caller should retry.
 *
 * @returns {string}
 */
export function generateTrackingId() {
  var out = 'CIV-';
  for (var i = 0; i < 6; i++) {
    out += ID_ALPHABET.charAt(Math.floor(Math.random() * ID_ALPHABET.length));
  }
  return out;
}

/**
 * Validate a tracking ID format (no DB lookup).
 * @param {string} id
 * @returns {boolean}
 */
export function isValidTrackingId(id) {
  if (typeof id !== 'string') return false;
  var m = id.trim().toUpperCase().match(/^CIV-([A-HJ-NP-Z2-9]{6})$/);
  return !!m;
}

// -------------------------------------------------------------------------
// Dates
// -------------------------------------------------------------------------

/**
 * Format an ISO timestamp as a human-readable local date+time.
 * @param {string|Date} iso
 * @returns {string}
 */
export function formatDate(iso) {
  if (!iso) return '';
  var d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format an ISO timestamp as a short date.
 */
export function formatDateShort(iso) {
  if (!iso) return '';
  var d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Relative time: "just now", "5m ago", "3h ago", "2d ago", or absolute date.
 */
export function formatRelative(iso) {
  if (!iso) return '';
  var d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return '';
  var diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 30) return 'just now';
  if (diff < 60) return Math.floor(diff) + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return formatDateShort(d);
}

// -------------------------------------------------------------------------
// Status labels
// -------------------------------------------------------------------------

export const TICKET_STATUS_LABELS = Object.freeze({
  pending:    'Pending',
  in_process: 'In Process',
  hold:       'On Hold',
  solved:     'Solved',
});

export const INQUIRY_STATUS_LABELS = Object.freeze({
  waiting:  'Waiting',
  active:   'Active',
  resolved: 'Resolved',
});

export function ticketStatusLabel(s) {
  return TICKET_STATUS_LABELS[s] || s;
}

export function inquiryStatusLabel(s) {
  return INQUIRY_STATUS_LABELS[s] || s;
}

/**
 * CSS class for the badge corresponding to a status.
 * Returns one of: badge-pending, badge-process, badge-hold, badge-solved,
 *                 badge-waiting, badge-active, badge-resolved, badge-hold
 */
export function statusBadgeClass(kind, status) {
  if (kind === 'ticket') {
    return ({
      pending:    'badge-pending',
      in_process: 'badge-process',
      hold:       'badge-hold',
      solved:     'badge-solved',
    })[status] || 'badge-hold';
  }
  if (kind === 'inquiry') {
    return ({
      waiting:  'badge-waiting',
      active:   'badge-active',
      resolved: 'badge-resolved',
    })[status] || 'badge-hold';
  }
  return 'badge-hold';
}

// -------------------------------------------------------------------------
// Phone, bytes, kind labels
// -------------------------------------------------------------------------

/**
 * Format a digit-only phone number. If 11 digits starting with 0, format
 * as (XXX) XXX-XXXX. Otherwise return as-is with spaces.
 */
export function formatPhone(phone) {
  if (!phone) return '';
  var d = String(phone).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) {
    return '(' + d.slice(1, 4) + ') ' + d.slice(4, 7) + '-' + d.slice(7);
  }
  if (d.length === 10) {
    return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
  }
  return d;
}

/**
 * Format bytes as "1.2 MB" etc.
 */
export function formatBytes(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

export const TICKET_KIND_LABELS = Object.freeze({
  request:   'Request',
  complaint: 'Complaint',
});

export function ticketKindLabel(k) {
  return TICKET_KIND_LABELS[k] || k;
}

// -------------------------------------------------------------------------
// HTML escape (for any user-generated content rendered via innerHTML)
// -------------------------------------------------------------------------

/**
 * Escape a string for safe inclusion in HTML.
 * @param {unknown} s
 * @returns {string}
 */
export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape a string for safe inclusion in a URL query parameter.
 */
export function encodeQuery(s) {
  return encodeURIComponent(s);
}

// -------------------------------------------------------------------------
// Misc
// -------------------------------------------------------------------------

/**
 * Truncate text with an ellipsis.
 */
export function truncate(s, n) {
  if (!s) return '';
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * Detect YouTube URL and return the embed URL, or null.
 * @param {string} url
 * @returns {string|null}
 */
export function youtubeEmbedUrl(url) {
  if (!url) return null;
  try {
    var u = new URL(url);
    if (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com' || u.hostname === 'm.youtube.com') {
      var vid = u.searchParams.get('v');
      if (vid) return 'https://www.youtube.com/embed/' + vid;
    }
    if (u.hostname === 'youtu.be') {
      var id = u.pathname.replace(/^\//, '');
      if (id) return 'https://www.youtube.com/embed/' + id;
    }
  } catch { /* invalid URL */ }
  return null;
}
