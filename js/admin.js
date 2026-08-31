// =========================================================================
// CivicSays — admin.js
// Phase 5b: three-column staff dashboard.
//
//   ┌──────────┬────────────────────────────┬───────────┐
//   │ sidebar  │   header + page content    │  right    │
//   │ (240px)  │   (fluid)                  │  rail     │
//   │          │                            │  (280px)  │
//   └──────────┴────────────────────────────┴───────────┘
//
// Loads tickets + inquiries via the staff RPCs (0009), renders them in a
// table (desktop) or card list (mobile), drives the KPI cards and the
// right-rail "Ticket overview" + "Recent activity" widgets, and live-
// updates via the realtime subscriptions. Search/notification/new-ticket
// affordances are rendered as honest stubs (toast on click) — see the
// design plan for what is and is not wired.
// =========================================================================

import {
  getClient,
  unwrap,
  friendlyError,
} from './supabase.js';
import { getCurrentOfficial, signOut } from './auth.js';
import {
  ticketStatusLabel,
  inquiryStatusLabel,
  ticketKindLabel,
  statusBadgeClass,
  formatRelative,
  escapeHtml,
  truncate,
} from './format.js';
import { subscribeTickets, subscribeInquiries } from './realtime.js';
import { injectSprite, icon } from './icons.js';
import { toast } from './ui.js';

injectSprite();

// -------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------
const RPC_TIMEOUT_MS = 10000;
const ACTIVITY_LIMIT = 8;

// -------------------------------------------------------------------------
// State
// -------------------------------------------------------------------------
var state = {
  official: null,
  activeTab: 'tickets',
  statusFilter: '',
  kindFilter: '',
  inqStatusFilter: '',
  tickets: [],
  inquiries: [],
  loading: { tickets: true, inquiries: true },
  error: { tickets: null, inquiries: null },
  activity: [],
  activityLoading: true,
  activityError: null,
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
      'and supabase/migrations/0010_staff_activity_rpc.sql in the Supabase SQL editor, then refresh this page.';
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

  // 2. Flip the body to admin mode (hides the public navbar if any, sets
  //    the layout hooks the CSS keys off of).
  document.body.classList.add('has-admin-sidebar');

  // 3. Build layout shell (sidebar account chip + header avatar).
  buildAccountChip(state.official);

  // 4. Wire tab + filter controls + search + hamburger.
  wireTabs();
  wireStatusFilters();
  wireKindFilters();
  wireInquiryStatusFilters();
  wireSearch();
  wireKeyboardShortcuts();
  wireHamburger();
  wireNewTicket();
  wireBell();
  wireSidebarNav();
  swapViewForViewport();
  window.addEventListener('resize', swapViewForViewport);

  // 5. Load initial data + start realtime.
  await Promise.all([loadTickets(), loadInquiries()]);
  await loadActivity();
  wireRealtime();

  // 6. Observability — one structured log line per dashboard load.
  console.info('[civicsays:admin] loaded', {
    officialId: state.official && state.official.id,
    activeTab: state.activeTab,
    tickets: state.tickets.length,
    inquiries: state.inquiries.length,
    activity: state.activity.length,
    ticketError: !!state.error.tickets,
    inquiryError: !!state.error.inquiries,
  });
}

// -------------------------------------------------------------------------
// Sidebar account chip + header avatar
// -------------------------------------------------------------------------
function initialsOf(name) {
  if (!name) return '?';
  var parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function buildAccountChip(official) {
  var account = document.getElementById('admin-sidebar-account');
  if (account) {
    account.innerHTML = '';
    var info = document.createElement('div');
    info.className = 'admin-sidebar-account-info';
    var nm = document.createElement('div');
    nm.className = 'admin-sidebar-account-name';
    nm.textContent = official.full_name || 'Staff';
    info.appendChild(nm);
    var role = document.createElement('div');
    role.className = 'admin-sidebar-account-role';
    role.textContent = 'Staff Admin';
    info.appendChild(role);
    account.appendChild(info);

    var out = document.createElement('button');
    out.type = 'button';
    out.className = 'admin-sidebar-account-out';
    out.setAttribute('aria-label', 'Sign out');
    out.setAttribute('data-testid', 'sidebar-signout');
    out.appendChild(icon('logout', { size: 14 }));
    out.addEventListener('click', onSignOut);
    account.appendChild(out);
  }

  var avatar = document.getElementById('admin-header-avatar');
  if (avatar) {
    avatar.textContent = initialsOf(official.full_name);
    avatar.setAttribute('title', official.full_name || '');
  }
}

async function onSignOut() {
  try {
    await signOut();
    window.location.replace('login.html');
  } catch (err) {
    toast(friendlyError(err), 'error', 5000);
  }
}

// -------------------------------------------------------------------------
// Tabs — same WAI-ARIA pattern as before; tests rely on `activateTab`.
// -------------------------------------------------------------------------
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
// Filter pills + local search
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

function wireSearch() {
  var input = document.getElementById('admin-search');
  if (!input) return;
  // Local client-side filter on the current table. Real full-text
  // search is a follow-up — we say so honestly in the placeholder area
  // toast when the user submits.
  input.addEventListener('input', function () {
    renderTicketsTable();
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      var q = input.value.trim();
      if (!q) return;
      toast('Search filters the tickets below by title, ID, or resident. ' +
            'Use the status pills to narrow further.', 'info', 4000);
    }
    if (e.key === 'Escape') {
      input.value = '';
      renderTicketsTable();
    }
  });
}

