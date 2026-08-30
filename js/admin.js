// =========================================================================
// CivicSays — admin.js
// Phase 5a: staff dashboard. Lists all tickets + inquiries with filter
// pills, tab switching, and live updates via the list_staff_tickets /
// list_staff_inquiries RPCs and the subscribeTickets / subscribeInquiries
// realtime channels.
//
// Routing: if no signed-in official, redirect to login.html?return=… .
// =========================================================================

import {
  getClient,
  unwrap,
  friendlyError,
  T,
} from './supabase.js';
import { getCurrentOfficial, signOut } from './auth.js';
import {
  ticketStatusLabel,
  inquiryStatusLabel,
  ticketKindLabel,
  statusBadgeClass,
  formatRelative,
  escapeHtml,
} from './format.js';
import { subscribeTickets, subscribeInquiries } from './realtime.js';
import { injectSprite, icon } from './icons.js';
import { toast } from './ui.js';

injectSprite();

// -------------------------------------------------------------------------
// State
// -------------------------------------------------------------------------
var state = {
  official: null,           // Official row
  activeTab: 'tickets',     // 'tickets' | 'inquiries'
  statusFilter: '',         // '' | 'pending' | 'in_process' | 'hold' | 'solved'
  kindFilter: '',           // '' | 'request' | 'complaint'
  inqStatusFilter: '',      // '' | 'waiting' | 'active' | 'resolved'
  tickets: [],
  inquiries: [],
  loading: { tickets: true, inquiries: true },
  error: { tickets: null, inquiries: null },
};

var realtimeUnsubs = [];

// -------------------------------------------------------------------------
// withTimeout — race a promise against a timer so a stuck RPC can't park
// the dashboard. Throws a friendly Error on timeout.
// -------------------------------------------------------------------------
function withTimeout(promise, ms, label) {
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () {
      reject(new Error((label || 'Request') + ' timed out after ' + ms + 'ms.'));
    }, ms);
    promise.then(
      function (v) { clearTimeout(t); resolve(v); },
      function (e) { clearTimeout(t); reject(e); }
    );
  });
}

// Per-RPC budget. Supabase usually responds in <500ms; 10s is generous
// enough for a slow mobile connection but short enough that a stuck
// network doesn't park the page.
var RPC_TIMEOUT_MS = 10000;

/**
 * Translate a raw RPC/Supabase error into something a staff user can
 * act on. The "function not in schema cache" case is the common one
 * after a fresh migration — make it actionable instead of dumping the
 * raw Supabase error.
 */
function friendlyErrorForStaff(err, what) {
  var msg = String(err || '').toLowerCase();
  if (/could not find the function|schema cache|pgrst202/.test(msg)) {
    return 'The dashboard is missing a recent database update. ' +
      'Please ask your administrator to run supabase/migrations/0009_staff_listing_rpc.sql ' +
      'in the Supabase SQL editor, then refresh this page.';
  }
  if (/timed out/.test(msg)) {
    return 'The request to load ' + what + ' took too long. ' +
      'Check your network connection and refresh.';
  }
  if (/forbidden|42501/.test(msg)) {
    return 'You do not have permission to view ' + what + '. ' +
      'Sign out and sign back in, or contact your administrator.';
  }
  return 'Could not load ' + what + ': ' + String(err || 'unknown error');
}

// -------------------------------------------------------------------------
// Entry
// -------------------------------------------------------------------------
main().catch(function (err) {
  console.error('[civicsays:admin] fatal', err);
  showFatalError(err);
});

async function main() {
  // 1. Require auth. Redirects to login.html if no official.
  state.official = await getCurrentOfficial();
  if (!state.official) {
    var back = 'admin.html';
    window.location.replace('login.html?return=' + encodeURIComponent(back));
    return;
  }

  // 2. Paint navbar.
  renderNav();

  // 3. Wire tab + filter controls.
  wireTabs();
  wireStatusFilters();
  wireKindFilters();
  wireInquiryStatusFilters();

  // 4. Load initial data + start realtime.
  await Promise.all([loadTickets(), loadInquiries()]);
  wireRealtime();

  // 5. Observability — one structured log line per dashboard load.
  // Useful for spotting misuse from the browser console; Supabase logs
  // already capture the RPC, this is the JS-side mirror.
  console.info('[civicsays:admin] loaded', {
    officialId: state.official && state.official.id,
    activeTab: state.activeTab,
    tickets: state.tickets.length,
    inquiries: state.inquiries.length,
    ticketError: !!state.error.tickets,
    inquiryError: !!state.error.inquiries,
  });
}