function wireKeyboardShortcuts() {
  document.addEventListener('keydown', function (e) {
    var k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'k') {
      e.preventDefault();
      var input = document.getElementById('admin-search');
      if (input) input.focus();
    }
  });
}

function wireHamburger() {
  var btn = document.querySelector('[data-testid="admin-menu-btn"]');
  var sidebar = document.getElementById('admin-sidebar');
  var scrim = document.getElementById('admin-sidebar-scrim');
  if (!btn || !sidebar || !scrim) return;
  btn.hidden = false;
  function setOpen(open) {
    sidebar.classList.toggle('is-open', open);
    scrim.classList.toggle('is-open', open);
    scrim.setAttribute('aria-hidden', open ? 'false' : 'true');
  }
  btn.addEventListener('click', function () { setOpen(!sidebar.classList.contains('is-open')); });
  scrim.addEventListener('click', function () { setOpen(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && sidebar.classList.contains('is-open')) {
      setOpen(false);
      btn.focus();
    }
  });
}

function wireNewTicket() {
  var btn = document.querySelector('[data-testid="new-ticket-btn"]');
  if (!btn) return;
  btn.addEventListener('click', function () {
    toast('Tickets are submitted by residents at /submit.html. ' +
          'Staff-side ticket creation is a Phase 5c follow-up.', 'info', 5000);
  });
}

function wireBell() {
  var btn = document.querySelector('[data-testid="admin-bell"]');
  if (!btn) return;
  btn.addEventListener('click', function () {
    toast('No notifications yet. Staff changes will appear here.', 'info', 3000);
  });
}

function wireSidebarNav() {
  // In-page links scroll the right area; the active "Overview" link stays
  // active while we're on admin.html. No router yet — this is a single
  // page dashboard for now.
  var sidebar = document.getElementById('admin-sidebar');
  if (!sidebar) return;
  sidebar.addEventListener('click', function (e) {
    var link = e.target.closest('.admin-sidebar-link');
    if (!link) return;
    // On any same-page nav, just close the mobile drawer.
    var sb = document.getElementById('admin-sidebar');
    var sc = document.getElementById('admin-sidebar-scrim');
    if (sb) sb.classList.remove('is-open');
    if (sc) sc.classList.remove('is-open');
  });
}

// -------------------------------------------------------------------------
// Mobile / desktop view swap
// -------------------------------------------------------------------------
function swapViewForViewport() {
  var narrow = window.matchMedia('(max-width: 720px)').matches;
  var wrap = document.getElementById('ticket-table-wrap');
  if (wrap) wrap.setAttribute('data-view', narrow ? 'cards' : 'table');
  // inquiries wrap is the next .admin-table-wrap; we toggle both for symmetry
  var iwrap = document.querySelector('#panel-inquiries .admin-table-wrap');
  if (iwrap) iwrap.setAttribute('data-view', narrow ? 'cards' : 'table');
}