// -------------------------------------------------------------------------
// Navbar — signed-in chip
// -------------------------------------------------------------------------
function renderNav() {
  var el = document.getElementById('nav-action');
  if (!el) return;
  el.innerHTML = '';
  var wrap = document.createElement('div');
  wrap.style.display = 'inline-flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = 'var(--space-3)';

  var name = document.createElement('span');
  name.style.fontSize = 'var(--fs-sm)';
  name.style.color = 'var(--text-secondary)';
  name.textContent = 'Signed in as ' + state.official.full_name;
  wrap.appendChild(name);

  var out = document.createElement('button');
  out.type = 'button';
  out.className = 'btn btn-ghost btn-sm';
  out.id = 'signout-btn';
  out.appendChild(icon('logout', { size: 14 }));
  var lbl = document.createElement('span');
  lbl.textContent = 'Sign out';
  out.appendChild(lbl);
  out.addEventListener('click', onSignOut);
  wrap.appendChild(out);

  el.appendChild(wrap);
}

async function onSignOut() {
  var btn = document.getElementById('signout-btn');
  if (btn) btn.disabled = true;
  try {
    await signOut();
    window.location.replace('login.html');
  } catch (err) {
    toast(friendlyError(err), 'error', 5000);
    if (btn) btn.disabled = false;
  }
}

// -------------------------------------------------------------------------
// Tabs
// -------------------------------------------------------------------------

/**
 * Apply the WAI-ARIA tabs pattern to the given tab/panel refs and return
 * the resulting active tab. Pure function (apart from mutating the
 * passed-in DOM attributes) so it can be unit-tested without a full
 * document.
 *
 * @param {{
 *   tabTickets: HTMLElement, tabInquiries: HTMLElement,
 *   panelTickets: HTMLElement, panelInquiries: HTMLElement
 * }} refs
 * @param {'tickets'|'inquiries'} tab
 * @returns {'tickets'|'inquiries'}
 */
export function activateTab(refs, tab) {
  var isTickets = tab !== 'inquiries';
  refs.tabTickets.setAttribute('aria-selected', String(isTickets));
  refs.tabTickets.classList.toggle('is-active', isTickets);
  refs.tabTickets.setAttribute('tabindex', isTickets ? '0' : '-1');
  refs.tabInquiries.setAttribute('aria-selected', String(!isTickets));
  refs.tabInquiries.classList.toggle('is-active', !isTickets);
  refs.tabInquiries.setAttribute('tabindex', isTickets ? '-1' : '0');
  refs.panelTickets.hidden = !isTickets;
  refs.panelInquiries.hidden = isTickets;
  return isTickets ? 'tickets' : 'inquiries';
}

function wireTabs() {
  var tabTickets = document.getElementById('tab-tickets');
  var tabInquiries = document.getElementById('tab-inquiries');
  if (!tabTickets || !tabInquiries) return;

  var refs = {
    tabTickets: tabTickets,
    tabInquiries: tabInquiries,
    panelTickets: document.getElementById('panel-tickets'),
    panelInquiries: document.getElementById('panel-inquiries'),
  };

  function activate(tab) {
    state.activeTab = activateTab(refs, tab);
  }

  tabTickets.addEventListener('click', function () { activate('tickets'); });
  tabInquiries.addEventListener('click', function () { activate('inquiries'); });
  tabTickets.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      activate('inquiries');
      tabInquiries.focus();
    }
  });
  tabInquiries.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      activate('tickets');
      tabTickets.focus();
    }
  });
}

// -------------------------------------------------------------------------
// Filter pills
// -------------------------------------------------------------------------
function wireStatusFilters() {
  var row = document.querySelector('[data-testid="status-filter"]');
  if (!row) return;
  row.addEventListener('click', function (e) {
    var btn = e.target.closest('.filter-pill');
    if (!btn) return;
    row.querySelectorAll('.filter-pill').forEach(function (b) { b.classList.remove('is-active'); });
    btn.classList.add('is-active');
    state.statusFilter = btn.dataset.status || '';
    loadTickets();
  });
}