// -------------------------------------------------------------------------
// KPI cards (real counts, no fake trend deltas)
// -------------------------------------------------------------------------
function renderKpiCards(countsOrTickets) {
  var row = document.getElementById('admin-kpi-row');
  if (!row) return;
  row.innerHTML = '';
  // Accept either a pre-aggregated counts object (from
  // count_tickets_by_status) or a raw tickets array. The dashboard
  // passes the counts object; the page header + other internal callers
  // pass arrays.
  var counts;
  if (countsOrTickets && !Array.isArray(countsOrTickets) && typeof countsOrTickets === 'object') {
    counts = {
      pending:    Number(countsOrTickets.pending)    || 0,
      in_process: Number(countsOrTickets.in_process) || 0,
      hold:       Number(countsOrTickets.hold)       || 0,
      solved:     Number(countsOrTickets.solved)     || 0,
    };
  } else {
    counts = { pending: 0, in_process: 0, hold: 0, solved: 0 };
    (countsOrTickets || []).forEach(function (t) {
      if (counts[t.status] != null) counts[t.status]++;
    });
  }
  var total = counts.pending + counts.in_process + counts.hold + counts.solved;

  var cards = [
    { key: 'total',     label: 'Total',      icon: 'inbox',     value: total },
    { key: 'pending',   label: 'Pending',    icon: 'clock',     value: counts.pending },
    { key: 'in_process',label: 'In Process', icon: 'info',      value: counts.in_process },
    { key: 'hold',      label: 'On Hold',    icon: 'alert',     value: counts.hold },
    { key: 'solved',    label: 'Solved',     icon: 'check-circle', value: counts.solved },
  ];

  cards.forEach(function (c) { row.appendChild(buildKpiCard(c)); });
}

function buildKpiCard(card) {
  var el = document.createElement('div');
  el.className = 'admin-kpi-card';
  el.setAttribute('data-status', card.key);
  el.setAttribute('data-testid', 'kpi-' + card.key);

  var head = document.createElement('div');
  head.className = 'admin-kpi-card-head';
  head.appendChild(icon(card.icon, { size: 14 }));
  var lbl = document.createElement('span');
  lbl.textContent = card.label;
  head.appendChild(lbl);
  el.appendChild(head);

  var val = document.createElement('div');
  val.className = 'admin-kpi-card-value';
  val.setAttribute('data-testid', 'kpi-value-' + card.key);
  val.textContent = String(card.value);
  el.appendChild(val);

  return el;
}

// -------------------------------------------------------------------------
// Data load — tickets
// -------------------------------------------------------------------------
async function loadTickets() {
  state.loading.tickets = true;
  state.error.tickets = null;
  renderTicketsTable();

  try {
    var c = await getClient();
    // Two parallel RPCs:
    //   1. list_staff_tickets (paginated, 50 most-recent) — drives the
    //      table list with the active status + kind filter.
    //   2. count_tickets_by_status (aggregate, no LIMIT) — drives the
    //      KPI cards and the "All tickets" donut, so the headline
    //      counts reflect the WHOLE table, not just the visible slice.
    // The dashboard was previously computing KPI counts from the
    // paginated 50-row slice, which made the donut lie once the table
    // exceeded ~50 rows.
    var listRpc = c.rpc('list_staff_tickets', {
      p_status_filter: state.statusFilter || null,
      p_kind_filter:   state.kindFilter   || null,
      p_limit: 50,
    });
    var countRpc = c.rpc('count_tickets_by_status');

    var listData   = await unwrap(await withTimeout(listRpc,  RPC_TIMEOUT_MS, 'list_staff_tickets'));
    var countData  = await unwrap(await withTimeout(countRpc, RPC_TIMEOUT_MS, 'count_tickets_by_status'));

    state.tickets      = Array.isArray(listData) ? listData : [];
    state.ticketCounts = countsFromRpc(Array.isArray(countData) ? countData : []);
  } catch (err) {
    state.error.tickets = friendlyError(err);
  } finally {
    state.loading.tickets = false;
    renderTicketsTable();
    renderKpiCards(state.ticketCounts);
    renderOverviewDonut(state.ticketCounts);
  }
}

// Normalize the count_tickets_by_status RPC payload into a
// {pending, in_process, hold, solved} object the KPI renderer and
// donutSegments already understand. Missing statuses are filled with 0.
function countsFromRpc(rows) {
  var out = { pending: 0, in_process: 0, hold: 0, solved: 0 };
  rows.forEach(function (r) {
    if (out[r.status] != null) out[r.status] = Number(r.count) || 0;
  });
  return out;
}