function wireKindFilters() {
  var row = document.querySelector('[data-testid="kind-filter"]');
  if (!row) return;
  row.addEventListener('click', function (e) {
    var btn = e.target.closest('.filter-pill');
    if (!btn) return;
    row.querySelectorAll('.filter-pill').forEach(function (b) { b.classList.remove('is-active'); });
    btn.classList.add('is-active');
    state.kindFilter = btn.dataset.kind || '';
    loadTickets();
  });
}

function wireInquiryStatusFilters() {
  var row = document.querySelector('[data-testid="inquiry-status-filter"]');
  if (!row) return;
  row.addEventListener('click', function (e) {
    var btn = e.target.closest('.filter-pill');
    if (!btn) return;
    row.querySelectorAll('.filter-pill').forEach(function (b) { b.classList.remove('is-active'); });
    btn.classList.add('is-active');
    state.inqStatusFilter = btn.dataset.inqStatus || '';
    loadInquiries();
  });
}

// -------------------------------------------------------------------------
// Data load — tickets
// -------------------------------------------------------------------------
async function loadTickets() {
  state.loading.tickets = true;
  state.error.tickets = null;
  if (!state.loading.inquiries) renderTicketsList();
  else renderTicketsSkeleton();

  try {
    var c = await getClient();
    var rpc = c.rpc('list_staff_tickets', {
      p_status_filter: state.statusFilter || null,
      p_kind_filter:   state.kindFilter   || null,
      p_limit: 50,
    });
    var data = await unwrap(await withTimeout(rpc, RPC_TIMEOUT_MS, 'list_staff_tickets'));
    state.tickets = Array.isArray(data) ? data : [];
  } catch (err) {
    state.error.tickets = friendlyError(err);
  } finally {
    state.loading.tickets = false;
    renderTicketsList();
  }
}

function renderTicketsSkeleton() {
  var list = document.getElementById('ticket-list');
  if (!list) return;
  list.innerHTML = '';
  var sk = document.createElement('div');
  sk.className = 'text-muted';
  sk.style.padding = 'var(--space-6)';
  sk.style.textAlign = 'center';
  sk.textContent = 'Loading…';
  list.appendChild(sk);
}

function renderTicketsList() {
  var list = document.getElementById('ticket-list');
  if (!list) return;
  var countEl = document.getElementById('tickets-count');
  if (countEl) countEl.textContent = String(state.tickets.length);

  list.innerHTML = '';

  if (state.loading.tickets) {
    renderTicketsSkeleton();
    return;
  }
  if (state.error.tickets) {
    var e = document.createElement('div');
    e.className = 'text-muted';
    e.style.padding = 'var(--space-6)';
    e.style.textAlign = 'center';
    e.style.color = 'var(--status-error)';
    e.textContent = friendlyErrorForStaff(state.error.tickets, 'tickets');
    list.appendChild(e);
    return;
  }
  if (state.tickets.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'text-muted';
    empty.style.padding = 'var(--space-8)';
    empty.style.textAlign = 'center';
    empty.innerHTML = '';
    var h = document.createElement('p');
    h.style.fontSize = 'var(--fs-md)';
    h.style.fontWeight = 'var(--fw-medium)';
    h.style.color = 'var(--text-secondary)';
    h.style.marginBottom = 'var(--space-2)';
    h.textContent = 'No tickets match this filter';
    empty.appendChild(h);
    var hint = document.createElement('p');
    hint.style.fontSize = 'var(--fs-sm)';
    hint.textContent = 'Try changing the status or type above.';
    empty.appendChild(hint);
    list.appendChild(empty);
    return;
  }

  state.tickets.forEach(function (t) { list.appendChild(buildTicketCard(t)); });
}

export { buildTicketCard };