function renderTicketsTable() {
  var tbody = document.getElementById('ticket-tbody');
  var cards = document.getElementById('ticket-cards');
  var countEl = document.getElementById('tickets-count');
  if (countEl) countEl.textContent = String(state.tickets.length);

  if (tbody) tbody.innerHTML = '';
  if (cards) cards.innerHTML = '';

  if (state.loading.tickets) {
    renderSkeleton(tbody, cards, 6);
    return;
  }
  if (state.error.tickets) {
    renderError(tbody, cards, friendlyErrorForStaff(state.error.tickets, 'tickets'));
    return;
  }
  if (state.tickets.length === 0) {
    renderEmpty(tbody, cards, 'No tickets match this filter', 'Try changing the status or type above.');
    return;
  }

  // Apply local search (top header input) on top of the server-filtered list.
  var q = (document.getElementById('admin-search') || {}).value || '';
  q = q.trim().toLowerCase();
  var visible = state.tickets.filter(function (t) {
    if (!q) return true;
    return (t.id || '').toLowerCase().indexOf(q) !== -1
        || (t.title || '').toLowerCase().indexOf(q) !== -1
        || (t.resident_name || '').toLowerCase().indexOf(q) !== -1;
  });
  if (visible.length === 0) {
    renderEmpty(tbody, cards, 'No matches for "' + escapeHtml(q) + '"', 'Try a different ID, title, or resident name.');
    return;
  }

  visible.forEach(function (t) {
    var row = buildTicketRow(t);
    if (tbody) tbody.appendChild(row);
    var card = buildTicketCard(t);
    if (cards) cards.appendChild(card);
  });
}

// Skeleton placeholder rows
function renderSkeleton(tbody, cards, n) {
  if (tbody) {
    for (var i = 0; i < n; i++) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'admin-loading';
      td.textContent = 'Loading…';
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }
  if (cards) {
    var sk = document.createElement('div');
    sk.className = 'admin-loading';
    sk.textContent = 'Loading…';
    cards.appendChild(sk);
  }
}

function renderError(tbody, cards, msg) {
  if (tbody) {
    var tr = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'admin-error';
    td.textContent = msg;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  if (cards) {
    var e = document.createElement('div');
    e.className = 'admin-error';
    e.textContent = msg;
    cards.appendChild(e);
  }
}

function renderEmpty(tbody, cards, title, hint) {
  if (tbody) {
    var tr = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = 5;
    var wrap = document.createElement('div');
    wrap.className = 'admin-empty';
    var h = document.createElement('p');
    h.className = 'admin-empty-title';
    h.textContent = title;
    wrap.appendChild(h);
    if (hint) {
      var p = document.createElement('p');
      p.textContent = hint;
      wrap.appendChild(p);
    }
    td.appendChild(wrap);
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  if (cards) {
    var w = document.createElement('div');
    w.className = 'admin-empty';
    var h2 = document.createElement('p');
    h2.className = 'admin-empty-title';
    h2.textContent = title;
    w.appendChild(h2);
    if (hint) {
      var p2 = document.createElement('p');
      p2.textContent = hint;
      w.appendChild(p2);
    }
    cards.appendChild(w);
  }
}

// -------------------------------------------------------------------------
// buildTicketCard — kept for the mobile cards view + existing tests.
// Returns an <a> matching the previous contract:
//   - data-testid="ticket-card"
//   - data-ticket-id
//   - data-status
//   - href to ticket.html?id=…
// -------------------------------------------------------------------------
export function buildTicketCard(t) {
  var card = document.createElement('a');
  card.className = 'admin-ticket-card';
  card.href = 'ticket.html?id=' + encodeURIComponent(t.id);
  card.setAttribute('data-testid', 'ticket-card');
  card.setAttribute('data-ticket-id', t.id);
  card.setAttribute('data-status', t.status || '');

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

  var badge = makeBadge(ticketStatusLabel(t.status), statusBadgeClass('ticket', t.status));
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
// buildTicketRow — one <tr> for the new admin table. Same data
// attributes as buildTicketCard so analytics / tests can reuse them.
// -------------------------------------------------------------------------
export function buildTicketRow(t) {
  var tr = document.createElement('tr');
  tr.className = 'admin-table-row';
  tr.setAttribute('data-testid', 'ticket-card');   // keep compat with existing tests
  tr.setAttribute('data-ticket-id', t.id);
  tr.setAttribute('data-status', t.status || '');
  tr.setAttribute('tabindex', '0');
  tr.style.cursor = 'pointer';

  function go() { window.location.href = 'ticket.html?id=' + encodeURIComponent(t.id); }
  tr.addEventListener('click', go);
  tr.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      go();
    }
  });

  // Ticket ID
  var tdId = document.createElement('td');
  tdId.className = 'admin-table-cell-id';
  tdId.textContent = t.id;
  tr.appendChild(tdId);

  // Issue (title + kind)
  var tdTitle = document.createElement('td');
  var titleEl = document.createElement('span');
  titleEl.className = 'admin-table-cell-title';
  titleEl.textContent = t.title || '(no title)';
  titleEl.setAttribute('title', t.title || '');
  tdTitle.appendChild(titleEl);
  var meta = document.createElement('div');
  meta.className = 'admin-table-cell-meta';
  meta.textContent = ticketKindLabel(t.kind);
  tdTitle.appendChild(meta);
  tr.appendChild(tdTitle);

  // Resident
  var tdResident = document.createElement('td');
  tdResident.className = 'admin-table-cell-resident';
  tdResident.textContent = t.resident_name || 'Anonymous';
  tr.appendChild(tdResident);

  // Status badge
  var tdStatus = document.createElement('td');
  tdStatus.appendChild(makeBadge(ticketStatusLabel(t.status), statusBadgeClass('ticket', t.status)));
  tr.appendChild(tdStatus);

  // Updated
  var tdUpd = document.createElement('td');
  tdUpd.className = 'admin-table-cell-updated';
  tdUpd.textContent = formatRelative(t.created_at);
  tr.appendChild(tdUpd);

  return tr;
}

function makeBadge(text, cls) {
  var b = document.createElement('span');
  b.className = 'badge-inline ' + (cls || '');
  var dot = document.createElement('span');
  dot.className = 'dot';
  b.appendChild(dot);
  var lbl = document.createElement('span');
  lbl.textContent = text;
  b.appendChild(lbl);
  return b;
}

// -------------------------------------------------------------------------
// Data load — inquiries
// -------------------------------------------------------------------------
async function loadInquiries() {
  state.loading.inquiries = true;
  state.error.inquiries = null;
  if (state.activeTab === 'inquiries') renderInquiriesTable();

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
    if (state.activeTab === 'inquiries') renderInquiriesTable();
    else {
      var c2 = document.getElementById('inquiries-count');
      if (c2) c2.textContent = String(state.inquiries.length);
    }
  }
}

function renderInquiriesTable() {
  var tbody = document.getElementById('inquiry-tbody');
  var cards = document.getElementById('inquiry-cards');
  var countEl = document.getElementById('inquiries-count');
  if (countEl) countEl.textContent = String(state.inquiries.length);

  if (tbody) tbody.innerHTML = '';
  if (cards) cards.innerHTML = '';

  if (state.loading.inquiries) {
    renderSkeleton(tbody, cards, 4);
    return;
  }
  if (state.error.inquiries) {
    renderError(tbody, cards, friendlyErrorForStaff(state.error.inquiries, 'inquiries'));
    return;
  }
  if (state.inquiries.length === 0) {
    renderEmpty(tbody, cards, 'No inquiries match this filter', null);
    return;
  }
  state.inquiries.forEach(function (i) {
    var row = buildInquiryRow(i);
    if (tbody) tbody.appendChild(row);
    var card = buildInquiryCard(i);
    if (cards) cards.appendChild(card);
  });
}

export function buildInquiryRow(i) {
  var tr = document.createElement('tr');
  tr.className = 'admin-table-row';
  tr.setAttribute('data-inquiry-id', i.id);
  tr.setAttribute('data-status', i.status || '');

  var tdS = document.createElement('td');
  var titleEl = document.createElement('span');
  titleEl.className = 'admin-table-cell-title';
  titleEl.textContent = i.subject || '(no subject)';
  tdS.appendChild(titleEl);
  tr.appendChild(tdS);

  var tdR = document.createElement('td');
  tdR.className = 'admin-table-cell-resident';
  tdR.textContent = i.resident_name || 'Anonymous';
  tr.appendChild(tdR);

  var tdSt = document.createElement('td');
  tdSt.appendChild(makeBadge(inquiryStatusLabel(i.status), statusBadgeClass('inquiry', i.status)));
  tr.appendChild(tdSt);

  var tdL = document.createElement('td');
  tdL.className = 'admin-table-cell-updated';
  var lastT = i.last_message_at || i.created_at;
  tdL.textContent = formatRelative(lastT);
  tr.appendChild(tdL);

  return tr;
}