function buildTicketCard(t) {
  var card = document.createElement('a');
  card.className = 'admin-ticket-card';
  card.href = 'ticket.html?id=' + encodeURIComponent(t.id);
  card.setAttribute('data-testid', 'ticket-card');
  card.setAttribute('data-ticket-id', t.id);
  card.setAttribute('data-status', t.status || '');
  card.style.display = 'block';
  card.style.padding = 'var(--space-4) var(--space-5)';
  card.style.background = 'var(--glass-primary)';
  card.style.border = '1px solid var(--border-default)';
  card.style.borderRadius = 'var(--radius-lg)';
  card.style.textDecoration = 'none';
  card.style.color = 'inherit';
  card.style.transition = 'transform var(--duration-fast, 120ms) var(--ease-out), border-color var(--duration-fast, 120ms) var(--ease-out)';

  var top = document.createElement('div');
  top.style.display = 'flex';
  top.style.alignItems = 'center';
  top.style.gap = 'var(--space-3)';
  top.style.flexWrap = 'wrap';
  top.style.marginBottom = 'var(--space-2)';

  var id = document.createElement('span');
  id.style.fontFamily = 'var(--font-mono)';
  id.style.fontSize = 'var(--fs-sm)';
  id.style.color = 'var(--text-muted)';
  id.textContent = t.id;
  top.appendChild(id);

  var badge = document.createElement('span');
  badge.className = 'badge ' + statusBadgeClass('ticket', t.status);
  var dot = document.createElement('span');
  dot.className = 'dot';
  badge.appendChild(dot);
  var lbl = document.createElement('span');
  lbl.textContent = ticketStatusLabel(t.status);
  badge.appendChild(lbl);
  top.appendChild(badge);

  var kind = document.createElement('span');
  kind.style.fontSize = 'var(--fs-xs)';
  kind.style.color = 'var(--text-muted)';
  kind.style.textTransform = 'uppercase';
  kind.style.letterSpacing = '0.04em';
  kind.textContent = ticketKindLabel(t.kind);
  top.appendChild(kind);

  card.appendChild(top);

  var title = document.createElement('div');
  title.style.fontSize = 'var(--fs-md)';
  title.style.fontWeight = 'var(--fw-medium)';
  title.style.color = 'var(--text-primary)';
  title.style.lineHeight = '1.35';
  title.style.marginBottom = 'var(--space-2)';
  title.textContent = t.title;
  card.appendChild(title);

  var meta = document.createElement('div');
  meta.style.display = 'flex';
  meta.style.alignItems = 'center';
  meta.style.gap = 'var(--space-4)';
  meta.style.fontSize = 'var(--fs-sm)';
  meta.style.color = 'var(--text-muted)';

  var who = document.createElement('span');
  who.textContent = t.resident_name || 'Anonymous';
  meta.appendChild(who);

  var when = document.createElement('span');
  when.textContent = formatRelative(t.created_at);
  meta.appendChild(when);

  card.appendChild(meta);

  return card;
}

// -------------------------------------------------------------------------
// Data load — inquiries
// -------------------------------------------------------------------------
async function loadInquiries() {
  state.loading.inquiries = true;
  state.error.inquiries = null;
  if (state.activeTab === 'inquiries') renderInquiriesList();

  try {
    var c = await getClient();
    var rpc = c.rpc('list_staff_inquiries', {
      p_status_filter: state.inqStatusFilter || null,
      p_limit: 50,
    });
    var data = await unwrap(await withTimeout(rpc, RPC_TIMEOUT_MS, 'list_staff_inquiries'));
    state.inquiries = Array.isArray(data) ? data : [];
  } catch (err) {
    state.error.inquiries = friendlyError(err);
  } finally {
    state.loading.inquiries = false;
    if (state.activeTab === 'inquiries') renderInquiriesList();
    else {
      // Update the tab count even while not active.
      var c = document.getElementById('inquiries-count');
      if (c) c.textContent = String(state.inquiries.length);
    }
  }
}

function renderInquiriesList() {
  var list = document.getElementById('inquiry-list');
  if (!list) return;
  var countEl = document.getElementById('inquiries-count');
  if (countEl) countEl.textContent = String(state.inquiries.length);

  list.innerHTML = '';

  if (state.loading.inquiries) {
    var sk = document.createElement('div');
    sk.className = 'text-muted';
    sk.style.padding = 'var(--space-6)';
    sk.style.textAlign = 'center';
    sk.textContent = 'Loading…';
    list.appendChild(sk);
    return;
  }
  if (state.error.inquiries) {
    var e = document.createElement('div');
    e.className = 'text-muted';
    e.style.padding = 'var(--space-6)';
    e.style.textAlign = 'center';
    e.style.color = 'var(--status-error)';
    e.textContent = friendlyErrorForStaff(state.error.inquiries, 'inquiries');
    list.appendChild(e);
    return;
  }
  if (state.inquiries.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'text-muted';
    empty.style.padding = 'var(--space-8)';
    empty.style.textAlign = 'center';
    var h = document.createElement('p');
    h.style.fontSize = 'var(--fs-md)';
    h.style.fontWeight = 'var(--fw-medium)';
    h.style.color = 'var(--text-secondary)';
    h.textContent = 'No inquiries match this filter';
    empty.appendChild(h);
    list.appendChild(empty);
    return;
  }

  state.inquiries.forEach(function (i) { list.appendChild(buildInquiryCard(i)); });
}