function buildInquiryCard(i) {
  var card = document.createElement('div');
  card.className = 'admin-ticket-card';
  card.setAttribute('data-inquiry-id', i.id);
  card.setAttribute('data-status', i.status || '');
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
  top.appendChild(makeBadge(inquiryStatusLabel(i.status), statusBadgeClass('inquiry', i.status)));
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
  meta.style.gap = 'var(--space-4)';
  meta.style.fontSize = 'var(--fs-sm)';
  meta.style.color = 'var(--text-muted)';
  var who = document.createElement('span');
  who.textContent = i.resident_name;
  meta.appendChild(who);
  var when = document.createElement('span');
  when.textContent = 'Last activity ' + formatRelative(i.last_message_at || i.created_at);
  meta.appendChild(when);
  card.appendChild(meta);
  return card;
}

// -------------------------------------------------------------------------
// Right rail — "All tickets" donut chart
//
// Replaces the older bar+legend renderer. One SVG donut showing the
// distribution of tickets by status, plus a compact legend below.
//
// Math: each segment is a <circle> stroked with stroke-dasharray so only
// `segmentLength` of the circumference is painted, starting at the
// cumulative offset. The whole group is rotated -90° around the center
// so 0° is 12 o'clock (the natural "start" of a donut).
// -------------------------------------------------------------------------

// Donut geometry — chosen so 1 SVG unit ≈ 1px at our 120×120 viewBox.
var DONUT = {
  size: 120,
  cx: 60,
  cy: 60,
  radius: 50,
  stroke: 14,
};

// 2π × radius — the length of the full circle, used as the dasharray gap.
function donutCircumference() {
  return 2 * Math.PI * DONUT.radius;
}

/**
 * Pure helper. Given a per-status count object, return one entry per
 * non-zero status in the documented order. Each entry has the math the
 * SVG renderer needs (segment length, offset). Tested in isolation.
 *
 *   donutSegments({pending: 30, in_process: 19, hold: 1, solved: 0})
 *     -> [
 *        { key:'pending',    label:'Pending',    count:30, fraction:0.6,   length:188.5, offset:0     },
 *        { key:'in_process', label:'In Process', count:19, fraction:0.38,  length:119.4, offset:-188.5},
 *        { key:'hold',       label:'On Hold',    count:1,  fraction:0.02,  length:6.3,   offset:-307.9},
 *        // solved omitted because count=0
 *      ]
 *
 * Returns [] if total is 0 — the renderer shows the empty state.
 */
export function donutSegments(counts) {
  var order = [
    { key: 'pending',    label: 'Pending' },
    { key: 'in_process', label: 'In Process' },
    { key: 'hold',       label: 'On Hold' },
    { key: 'solved',     label: 'Solved' },
  ];
  var total = 0;
  order.forEach(function (o) { total += (counts && counts[o.key]) || 0; });
  if (total <= 0) return [];

  var C = donutCircumference();
  var cumulative = 0;
  var out = [];
  order.forEach(function (o) {
    var c = (counts && counts[o.key]) || 0;
    if (c <= 0) return;
    var fraction = c / total;
    var length = fraction * C;
    out.push({
      key: o.key,
      label: o.label,
      count: c,
      fraction: fraction,
      length: length,
      offset: -cumulative,   // negative = clockwise from 12 o'clock
    });
    cumulative += length;
  });
  return out;
}

function renderOverviewDonut(countsOrTickets) {
  var root = document.getElementById('rail-overview-body');
  if (!root) return;
  root.innerHTML = '';

  // Accept either a pre-aggregated counts object (from
  // count_tickets_by_status) or a raw tickets array. The donut must
  // show the WHOLE table, not the paginated 50-row slice the table
  // list uses.
  var counts, total;
  if (countsOrTickets && !Array.isArray(countsOrTickets) && typeof countsOrTickets === 'object') {
    counts = {
      pending:    Number(countsOrTickets.pending)    || 0,
      in_process: Number(countsOrTickets.in_process) || 0,
      hold:       Number(countsOrTickets.hold)       || 0,
      solved:     Number(countsOrTickets.solved)     || 0,
    };
  } else {
    counts = { pending: 0, in_process: 0, hold: 0, solved: 0 };
    (countsOrTickets || []).forEach(function (t) {
      if (counts[t.status] != null) counts[t.status]++;
    });
  }
  total = counts.pending + counts.in_process + counts.hold + counts.solved;
  var segments = donutSegments(counts);

  // Build the donut wrapper (centered svg + legend below)
  var wrap = document.createElement('div');
  wrap.className = 'rail-overview-donut';
  wrap.setAttribute('data-testid', 'rail-overview-donut');
  root.appendChild(wrap);

  // ---- Donut SVG ----
  var C = donutCircumference();
  var svgNS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'rail-overview-donut-svg');
  svg.setAttribute('viewBox', '0 0 ' + DONUT.size + ' ' + DONUT.size);
  svg.setAttribute('role', 'img');

  // Status order — used for the legend and the accessible summary
  var order = [
    { key: 'pending',    label: 'Pending' },
    { key: 'in_process', label: 'In Process' },
    { key: 'hold',       label: 'On Hold' },
    { key: 'solved',     label: 'Solved' },
  ];

  // Accessible summary. Sentence-form, e.g. "All tickets: 30 pending, 19
  // in process, 1 on hold, 0 solved." — matches the legend below so
  // screen-reader users get the same information.
  var parts = order.map(function (o) { return counts[o.key] + ' ' + o.label.toLowerCase(); });
  svg.setAttribute('aria-label', 'All tickets: ' + parts.join(', '));
  wrap.appendChild(svg);

  // Track ring (the dim background that the segments sit on top of)
  var track = document.createElementNS(svgNS, 'circle');
  track.setAttribute('class', 'rail-overview-donut-track');
  track.setAttribute('cx', String(DONUT.cx));
  track.setAttribute('cy', String(DONUT.cy));
  track.setAttribute('r', String(DONUT.radius));
  svg.appendChild(track);

  // Group rotated -90° so 0° is at 12 o'clock
  var g = document.createElementNS(svgNS, 'g');
  g.setAttribute('transform', 'rotate(-90 ' + DONUT.cx + ' ' + DONUT.cy + ')');
  svg.appendChild(g);

  if (segments.length === 0) {
    // Empty state — a dashed ring with the message in the center
    track.setAttribute('stroke-dasharray', '4 6');
    var empty = document.createElementNS(svgNS, 'text');
    empty.setAttribute('class', 'rail-overview-donut-center-label');
    empty.setAttribute('x', String(DONUT.cx));
    empty.setAttribute('y', String(DONUT.cy + 3));
    empty.textContent = 'No tickets';
    svg.appendChild(empty);
  } else {
    // Segments
    segments.forEach(function (s) {
      var seg = document.createElementNS(svgNS, 'circle');
      seg.setAttribute('class', 'rail-overview-donut-segment');
      seg.setAttribute('data-status', s.key);
      seg.setAttribute('data-testid', 'donut-segment-' + s.key);
      seg.setAttribute('cx', String(DONUT.cx));
      seg.setAttribute('cy', String(DONUT.cy));
      seg.setAttribute('r', String(DONUT.radius));
      // gap = the rest of the circumference, painted as nothing
      seg.setAttribute('stroke-dasharray', s.length + ' ' + (C - s.length));
      // negative offset = shift the painted portion clockwise
      seg.setAttribute('stroke-dashoffset', String(s.offset));
      // Native SVG tooltip on hover (and screen-reader announcement)
      var title = document.createElementNS(svgNS, 'title');
      title.textContent = s.count + ' ' + s.label + ' (' +
        Math.round(s.fraction * 100) + '%)';
      seg.appendChild(title);
      g.appendChild(seg);
    });

    // Center label: total count + "tickets" / "ticket"
    var num = document.createElementNS(svgNS, 'text');
    num.setAttribute('class', 'rail-overview-donut-center');
    num.setAttribute('x', String(DONUT.cx));
    num.setAttribute('y', String(DONUT.cy - 2));
    num.setAttribute('font-size', '20');
    num.setAttribute('font-weight', '600');
    num.textContent = String(total);
    svg.appendChild(num);

    var lbl = document.createElementNS(svgNS, 'text');
    lbl.setAttribute('class', 'rail-overview-donut-center-label');
    lbl.setAttribute('x', String(DONUT.cx));
    lbl.setAttribute('y', String(DONUT.cy + 12));
    lbl.setAttribute('font-size', '8');
    lbl.textContent = total === 1 ? 'ticket' : 'tickets';
    svg.appendChild(lbl);
  }

  // ---- Legend ----
  // Same shape as the old bar+legend: dot + label + count, dimmed when 0.
  var legend = document.createElement('div');
  legend.className = 'rail-overview-list';
  legend.setAttribute('role', 'list');
  order.forEach(function (o) {
    var row = document.createElement('div');
    row.className = 'rail-overview-row';
    row.setAttribute('data-status', o.key);
    row.setAttribute('role', 'listitem');
    if (counts[o.key] === 0) row.classList.add('is-empty');
    var dot = document.createElement('span');
    dot.className = 'dot';
    row.appendChild(dot);
    var lbl2 = document.createElement('div');
    lbl2.className = 'rail-overview-row-label';
    lbl2.textContent = o.label;
    row.appendChild(lbl2);
    var cnt = document.createElement('div');
    cnt.className = 'rail-overview-row-count';
    cnt.textContent = String(counts[o.key]);
    row.appendChild(cnt);
    legend.appendChild(row);
  });
  wrap.appendChild(legend);
}