function buildInquiryCard(i) {
  var card = document.createElement('div');
  card.className = 'admin-inquiry-card';
  card.setAttribute('data-inquiry-id', i.id);
  card.style.padding = 'var(--space-4) var(--space-5)';
  card.style.background = 'var(--glass-primary)';
  card.style.border = '1px solid var(--border-default)';
  card.style.borderRadius = 'var(--radius-lg)';

  var top = document.createElement('div');
  top.style.display = 'flex';
  top.style.alignItems = 'center';
  top.style.gap = 'var(--space-3)';
  top.style.flexWrap = 'wrap';
  top.style.marginBottom = 'var(--space-2)';

  var badge = document.createElement('span');
  badge.className = 'badge ' + statusBadgeClass('inquiry', i.status);
  var dot = document.createElement('span');
  dot.className = 'dot';
  badge.appendChild(dot);
  var lbl = document.createElement('span');
  lbl.textContent = inquiryStatusLabel(i.status);
  badge.appendChild(lbl);
  top.appendChild(badge);
  card.appendChild(top);

  var subj = document.createElement('div');
  subj.style.fontSize = 'var(--fs-md)';
  subj.style.fontWeight = 'var(--fw-medium)';
  subj.style.color = 'var(--text-primary)';
  subj.style.marginBottom = 'var(--space-2)';
  subj.textContent = i.subject;
  card.appendChild(subj);

  var meta = document.createElement('div');
  meta.style.display = 'flex';
  meta.style.alignItems = 'center';
  meta.style.gap = 'var(--space-4)';
  meta.style.fontSize = 'var(--fs-sm)';
  meta.style.color = 'var(--text-muted)';

  var who = document.createElement('span');
  who.textContent = i.resident_name;
  meta.appendChild(who);

  var when = document.createElement('span');
  var lastT = i.last_message_at || i.created_at;
  when.textContent = 'Last activity ' + formatRelative(lastT);
  meta.appendChild(when);

  card.appendChild(meta);

  // Live chat is Phase 5b. For now, inquiries are read-only from the
  // dashboard. (Officials can still receive/send messages via the
  // resident-side flow's live chat when it ships.)
  return card;
}

// -------------------------------------------------------------------------
// Realtime — debounce 250ms bursts
// -------------------------------------------------------------------------
function wireRealtime() {
  var tTimer = null;
  var iTimer = null;

  realtimeUnsubs.push(
    subscribeTickets(function () {
      if (tTimer) clearTimeout(tTimer);
      tTimer = setTimeout(function () { loadTickets(); }, 250);
    })
  );
  realtimeUnsubs.push(
    subscribeInquiries(function () {
      if (iTimer) clearTimeout(iTimer);
      iTimer = setTimeout(function () { loadInquiries(); }, 250);
    })
  );
}

// -------------------------------------------------------------------------
// Fatal error
// -------------------------------------------------------------------------
function showFatalError(err) {
  var region = document.getElementById('admin-region');
  if (!region) return;
  region.innerHTML = '';
  var card = document.createElement('div');
  card.className = 'glass-card';
  card.style.padding = 'var(--space-8)';
  card.style.textAlign = 'center';
  var h = document.createElement('h2');
  h.style.fontSize = 'var(--fs-xl)';
  h.style.fontWeight = 'var(--fw-semibold)';
  h.style.marginBottom = 'var(--space-3)';
  h.textContent = 'Could not load the dashboard';
  card.appendChild(h);
  var p = document.createElement('p');
  p.style.color = 'var(--text-secondary)';
  p.style.marginBottom = 'var(--space-6)';
  p.textContent = friendlyError(err) || 'Unknown error.';
  card.appendChild(p);
  var btn = document.createElement('a');
  btn.className = 'btn btn-primary';
  btn.href = 'login.html';
  btn.textContent = 'Back to sign in';
  card.appendChild(btn);
  region.appendChild(card);
}

// Clean up realtime on unload.
window.addEventListener('beforeunload', function () {
  realtimeUnsubs.forEach(function (u) {
    try { u(); } catch (e) {}
  });
});