// -------------------------------------------------------------------------
// Right rail — recent activity
// -------------------------------------------------------------------------
async function loadActivity() {
  state.activityLoading = true;
  state.activityError = null;
  renderActivity();
  try {
    var c = await getClient();
    var rpc = c.rpc('list_recent_staff_activity', { p_limit: ACTIVITY_LIMIT });
    var data = await unwrap(await withTimeout(rpc, RPC_TIMEOUT_MS, 'list_recent_staff_activity'));
    state.activity = Array.isArray(data) ? data : [];
  } catch (err) {
    state.activityError = friendlyError(err);
  } finally {
    state.activityLoading = false;
    renderActivity();
  }
}

function renderActivity() {
  var list = document.getElementById('rail-activity-body');
  if (!list) return;
  list.innerHTML = '';

  if (state.activityLoading) {
    var li = document.createElement('li');
    li.className = 'admin-activity-empty';
    li.textContent = 'Loading…';
    list.appendChild(li);
    return;
  }
  if (state.activityError) {
    var li2 = document.createElement('li');
    li2.className = 'admin-activity-empty';
    li2.style.color = 'var(--status-error)';
    li2.textContent = friendlyErrorForStaff(state.activityError, 'activity');
    list.appendChild(li2);
    return;
  }
  if (state.activity.length === 0) {
    var li3 = document.createElement('li');
    li3.className = 'admin-activity-empty';
    li3.textContent = 'No activity yet — staff changes will appear here.';
    list.appendChild(li3);
    return;
  }
  state.activity.forEach(function (row) {
    list.appendChild(buildActivityRow(row));
  });
}

export function buildActivityRow(row) {
  var li = document.createElement('li');
  li.className = 'admin-activity-item';
  li.setAttribute('data-testid', 'activity-item');
  li.setAttribute('data-kind', row.kind || '');

  var iconWrap = document.createElement('div');
  iconWrap.className = 'admin-activity-icon kind-' + (row.kind || '');
  var iconName = row.kind === 'official_reply' ? 'message' : 'refresh';
  iconWrap.appendChild(icon(iconName, { size: 12 }));
  li.appendChild(iconWrap);

  var body = document.createElement('div');
  body.className = 'admin-activity-body';

  var text = document.createElement('div');
  text.className = 'admin-activity-text';
  // Build a sentence like:
  //   "Ticket CIV-DEMOB1 status: Pending → In Process"
  //   "Official reply on CIV-DEMOB1"
  var idSpan = document.createElement('span');
  idSpan.className = 'ticket-id';
  idSpan.textContent = row.ticket_id || '';
  if (row.kind === 'status_change') {
    text.appendChild(document.createTextNode('Ticket '));
    text.appendChild(idSpan);
    text.appendChild(document.createTextNode(' ' + (row.summary || 'Status changed')));
  } else if (row.kind === 'official_reply') {
    text.appendChild(document.createTextNode('Official reply on '));
    text.appendChild(idSpan);
  } else {
    text.appendChild(document.createTextNode(row.summary || 'Activity'));
  }
  body.appendChild(text);

  if (row.detail) {
    var detail = document.createElement('div');
    detail.className = 'admin-activity-text';
    detail.style.color = 'var(--text-muted)';
    detail.style.fontSize = 'var(--fs-xs)';
    detail.textContent = truncate(row.detail, 100);
    body.appendChild(detail);
  }

  var time = document.createElement('div');
  time.className = 'admin-activity-time';
  time.textContent = formatRelative(row.created_at);
  body.appendChild(time);

  li.appendChild(body);
  return li;
}

// -------------------------------------------------------------------------
// Realtime — debounce 250ms bursts
// -------------------------------------------------------------------------
function wireRealtime() {
  var tTimer = null;
  var iTimer = null;
  var aTimer = null;

  realtimeUnsubs.push(
    subscribeTickets(function () {
      if (tTimer) clearTimeout(tTimer);
      tTimer = setTimeout(function () { loadTickets(); }, 250);
      if (aTimer) clearTimeout(aTimer);
      aTimer = setTimeout(function () { loadActivity(); }, 250);
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
  var region = document.getElementById('admin-page');
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
