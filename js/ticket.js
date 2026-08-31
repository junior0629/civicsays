// =========================================================================
// CivicSays — ticket.js
// Phase 4: ticket detail page. Loads a ticket + comments + history in
// parallel, renders three sections, wires real-time updates, and provides
// a comment form that posts via the server-verified post_resident_comment
// RPC. Officials (signed in) get a status updater that PATCHes the ticket
// row — the DB trigger auto-appends a history row and a system comment.
// =========================================================================

import {
  getClient,
  getPublicUrl,
  unwrap,
  friendlyError,
  T,
} from './supabase.js';
import { getCurrentOfficial } from './auth.js';
import {
  isValidTrackingId,
  ticketStatusLabel,
  ticketKindLabel,
  statusBadgeClass,
  TICKET_STATUS_LABELS,
  formatDate,
  formatRelative,
  formatPhone,
} from './format.js';
import {
  subscribeTicket,
  subscribeTicketComments,
  subscribeTicketStatusHistory,
} from './realtime.js';
import {
  openLightbox,
  openModal,
  copyToClipboard,
  toast,
  buttonBusy,
} from './ui.js';
import { injectSprite, icon } from './icons.js';
import { signOut } from './auth.js';

// -------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------

const IDENTITY_KEY = 'civicsays.ticket.identity';
const MAX_COMMENT = 5000;

// -------------------------------------------------------------------------
// State (single source of truth for this page)
// -------------------------------------------------------------------------

var state = {
  id: null,             // current ticket ID
  ticket: null,         // row from `tickets`
  comments: [],         // rows from `ticket_comments` (ASC)
  history: [],          // rows from `ticket_status_history` (DESC)
  official: null,       // current signed-in official, or null
  attachmentUrl: null,  // public URL of the photo (or null)
  posting: false,       // debounce for comment form
  statusPosting: false, // debounce for status update
  teardown: [],         // functions to call on cleanup (realtime channels)
  staffSidebar: false,  // whether we mounted the staff sidebar
  staffMenu: null,      // the open status menu (for outside-click close)
};

// -------------------------------------------------------------------------
// DOM refs
// -------------------------------------------------------------------------

var region = document.getElementById('ticket-region');

// -------------------------------------------------------------------------
// Init
// -------------------------------------------------------------------------

injectSprite();

main().catch(function (err) {
  console.error('[civicsays:ticket] boot failed', err);
  showError('Something went wrong', 'We couldn\'t load this ticket. Please try again.');
});

// -------------------------------------------------------------------------
// Boot
// -------------------------------------------------------------------------

async function main() {
  state.id = readIdFromQuery();
  if (!state.id) {
    showError('Missing tracking ID',
              'Open the Track page and enter your tracking ID — it looks like CIV-XXXXXX.');
    return;
  }
  if (!isValidTrackingId(state.id)) {
    show404();
    return;
  }

  // Officials only matter if signed in. We swallow auth errors (signed-out
  // residents are the common case) and proceed as a resident.
  try {
    state.official = await getCurrentOfficial();
  } catch {
    state.official = null;
  }

  // When the viewer is an official, swap the public navbar for the staff
  // sidebar so this page is visually cohesive with admin.html. Residents
  // keep the public navbar (so /track.html links into this page look
  // like the same product as the rest of the public site).
  if (state.official) {
    mountStaffSidebar(state.official);
  }

  // 1. Parallel fetch — three queries, one round trip.
  try {
    await loadAll(state.id);
  } catch (err) {
    console.error('[civicsays:ticket] load failed', err);
    showError('Network error', 'Please check your connection and try again.');
    return;
  }

  if (!state.ticket) {
    show404();
    return;
  }

  // 2. Render.
  renderAll();

  // 3. Wire realtime (after first render so the UI is in place).
  wireRealtime(state.id);

  // 4. The comment form is built and wired inside buildCommentForm()
  //    (called by buildCommentsSection → renderAll). The status updater
  //    is also built and wired by wireStatusUpdater() below, which is
  //    a no-op for non-officials.
  wireStatusUpdater(state.id);
}

// -------------------------------------------------------------------------
// Data loading
// -------------------------------------------------------------------------

async function loadAll(id) {
  var c = await getClient();

  // Three parallel reads. maybeSingle() returns null for 0 rows instead of
  // throwing — important for distinguishing "doesn't exist" from "error".
  var results = await Promise.all([
    unwrap(c.from(T.TICKETS).select('*').eq('id', id).maybeSingle()),
    unwrap(c.from(T.TICKET_COMMENTS).select('*').eq('ticket_id', id)
            .order('created_at', { ascending: true })),
    unwrap(c.from(T.TICKET_STATUS_HISTORY).select('*').eq('ticket_id', id)
            .order('changed_at', { ascending: false })),
  ]);

  state.ticket = results[0] || null;
  state.comments = Array.isArray(results[1]) ? results[1] : [];
  state.history = Array.isArray(results[2]) ? results[2] : [];

  if (state.ticket && state.ticket.attachment_path) {
    state.attachmentUrl = await getPublicUrl(state.ticket.attachment_path);
  } else {
    state.attachmentUrl = null;
  }
}

// -------------------------------------------------------------------------
// Realtime
// -------------------------------------------------------------------------

function wireRealtime(id) {
  // Ticket row changes (status, etc.) — re-fetch and re-render header.
  state.teardown.push(subscribeTicket(id, function (payload) {
    if (payload && payload.eventType !== 'DELETE' && payload.new) {
      state.ticket = payload.new;
      renderHeader();
      renderStatusPipeline();
      renderActivityCard();
      renderHistory();
    }
  }));

  // New comments (including system comments from status changes).
  state.teardown.push(subscribeTicketComments(id, function (payload) {
    if (!payload || !payload.new) return;
    var row = payload.new;
    // Avoid duplicate if we just inserted optimistically — but we DON'T
    // optimistically insert in Phase 4, so a simple append is fine.
    if (!state.comments.some(function (c) { return c.id === row.id; })) {
      state.comments.push(row);
      // Re-render thread. To keep things simple, we re-render the whole
      // #comments-section — the lists are short.
      renderCommentsThread();
      renderActivityCard();   // also refresh the right-column digest
    }
  }));

  // New status-history rows — the DB trigger writes one of these every
  // time the status changes. Re-fetch the full list so we can show the
  // most-recent transition timestamp on the status pipeline.
  state.teardown.push(subscribeTicketStatusHistory(id, function (payload) {
    if (!payload || !payload.new) return;
    // Refetch the history (cheap — DESC ordered list, max a few rows)
    // and re-render the pipeline + activity card.
    (async () => {
      try {
        var c = await getClient();
        var fresh = await unwrap(
          c.from(T.TICKET_STATUS_HISTORY).select('*').eq('ticket_id', id)
            .order('changed_at', { ascending: false })
        );
        state.history = Array.isArray(fresh) ? fresh : [];
        renderStatusPipeline();
        renderActivityCard();
        renderHistory();
      } catch (err) {
        console.warn('[civicsays:ticket] history refetch failed', err);
      }
    })();
  }));
}

// -------------------------------------------------------------------------
// Rendering — top-level
// -------------------------------------------------------------------------

function renderAll() {
  if (!region) return;
  region.setAttribute('aria-busy', 'false');

  region.innerHTML = '';

  // Top-level 2-column grid: left = Resident panel, right = main content
  // (header + status pipeline + body grid). Comments stay full-width
  // because the conversation is the deep view, not a sidebar.
  var top = document.createElement('div');
  top.className = 'ticket-top';
  top.appendChild(buildResidentCard(state.ticket));
  top.appendChild(buildMainContent(state.ticket));
  region.appendChild(top);

  // History is rendered inside buildCommentsSection (compact timeline
  // appears above the comment thread). Keeping it in one card avoids
  // visual fragmentation of the audit trail.
  region.appendChild(buildCommentsSection(state.ticket));

  // Update page title to include the ID — nice for the browser tab and
  // for screen readers switching tabs.
  document.title = state.ticket.id + ' — CivicSays';
}

function renderHeader() {
  // Replace only the header node. Cheaper than a full re-render.
  var old = region && region.querySelector('.ticket-header');
  if (!old || !region) return;
  var fresh = buildHeader(state.ticket);
  region.replaceChild(fresh, old);
}

function renderStatusPipeline() {
  // Replace the pipeline. The pipeline is the only thing that needs to
  // refresh when the status enum changes — the header badge already shows
  // the label, and the activity card reads from `state.history` which is
  // re-rendered separately inside the comments section.
  var old = region && region.querySelector('.status-pipeline');
  if (!old || !region) return;
  var fresh = buildStatusPipeline(state.ticket);
  region.replaceChild(fresh, old);
}

function renderActivityCard() {
  // The Activity card lives inside the body grid. Easiest correct thing is
  // to re-render the whole body grid — both columns re-derive from
  // state.ticket and either column can shift (issue, attachments).
  var old = region && region.querySelector('.ticket-body-grid');
  if (!old || !region) return;
  var fresh = buildBodyGrid(state.ticket);
  region.replaceChild(fresh, old);
}

function renderHistory() {
  var old = region && region.querySelector('.status-history');
  if (!old || !region) return;
  // History card lives next to the comments section. The simplest correct
  // thing is to re-render the comments block (which embeds the history
  // timeline) — keeps the DOM structure in sync.
  renderCommentsThread();
}

function renderCommentsThread() {
  var old = region && region.querySelector('#comments-section');
  if (!old || !region) return;
  var fresh = buildCommentsSection(state.ticket);
  region.replaceChild(fresh, old);
}

// -------------------------------------------------------------------------
// Rendering — header
// -------------------------------------------------------------------------

function buildHeader(t) {
  // 4-column header: Ticket ID | Status | Category | Last Updated.
  // The filing time is shown on the status pipeline (under "Submitted"),
  // not here — keeps the header tight and avoids duplicate timestamps.
  var el = document.createElement('div');
  el.className = 'ticket-header';

  // ---- Column 1: Ticket ID ----
  var idCol = document.createElement('div');
  idCol.className = 'ticket-header-col ticket-header-col-id';

  var idLabel = document.createElement('div');
  idLabel.className = 'ticket-header-col-label';
  idLabel.textContent = 'Ticket ID';
  idCol.appendChild(idLabel);

  var idRow = document.createElement('div');
  idRow.className = 'ticket-header-id';
  idRow.appendChild(icon('ticket', { size: 14 }));
  var idCode = document.createElement('span');
  idCode.textContent = t.id;
  idRow.appendChild(idCode);
  var copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'icon-btn';
  copyBtn.style.width = '24px';
  copyBtn.style.height = '24px';
  copyBtn.setAttribute('aria-label', 'Copy tracking ID');
  copyBtn.appendChild(icon('copy', { size: 12 }));
  copyBtn.addEventListener('click', async function () {
    var ok = await copyToClipboard(t.id);
    if (ok) toast('Tracking ID copied', 'success', 1800);
    else toast('Could not copy. Select the ID manually.', 'error');
  });
  idRow.appendChild(copyBtn);
  idCol.appendChild(idRow);

  el.appendChild(idCol);

  // ---- Column 2: Status (icon + label + badge) ----
  var statusCol = document.createElement('div');
  statusCol.className = 'ticket-header-col';
  var statusLabel = document.createElement('div');
  statusLabel.className = 'ticket-header-col-label';
  statusLabel.textContent = 'Status';
  statusCol.appendChild(statusLabel);
  var statusValue = document.createElement('div');
  statusValue.className = 'ticket-header-col-value';
  statusValue.appendChild(icon('clock', { size: 14 }));
  statusValue.appendChild(makeBadge(ticketStatusLabel(t.status), statusBadgeClass('ticket', t.status)));
  statusCol.appendChild(statusValue);
  el.appendChild(statusCol);

  // ---- Column 3: Category (icon + label + badge) ----
  var catCol = document.createElement('div');
  catCol.className = 'ticket-header-col';
  var catLabel = document.createElement('div');
  catLabel.className = 'ticket-header-col-label';
  catLabel.textContent = 'Category';
  catCol.appendChild(catLabel);
  var catValue = document.createElement('div');
  catValue.className = 'ticket-header-col-value';
  catValue.appendChild(icon('grid', { size: 14 }));
  catValue.appendChild(makeBadge(ticketKindLabel(t.kind), 'badge-accent'));
  catCol.appendChild(catValue);
  el.appendChild(catCol);

  // ---- Column 4: Last Updated (clock icon + absolute time only) ----
  var updCol = document.createElement('div');
  updCol.className = 'ticket-header-col';
  var updLabel = document.createElement('div');
  updLabel.className = 'ticket-header-col-label';
  updLabel.textContent = 'Last updated';
  updCol.appendChild(updLabel);
  var updValue = document.createElement('div');
  updValue.className = 'ticket-header-col-value';
  updValue.appendChild(icon('clock', { size: 14 }));
  var updRel = document.createElement('span');
  updRel.className = 'ticket-header-col-value-rel';
  updRel.textContent = formatDate(t.updated_at || t.created_at);
  updValue.appendChild(updRel);
  updCol.appendChild(updValue);
  el.appendChild(updCol);

  return el;
}

function makeBadge(text, cls) {
  var b = document.createElement('span');
  b.className = 'badge ' + (cls || '');
  var dot = document.createElement('span');
  dot.className = 'dot';
  b.appendChild(dot);
  var label = document.createElement('span');
  label.textContent = text;
  b.appendChild(label);
  return b;
}

// -------------------------------------------------------------------------
// Rendering — body (info + issue)
// -------------------------------------------------------------------------

function buildBodyGrid(t) {
  var grid = document.createElement('div');
  grid.className = 'ticket-body-grid';

  // Primary: Issue (the centerpiece) — rendered first so it lands in the
  // wider left column at desktop widths.
  grid.appendChild(buildIssueCard(t));

  // Supporting: Activity (timeline + attachments) — narrower right column.
  // Replaces the former Resident card. Resident info (name/phone/email) is
  // still discoverable in the Comments section's author labels, and the
  // photo's final placement is pending design confirmation — see buildInfoCard
  // which is currently unused.
  grid.appendChild(buildActivityCard(t));

  return grid;
}

// -------------------------------------------------------------------------
// Rendering — status pipeline (4-step horizontal indicator)
//
// Maps the existing `status` enum (pending | in_process | hold | solved)
// to the 4 user-facing stages: Submitted → Waiting to Accept →
// In Progress → Resolved. The "hold" enum is rendered as In Progress
// active with a small "On Hold" badge so we don't lose the information.
// -------------------------------------------------------------------------

var PIPELINE_STAGES = [
  { key: 'submitted', label: 'Submitted',    icon: 'send' },
  { key: 'accepted',  label: 'Accepted',     icon: 'clock' },
  { key: 'progress',  label: 'In Progress',  icon: 'info' },
  { key: 'resolved',  label: 'Resolved',     icon: 'check-circle' },
];

function pipelineStateFor(ticket) {
  // Returns a state for each stage: 'done' | 'active' | 'pending'.
  // 'hold' status is treated as in-progress (active on stage 3) with a flag.
  var s = ticket.status;
  var onHold = s === 'hold';

  if (s === 'pending') {
    return { stages: ['done', 'active', 'pending', 'pending'], onHold: false };
  }
  if (s === 'in_process' || s === 'hold') {
    return { stages: ['done', 'done', 'active', 'pending'], onHold: onHold };
  }
  if (s === 'solved') {
    return { stages: ['done', 'done', 'done', 'active'], onHold: false };
  }
  // Unknown / future statuses: light up only Submitted.
  return { stages: ['done', 'pending', 'pending', 'pending'], onHold: false };
}

/**
 * Find the changed_at timestamp of the most recent history row that
 * matches the predicate. History is DESC by changed_at, so the first
 * match is the most recent.
 *
 * Used to attach a real "when did this happen?" timestamp to each
 * pipeline step without changing the schema.
 */
function findHistoryTimestamp(history, predicate) {
  if (!history || history.length === 0) return null;
  for (var i = 0; i < history.length; i++) {
    if (predicate(history[i])) return history[i].changed_at;
  }
  return null;
}

function pipelineTimestampsFor(t) {
  // Returns a timestamp (ISO string) for each of the 4 stages, or null
  // if that step hasn't happened yet.
  //
  // - Submitted:   from the ticket's created_at
  // - Accepted:    from the first history row whose from_status was
  //                'pending' (the official pulled the ticket out of
  //                the queue). With the current schema this is the
  //                same as "moved to in_process" — which is fine.
  // - In Progress: first history row whose to_status is 'in_process'
  //                (work started).
  // - Resolved:    first history row whose to_status is 'solved'.
  var h = state.history || [];
  return {
    submitted: t.created_at,
    accepted:  findHistoryTimestamp(h, function (r) { return r.from_status === 'pending' && r.to_status !== 'pending'; }),
    progress:  findHistoryTimestamp(h, function (r) { return r.to_status === 'in_process'; }),
    resolved:  findHistoryTimestamp(h, function (r) { return r.to_status === 'solved'; }),
  };
}

function buildStatusPipeline(t) {
  var el = document.createElement('div');
  el.className = 'status-pipeline';
  el.setAttribute('aria-label', 'Ticket progress');
  el.setAttribute('role', 'list');

  var state_ = pipelineStateFor(t);
  var ts = pipelineTimestampsFor(t);
  var lastIndex = PIPELINE_STAGES.length - 1;

  PIPELINE_STAGES.forEach(function (stage, i) {
    var step = document.createElement('div');
    step.className = 'status-pipeline-step is-' + state_.stages[i];
    step.setAttribute('role', 'listitem');

    // Icon circle
    var iconWrap = document.createElement('div');
    iconWrap.className = 'status-pipeline-icon';
    iconWrap.appendChild(icon(stage.icon, { size: 16 }));
    step.appendChild(iconWrap);

    // Label + sub-line
    var labelWrap = document.createElement('div');
    labelWrap.className = 'status-pipeline-label-wrap';
    labelWrap.style.minWidth = '0';
    labelWrap.style.overflow = 'hidden';
    var label = document.createElement('div');
    label.className = 'status-pipeline-label';
    label.textContent = stage.label;
    labelWrap.appendChild(label);

    // Sub-line:
    //   - Submitted: filing time (t.created_at)
    //   - Accepted: timestamp of the first exit-from-pending transition
    //   - In Progress: timestamp of the first transition to in_process
    //   - Resolved: timestamp of the first transition to solved
    // Each step shows its timestamp only when that step has happened
    // (state === 'done' or 'active'); pending steps show "—".
    var stepTs = ts[stage.key];
    if (state_.stages[i] !== 'pending' && stepTs) {
      var sub = document.createElement('div');
      sub.className = 'status-pipeline-sub';
      sub.textContent = formatDate(stepTs);
      labelWrap.appendChild(sub);
    } else if (state_.stages[i] === 'pending') {
      var sub = document.createElement('div');
      sub.className = 'status-pipeline-sub is-pending';
      sub.textContent = '—';
      sub.setAttribute('aria-hidden', 'true');
      labelWrap.appendChild(sub);
    } else if (state_.onHold && i === 2) {
      var subHold = document.createElement('div');
      subHold.className = 'status-pipeline-sub is-hold';
      subHold.textContent = 'On Hold';
      labelWrap.appendChild(subHold);
    }
    step.appendChild(labelWrap);

    el.appendChild(step);

    // Connector line — not after the last step
    if (i < lastIndex) {
      var conn = document.createElement('div');
      conn.className = 'status-pipeline-connector';
      // Connector is "done" if the *current* stage is done (i.e. the
      // following stage is at least active).
      var nextState = state_.stages[i + 1];
      if (state_.stages[i] === 'done') conn.classList.add('is-done');
      el.appendChild(conn);
    }
  });

  return el;
}

function buildInfoCard(t) {
  // (Legacy) Resident card with photo. Currently unused — the photo
  // belongs in the Issue card, but we keep this function around so the
  // move is a one-line change once design is finalized. See
  // buildResidentCard for the current, photo-less version that renders
  // in the left side panel.
  var card = document.createElement('div');
  card.className = 'ticket-section';

  var title = document.createElement('h2');
  title.className = 'ticket-section-title';
  title.textContent = 'Resident';
  card.appendChild(title);

  var list = document.createElement('div');
  list.className = 'kv-list';
  list.appendChild(makeKV('Name', t.resident_name || '—'));
  list.appendChild(makeKV('Phone', t.resident_phone ? formatPhone(t.resident_phone) : '—'));
  list.appendChild(makeKV('Email', t.resident_email || '—'));
  card.appendChild(list);

  if (state.attachmentUrl) {
    var media = document.createElement('div');
    media.className = 'media-block';
    var label = document.createElement('div');
    label.className = 'media-block-label';
    label.textContent = 'Photo';
    media.appendChild(label);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'media-photo-button';
    btn.setAttribute('aria-label', state.official
      ? 'View attachment in full size'
      : 'View attachment');
    var img = document.createElement('img');
    img.className = 'media-photo';
    img.src = state.attachmentUrl;
    img.alt = 'Ticket attachment';
    img.loading = 'lazy';
    btn.appendChild(img);
    btn.addEventListener('click', function () {
      openLightbox(state.attachmentUrl, 'Ticket attachment');
    });
    media.appendChild(btn);
    var hint = document.createElement('div');
    hint.className = 'media-photo-hint';
    hint.textContent = state.official ? 'Click to inspect' : 'Click to view';
    media.appendChild(hint);
    card.appendChild(media);
  }

  return card;
}

function buildResidentCard(t) {
  // Resident side panel — matches the design mock: a person icon next to
  // the title, then a list of icon + label + value rows. Rows:
  //   Name, Phone, Email, Location.
  // The photo lives elsewhere (the Issue card, in a follow-up pass).
  var card = document.createElement('aside');
  card.className = 'resident-panel ticket-section';
  card.setAttribute('aria-label', 'Resident information');

  // Title with leading icon. We wrap the SVG in an inline-flex span so
  // it sits on the same baseline as the text — without the wrapper, the
  // global `svg { display: block }` rule in base.css pushes the icon
  // onto its own line.
  var title = document.createElement('h2');
  title.className = 'ticket-section-title';
  var titleIconWrap = document.createElement('span');
  titleIconWrap.className = 'ticket-section-title-icon';
  titleIconWrap.appendChild(icon('user', { size: 14 }));
  title.appendChild(titleIconWrap);
  title.appendChild(document.createTextNode('Resident Information'));
  card.appendChild(title);

  // Rows: each is a flex row with [icon] [label] [value].
  // All four rows are resident-specific: Name, Phone, Email, Address.
  // The issue's Location is shown in the Activity card (right column,
  // after the attachments) since it belongs to the issue, not the
  // resident.
  var rows = document.createElement('div');
  rows.className = 'resident-rows';
  rows.appendChild(buildResidentRow('user',      'Name',     t.resident_name  || '—'));
  rows.appendChild(buildResidentRow('phone',     'Phone',    t.resident_phone ? formatPhone(t.resident_phone) : '—'));
  rows.appendChild(buildResidentRow('mail',      'Email',    t.resident_email || '—'));
  rows.appendChild(buildResidentRow('home',      'Address',  t.resident_address || '—'));
  card.appendChild(rows);

  return card;
}

function buildResidentRow(iconKey, label, value) {
  var row = document.createElement('div');
  row.className = 'resident-row';

  var iconWrap = document.createElement('span');
  iconWrap.className = 'resident-row-icon';
  iconWrap.appendChild(icon(iconKey, { size: 14 }));
  row.appendChild(iconWrap);

  var lbl = document.createElement('span');
  lbl.className = 'resident-row-label';
  lbl.textContent = label;
  row.appendChild(lbl);

  var val = document.createElement('span');
  val.className = 'resident-row-value';
  val.textContent = value;
  row.appendChild(val);

  return row;
}

function buildMainContent(t) {
  // Wraps header + status pipeline + body grid into a single column.
  // The left side panel (Resident) is a sibling of this wrapper; together
  // they form a 2-column desktop grid.
  var wrap = document.createElement('div');
  wrap.className = 'ticket-main';
  wrap.appendChild(buildHeader(t));
  wrap.appendChild(buildStatusPipeline(t));
  wrap.appendChild(buildBodyGrid(t));
  return wrap;
}

function makeKV(key, value) {
  var kv = document.createElement('div');
  kv.className = 'kv';
  var k = document.createElement('div');
  k.className = 'kv-key';
  k.textContent = key;
  var v = document.createElement('div');
  v.className = 'kv-value';
  v.textContent = value;
  kv.appendChild(k);
  kv.appendChild(v);
  return kv;
}

function buildIssueCard(t) {
  var card = document.createElement('div');
  card.className = 'ticket-section is-primary';

  var title = document.createElement('h2');
  title.className = 'ticket-section-title';
  title.textContent = 'Issue Details';
  card.appendChild(title);

  var h = document.createElement('div');
  h.className = 'ticket-title';
  h.textContent = t.title || '—';
  card.appendChild(h);

  // Description with optional "Full view" expand affordance. Long
  // descriptions start collapsed (line-clamp) and reveal the rest
  // when the user clicks the button. Short descriptions skip the
  // button entirely.
  var desc = buildDescriptionWithFullView(t.description || '');
  card.appendChild(desc);

  return card;
}

/**
 * Build the issue description as a collapsible block.
 * - If the text is short (≤ ~3 lines at --fs-lg / 72ch), renders as a
 *   plain <p> with no button.
 * - If the text is long, renders with -webkit-line-clamp and a
 *   "Full view" / "Show less" toggle.
 *
 * @param {string} text
 * @returns {HTMLElement}
 */
function buildDescriptionWithFullView(text) {
  // Heuristic for "long enough to need a Full view": > 240 chars OR
  // more than 3 newlines. Cheap to evaluate, good enough signal.
  var needsCollapse = text.length > 240 || (text.match(/\n/g) || []).length > 3;

  if (!needsCollapse) {
    var p = document.createElement('p');
    p.className = 'ticket-description';
    p.textContent = text;
    return p;
  }

  var wrap = document.createElement('div');
  wrap.className = 'description-full-view';

  var body = document.createElement('p');
  body.className = 'ticket-description is-collapsed';
  body.textContent = text;
  wrap.appendChild(body);

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'description-toggle btn btn-ghost btn-sm';
  btn.textContent = 'Full view';
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', '');
  btn.addEventListener('click', function () {
    var isCollapsed = body.classList.toggle('is-collapsed');
    var expanded = !isCollapsed;
    btn.textContent = expanded ? 'Show less' : 'Full view';
    btn.setAttribute('aria-expanded', String(expanded));
  });
  wrap.appendChild(btn);

  return wrap;
}

// -------------------------------------------------------------------------
// Rendering — Activity card (right column).
// A compact digest of the most recent events (submitted, status changes,
// comments) plus a small list of attachment links. Stops the right column
// from reading as empty space when the Issue card is long.
// -------------------------------------------------------------------------

function buildActivityCard(t) {
  var card = document.createElement('div');
  card.className = 'ticket-section activity-card';

  var title = document.createElement('h2');
  title.className = 'ticket-section-title';
  title.textContent = 'Activity';
  card.appendChild(title);

  // ---- Timeline section ----
  var tlLabel = document.createElement('div');
  tlLabel.className = 'activity-section-label';
  tlLabel.textContent = 'Recent activity';
  card.appendChild(tlLabel);

  var tlList = document.createElement('div');
  tlList.className = 'activity-list';
  var events = collectRecentEvents(t);
  if (events.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'activity-empty';
    empty.textContent = 'No activity yet.';
    tlList.appendChild(empty);
  } else {
    events.forEach(function (e) {
      tlList.appendChild(buildActivityRow(e));
    });
  }
  card.appendChild(tlList);

  // ---- Divider ----
  var div1 = document.createElement('div');
  div1.className = 'activity-divider';
  card.appendChild(div1);

  // ---- Attachments section ----
  var atLabel = document.createElement('div');
  atLabel.className = 'activity-section-label';
  atLabel.textContent = 'Attachments';
  card.appendChild(atLabel);

  var atList = document.createElement('div');
  atList.className = 'activity-attachment-list';
  var atCount = 0;
  if (state.attachmentUrl) {
    atList.appendChild(buildAttachmentButton({
      kind: 'photo',
      icon: 'image',
      name: 'View photo',
      onClick: function () { openLightbox(state.attachmentUrl, 'Ticket attachment'); },
    }));
    atCount++;
  }
  if (t.video_link) {
    atList.appendChild(buildAttachmentButton({
      kind: 'video',
      icon: 'video',
      name: 'Open video link',
      onClick: function () { window.open(t.video_link, '_blank', 'noopener,noreferrer'); },
    }));
    atCount++;
  }
  if (atCount === 0) {
    var atEmpty = document.createElement('div');
    atEmpty.className = 'activity-empty';
    atEmpty.textContent = 'No attachments.';
    atList.appendChild(atEmpty);
  }
  card.appendChild(atList);

  // ---- Issue location section ----
  // Lives in the Activity card (right column) per the latest design:
  // resident info (name, phone, email, address) belongs in the
  // Resident panel; the issue's location belongs alongside the other
  // issue metadata. Shown as a single read-only row.
  if (t.location) {
    var div2 = document.createElement('div');
    div2.className = 'activity-divider';
    card.appendChild(div2);

    var locLabel = document.createElement('div');
    locLabel.className = 'activity-section-label';
    locLabel.textContent = 'Issue location';
    card.appendChild(locLabel);

    var locRow = document.createElement('div');
    locRow.className = 'activity-location';
    var locIcon = document.createElement('span');
    locIcon.className = 'activity-location-icon';
    locIcon.appendChild(icon('map-pin', { size: 14 }));
    locRow.appendChild(locIcon);
    var locText = document.createElement('span');
    locText.className = 'activity-location-text';
    locText.textContent = t.location;
    locRow.appendChild(locText);
    card.appendChild(locRow);
  }

  return card;
}

function buildActivityRow(event) {
  var row = document.createElement('div');
  row.className = 'activity-row';
  var iconWrap = document.createElement('div');
  iconWrap.className = 'activity-row-icon';
  iconWrap.appendChild(icon(event.icon, { size: 14 }));
  row.appendChild(iconWrap);
  var text = document.createElement('div');
  text.className = 'activity-row-text';
  text.textContent = event.text;
  row.appendChild(text);
  var time = document.createElement('span');
  time.className = 'activity-row-time';
  time.textContent = formatRelative(event.at);
  time.title = formatDate(event.at);
  time.setAttribute('aria-label', formatDate(event.at));
  row.appendChild(time);
  return row;
}

function buildAttachmentButton(opts) {
  // Render as a <button> for keyboard / a11y. Always a separate clickable
  // row, never a thumbnail — the photo lives elsewhere (currently in
  // buildInfoCard, slated to move into the Issue card).
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'activity-attachment';
  btn.setAttribute('aria-label', opts.name);

  var iconWrap = document.createElement('span');
  iconWrap.className = 'activity-attachment-icon';
  iconWrap.appendChild(icon(opts.icon, { size: 16 }));
  btn.appendChild(iconWrap);

  var name = document.createElement('span');
  name.className = 'activity-attachment-name';
  name.textContent = opts.name;
  btn.appendChild(name);

  // Trailing chevron to signal "open / navigate"
  var chev = document.createElement('span');
  chev.className = 'activity-attachment-icon';
  chev.appendChild(icon('arrow-right', { size: 14 }));
  btn.appendChild(chev);

  btn.addEventListener('click', opts.onClick);
  return btn;
}

/**
 * Collect the most recent events for the activity digest.
 * Always includes the submit event; adds the most recent status change
 * (if any) and the most recent comment (if any). Capped at 3 rows.
 */
function collectRecentEvents(t) {
  var events = [];

  // 1. Submission
  events.push({
    icon: 'send',
    text: 'Ticket submitted',
    at: t.created_at,
  });

  // 2. Most recent status change (if any history)
  if (state.history && state.history.length > 0) {
    var lastHist = state.history[0]; // DESC by changed_at
    var fromLabel = lastHist.from_status ? ticketStatusLabel(lastHist.from_status) : 'New';
    var toLabel = ticketStatusLabel(lastHist.to_status);
    events.push({
      icon: 'info',
      text: 'Status: ' + fromLabel + ' → ' + toLabel,
      at: lastHist.changed_at,
    });
  }

  // 3. Most recent non-system comment
  if (state.comments && state.comments.length > 0) {
    // comments are ASC; last is most recent
    for (var i = state.comments.length - 1; i >= 0; i--) {
      var c = state.comments[i];
      if (c.author_role === 'system') continue;
      events.push({
        icon: 'message',
        text: 'Comment from ' + (c.author_name || 'someone'),
        at: c.created_at,
      });
      break;
    }
  }

  // Cap at 3 (most recent by insertion order, then re-sort by date DESC)
  events.sort(function (a, b) {
    return new Date(b.at).getTime() - new Date(a.at).getTime();
  });
  return events.slice(0, 3);
}

// -------------------------------------------------------------------------
// Rendering — comments + history
// -------------------------------------------------------------------------

function buildCommentsSection(t) {
  var card = document.createElement('div');
  card.className = 'ticket-section';
  card.id = 'comments-section';

  // Header
  var header = document.createElement('div');
  header.className = 'card-header';
  var title = document.createElement('h2');
  title.className = 'ticket-section-title';
  title.style.marginBottom = '0';
  title.textContent = 'Comments';
  header.appendChild(title);
  var count = document.createElement('span');
  count.className = 'badge';
  count.textContent = String(state.comments.length);
  header.appendChild(count);
  card.appendChild(header);

  // History timeline (status changes) — small compact list
  if (state.history.length > 0) {
    card.appendChild(buildHistoryTimeline());
  }

  // Comments thread
  var thread = document.createElement('div');
  thread.className = 'thread';
  if (state.comments.length === 0) {
    thread.appendChild(buildEmptyComments());
  } else {
    state.comments.forEach(function (c) {
      thread.appendChild(buildComment(c, t));
    });
  }
  card.appendChild(thread);

  // Comment form
  if (!state.official) {
    card.appendChild(buildCommentForm(t));
  } else {
    card.appendChild(buildOfficialNotice());
  }

  return card;
}

function buildEmptyComments() {
  var wrap = document.createElement('div');
  wrap.className = 'empty-state';
  wrap.style.padding = 'var(--space-8) var(--space-4)';
  wrap.appendChild(icon('message', { size: 32 }));
  var t = document.createElement('div');
  t.className = 'empty-state-title';
  t.textContent = 'No comments yet';
  wrap.appendChild(t);
  var s = document.createElement('div');
  s.className = 'empty-state-text';
  s.textContent = 'Use the form below to add an update or follow-up question.';
  wrap.appendChild(s);
  return wrap;
}

function buildComment(c, ticket) {
  var el = document.createElement('div');
  el.className = 'comment';
  if (c.author_role === 'official') el.classList.add('is-official');
  if (c.author_role === 'system') el.classList.add('is-system');

  if (c.author_role !== 'system') {
    // Avatar circle with the author's initials, colored by role. Gives the
    // card a visual anchor on the left and makes the conversation feel
    // like a real thread (each speaker has a face, however abstract).
    var avatar = document.createElement('div');
    avatar.className = 'comment-avatar';
    avatar.textContent = initialsFromName(c.author_name);
    avatar.setAttribute('aria-hidden', 'true');
    el.appendChild(avatar);

    var main = document.createElement('div');
    main.className = 'comment-main';

    var header = document.createElement('div');
    header.className = 'comment-header';
    var author = document.createElement('span');
    author.className = 'comment-author';
    author.textContent = c.author_name || 'Unknown';
    header.appendChild(author);
    // Role badge — both roles get a tinted badge so they're visible at
    // a glance. Official is full-accent; Resident is a soft accent tint.
    var role = document.createElement('span');
    role.className = 'comment-role-badge ' + (c.author_role === 'official' ? 'is-official' : 'is-resident');
    role.textContent = c.author_role === 'official' ? 'Official' : 'Resident';
    header.appendChild(role);
    var time = document.createElement('span');
    time.className = 'comment-time';
    time.textContent = formatRelative(c.created_at);
    time.title = formatDate(c.created_at);
    header.appendChild(time);
    main.appendChild(header);

    var body = document.createElement('div');
    body.className = 'comment-body';
    body.textContent = c.body || '';
    main.appendChild(body);

    el.appendChild(main);
  } else {
    // System messages stay simple — no avatar, no role badge.
    var body = document.createElement('div');
    body.className = 'comment-body';
    body.textContent = c.body || '';
    el.appendChild(body);
  }

  return el;
}

/**
 * Get up to 2 uppercase initials from a person's name.
 * "Renato Maria Lourdes Yepes" -> "RM", "Jane Doe" -> "JD", "cher" -> "C".
 *
 * @param {string|null} name
 * @returns {string}
 */
function initialsFromName(name) {
  if (!name) return '?';
  var parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function buildHistoryTimeline() {
  var box = document.createElement('div');
  box.className = 'status-history';
  var h = document.createElement('div');
  h.className = 'status-history-title';
  h.appendChild(icon('history', { size: 14 }));
  h.appendChild(document.createTextNode('Status history'));
  box.appendChild(h);
  state.history.forEach(function (row) {
    var item = document.createElement('div');
    item.className = 'status-history-item';
    var dot = document.createElement('span');
    dot.className = 'dot';
    item.appendChild(dot);
    var label = document.createElement('span');
    label.className = 'label';
    var fromLabel = row.from_status ? ticketStatusLabel(row.from_status) : 'New';
    var toLabel = ticketStatusLabel(row.to_status);
    label.textContent = fromLabel + ' → ' + toLabel;
    item.appendChild(label);
    var by = document.createElement('span');
    by.className = 'text-muted';
    by.textContent = ' · ' + (row.changed_by_name || '—');
    item.appendChild(by);
    var time = document.createElement('span');
    time.className = 'time';
    time.textContent = formatRelative(row.changed_at);
    time.title = formatDate(row.changed_at);
    item.appendChild(time);
    box.appendChild(item);
  });
  return box;
}

function buildCommentForm(ticket) {
  var form = document.createElement('form');
  form.id = 'comment-form';
  form.noValidate = true;
  form.style.marginTop = 'var(--space-4)';
  form.style.paddingTop = 'var(--space-4)';
  form.style.borderTop = '1px solid var(--border-default)';
  form.setAttribute('aria-label', 'Post a comment');

  // Staff (signed-in officials) post under their signed-in identity, so
  // they don't see the name/phone fields. Residents still do.
  var isOfficial = !!state.official;

  var grid = document.createElement('div');
  grid.className = 'form-grid';

  // Name (residents only)
  var nameInput = null;
  if (!isOfficial) {
    var nameField = document.createElement('div');
    nameField.className = 'field';
    var nameLabel = document.createElement('label');
    nameLabel.className = 'field-label';
    nameLabel.htmlFor = 'c-name';
    nameLabel.textContent = 'Your name';
    nameField.appendChild(nameLabel);
    nameInput = document.createElement('input');
    nameInput.className = 'input';
    nameInput.type = 'text';
    nameInput.id = 'c-name';
    nameInput.name = 'name';
    nameInput.maxLength = 100;
    nameInput.required = true;
    nameInput.autocomplete = 'name';
    nameInput.placeholder = 'Jane Doe';
    nameInput.setAttribute('aria-describedby', 'err-c-name');
    nameField.appendChild(nameInput);
    var nameErr = document.createElement('span');
    nameErr.className = 'field-error';
    nameErr.id = 'err-c-name';
    nameErr.setAttribute('role', 'alert');
    nameField.appendChild(nameErr);
    grid.appendChild(nameField);
  }

  // Phone (residents only)
  var phoneInput = null;
  if (!isOfficial) {
    var phoneField = document.createElement('div');
    phoneField.className = 'field';
    var phoneLabel = document.createElement('label');
    phoneLabel.className = 'field-label';
    phoneLabel.htmlFor = 'c-phone';
    phoneLabel.textContent = 'Phone';
    phoneField.appendChild(phoneLabel);
    phoneInput = document.createElement('input');
    phoneInput.className = 'input';
    phoneInput.type = 'tel';
    phoneInput.id = 'c-phone';
    phoneInput.name = 'phone';
    phoneInput.maxLength = 11;
    phoneInput.required = true;
    phoneInput.inputMode = 'numeric';
    phoneInput.autocomplete = 'tel';
    phoneInput.placeholder = '09120880629';
    phoneInput.setAttribute('aria-describedby', 'err-c-phone');
    phoneField.appendChild(phoneInput);
    var phoneErr = document.createElement('span');
    phoneErr.className = 'field-error';
    phoneErr.id = 'err-c-phone';
    phoneErr.setAttribute('role', 'alert');
    phoneField.appendChild(phoneErr);
    grid.appendChild(phoneField);
  }

  if (!isOfficial) form.appendChild(grid);

  // Body (always)
  var bodyField = document.createElement('div');
  bodyField.className = 'field';
  bodyField.style.marginTop = 'var(--space-4)';
  var bodyLabel = document.createElement('label');
  bodyLabel.className = 'field-label';
  bodyLabel.htmlFor = 'c-body';
  bodyLabel.textContent = isOfficial ? 'Official reply' : 'Comment';
  bodyField.appendChild(bodyLabel);
  var bodyInput = document.createElement('textarea');
  bodyInput.className = 'textarea';
  bodyInput.id = 'c-body';
  bodyInput.name = 'body';
  bodyInput.rows = 4;
  bodyInput.maxLength = MAX_COMMENT;
  bodyInput.required = true;
  bodyInput.placeholder = isOfficial
    ? 'Reply to the resident. Your name will appear as ' + state.official.full_name + '.'
    : 'Add an update, follow-up, or new information about this ticket.';
  bodyInput.setAttribute('aria-describedby', 'hint-c-body err-c-body');
  bodyField.appendChild(bodyInput);
  var bodyHint = document.createElement('span');
  bodyHint.className = 'field-hint';
  bodyHint.id = 'hint-c-body';
  var bodyCount = document.createElement('span');
  bodyCount.id = 'c-body-count';
  bodyCount.textContent = '0';
  bodyHint.appendChild(bodyCount);
  bodyHint.appendChild(document.createTextNode(' / ' + MAX_COMMENT));
  bodyField.appendChild(bodyHint);

  if (isOfficial) {
    // Mirror the "you're posting as X" hint shown on admin forms.
    var as = document.createElement('span');
    as.className = 'field-hint comment-as-official';
    as.textContent = 'Posting as ' + state.official.full_name + ' (official)';
    bodyField.appendChild(as);
  }

  var bodyErr = document.createElement('span');
  bodyErr.className = 'field-error';
  bodyErr.id = 'err-c-body';
  bodyErr.setAttribute('role', 'alert');
  bodyField.appendChild(bodyErr);
  form.appendChild(bodyField);

  // Actions
  var actions = document.createElement('div');
  actions.className = 'form-actions';
  actions.style.borderTop = 'none';
  actions.style.marginTop = 'var(--space-4)';
  actions.style.paddingTop = '0';
  var btn = document.createElement('button');
  btn.className = 'btn btn-primary';
  btn.type = 'submit';
  btn.id = 'comment-submit';
  btn.dataset.busyText = 'Posting…';
  btn.setAttribute('data-testid', 'post-comment');
  btn.appendChild(icon('send', { size: 14 }));
  var btnLabel = document.createElement('span');
  btnLabel.textContent = 'Post comment';
  btn.appendChild(btnLabel);
  actions.appendChild(btn);
  form.appendChild(actions);

  // Pre-fill from sessionStorage cache (if present) and from the ticket row
  // (the ticket has the original submitter's name+phone). Residents only —
  // officials post under their signed-in identity.
  if (!isOfficial) {
    var identity = readIdentity();
    if (identity && identity.name) nameInput.value = identity.name;
    if (identity && identity.phone) phoneInput.value = identity.phone;
    // If the cached identity doesn't match the ticket, prefer the ticket's.
    if (ticket.resident_name && nameInput.value !== ticket.resident_name) {
      nameInput.value = ticket.resident_name;
    }
    if (ticket.resident_phone && phoneInput.value !== ticket.resident_phone) {
      phoneInput.value = ticket.resident_phone;
    }
  }

  // Live counter
  bodyInput.addEventListener('input', function () {
    bodyCount.textContent = String(bodyInput.value.length);
    clearFieldError('c-body');
  });
  if (!isOfficial) {
    [nameInput, phoneInput].forEach(function (el) {
      el.addEventListener('input', function () { clearFieldError(el.id); });
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    onCommentSubmit(form, btn, ticket);
  });

  return form;
}

function buildOfficialNotice() {
  var p = document.createElement('p');
  p.className = 'text-muted';
  p.style.fontSize = 'var(--fs-sm)';
  p.style.marginTop = 'var(--space-4)';
  p.style.paddingTop = 'var(--space-4)';
  p.style.borderTop = '1px solid var(--border-default)';
  p.textContent = 'Signed in as an official. Use the status updater above and add official replies from the admin dashboard.';
  return p;
}

// -------------------------------------------------------------------------
// Rendering — status updater (officials only).
// The 3-dot menu version lives further down in this file (after the staff
// sidebar mount block) so the staff-side UI is colocated. wireStatusUpdater
// still finds the updater in the .ticket-header, exactly like before.
// -------------------------------------------------------------------------

function wireStatusUpdater(id) {
  // Find the header's badges row and slot the updater after it. The header
  // is a single .ticket-header element; we use a MutationObserver-free
  // approach by re-rendering on demand, but the initial render needs the
  // updater visible immediately for officials.
  if (!state.official) return;
  var header = region && region.querySelector('.ticket-header');
  if (!header) return;
  var updater = buildStatusUpdater();
  if (updater) header.appendChild(updater);
}

// -------------------------------------------------------------------------
// Staff sidebar mount (replaces public navbar when an official is signed in)
//
// Visual cohesion with admin.html: the ticket detail page should look
// "inside" the same product. We:
//   1. Remove the existing <nav class="navbar"> and let the body collapse
//      to the new shell via .has-admin-sidebar
//   2. Insert the same .admin-sidebar / .admin-shell / .admin-header /
//      .admin-rightrail pieces used by admin.html (without the rail
//      cards — those don't make sense on a per-ticket page)
//   3. Mount the existing #ticket-region inside .admin-main
//   4. Add a "Back to dashboard" breadcrumb above the ticket content
//
// The sidebar is kept DOM-minimal — no tablist (this is not a tab page),
// just the same brand + nav + account chip so the visual language is
// consistent end-to-end.
// -------------------------------------------------------------------------

function initialsOf(name) {
  if (!name) return '?';
  var parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function buildStaffSidebar(official) {
  var aside = document.createElement('aside');
  aside.className = 'admin-sidebar';
  aside.id = 'admin-sidebar';
  aside.setAttribute('aria-label', 'Primary');

  // ---- Brand
  var brand = document.createElement('div');
  brand.className = 'admin-sidebar-brand';
  var brandA = document.createElement('a');
  brandA.href = 'admin.html';
  brandA.setAttribute('aria-label', 'CivicSays dashboard home');
  var brandImg = document.createElement('img');
  brandImg.src = 'Logo.png';
  brandImg.alt = '';
  brandA.appendChild(brandImg);
  var brandSpan = document.createElement('span');
  brandSpan.textContent = 'CivicSays';
  brandA.appendChild(brandSpan);
  brand.appendChild(brandA);
  aside.appendChild(brand);

  // ---- Nav (Overview only — the per-ticket page is reached FROM Overview)
  var nav = document.createElement('nav');
  nav.className = 'admin-sidebar-nav';
  nav.setAttribute('aria-label', 'Sections');

  var group = document.createElement('div');
  group.className = 'admin-sidebar-group';
  var glbl = document.createElement('div');
  glbl.className = 'admin-sidebar-group-label';
  glbl.id = 'admin-nav-tickets-label-ticket';
  glbl.textContent = 'Tickets';
  group.appendChild(glbl);
  var ul = document.createElement('ul');
  ul.className = 'admin-sidebar-list';
  ul.setAttribute('aria-labelledby', 'admin-nav-tickets-label-ticket');

  var li = document.createElement('li');
  var backLink = document.createElement('a');
  backLink.className = 'admin-sidebar-link';
  backLink.href = 'admin.html';
  backLink.setAttribute('data-testid', 'nav-back-to-dashboard');
  backLink.appendChild(icon('layout', { size: 16 }));
  var backSpan = document.createElement('span');
  backSpan.textContent = 'All tickets';
  backLink.appendChild(backSpan);
  li.appendChild(backLink);
  ul.appendChild(li);
  group.appendChild(ul);
  nav.appendChild(group);
  aside.appendChild(nav);

  // ---- Account chip
  var account = document.createElement('div');
  account.className = 'admin-sidebar-account';
  account.id = 'admin-sidebar-account';
  account.setAttribute('data-testid', 'sidebar-account');
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
  out.addEventListener('click', async function () {
    try {
      await signOut();
      window.location.replace('login.html');
    } catch (err) {
      toast(friendlyError(err), 'error', 5000);
    }
  });
  account.appendChild(out);
  aside.appendChild(account);

  return aside;
}

function buildStaffHeader(official) {
  var header = document.createElement('header');
  header.className = 'admin-header';

  // Hamburger (hidden by default in CSS; revealed by the media query
  // at <= 900px).
  var menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'admin-header-menu';
  menuBtn.setAttribute('aria-label', 'Open navigation');
  menuBtn.setAttribute('aria-controls', 'admin-sidebar');
  menuBtn.setAttribute('data-testid', 'admin-menu-btn');
  menuBtn.hidden = true;
  menuBtn.appendChild(icon('menu', { size: 18 }));
  header.appendChild(menuBtn);

  // Search — same honest stub as the dashboard (filters are not wired,
  // but Enter produces a toast that explains the scope).
  var search = document.createElement('div');
  search.className = 'admin-header-search';
  search.appendChild(icon('search', { size: 16 }));
  var input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Search tickets, residents, or ID…';
  input.setAttribute('aria-label', 'Search tickets, residents, or ID');
  input.id = 'admin-search';
  input.setAttribute('data-testid', 'admin-search');
  input.autocomplete = 'off';
  search.appendChild(input);
  var kbd = document.createElement('kbd');
  kbd.className = 'kbd';
  kbd.textContent = 'Ctrl K';
  search.appendChild(kbd);
  header.appendChild(search);

  // Actions — bell + avatar
  var actions = document.createElement('div');
  actions.className = 'admin-header-actions';
  var bell = document.createElement('button');
  bell.type = 'button';
  bell.className = 'admin-header-bell';
  bell.setAttribute('aria-label', 'Notifications, 0 unread');
  bell.setAttribute('data-testid', 'admin-bell');
  bell.appendChild(icon('bell', { size: 16 }));
  var bellCount = document.createElement('span');
  bellCount.className = 'badge-count';
  bellCount.setAttribute('aria-hidden', 'true');
  bellCount.textContent = '0';
  bell.appendChild(bellCount);
  bell.addEventListener('click', function () {
    toast('No notifications yet. Staff changes will appear here.', 'info', 3000);
  });
  actions.appendChild(bell);
  var avatar = document.createElement('div');
  avatar.className = 'admin-header-avatar';
  avatar.id = 'admin-header-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = initialsOf(official.full_name);
  avatar.setAttribute('title', official.full_name || '');
  actions.appendChild(avatar);
  header.appendChild(actions);

  return header;
}

function mountStaffSidebar(official) {
  // Idempotent — never mount twice.
  if (state.staffSidebar) return;
  state.staffSidebar = true;

  // 1. Tell the body to use the admin shell layout (also hides the
  //    public navbar via the .has-admin-sidebar rule in layout.css).
  document.body.classList.add('has-admin-sidebar');

  // 2. Move the existing #ticket-region into a new .admin-shell > .admin-main
  //    structure, sitting between the sidebar and the right rail.
  var regionOld = document.getElementById('ticket-region');
  var mainOld = regionOld && regionOld.closest('.page-main');
  var pageMain = mainOld || (regionOld && regionOld.parentElement);
  if (!pageMain) return;

  // Detach the existing skeleton DOM so we can re-insert it.
  var skeletonChildren = [];
  if (regionOld) {
    while (regionOld.firstChild) {
      skeletonChildren.push(regionOld.firstChild);
      regionOld.removeChild(regionOld.firstChild);
    }
  }

  // Build shell — three columns: sidebar | main | right rail. The sidebar
  // is the first child so the grid places it on the left.
  var shell = document.createElement('div');
  shell.className = 'admin-shell';

  var sidebar = buildStaffSidebar(official);
  shell.appendChild(sidebar);

  var mainCol = document.createElement('div');
  mainCol.className = 'admin-main';
  mainCol.id = 'admin-main';
  mainCol.appendChild(buildStaffHeader(official));

  // Breadcrumb + page-title-style header for the ticket view
  var page = document.createElement('main');
  page.className = 'admin-page';
  var pageHeader = document.createElement('div');
  pageHeader.className = 'admin-page-header';
  var pageHeaderLeft = document.createElement('div');
  var crumb = document.createElement('a');
  crumb.href = 'admin.html';
  crumb.className = 'admin-breadcrumb';
  crumb.setAttribute('data-testid', 'back-to-dashboard');
  crumb.appendChild(icon('arrow-left', { size: 14 }));
  var crumbSpan = document.createElement('span');
  crumbSpan.textContent = 'Back to dashboard';
  crumb.appendChild(crumbSpan);
  pageHeaderLeft.appendChild(crumb);
  pageHeader.appendChild(pageHeaderLeft);
  page.appendChild(pageHeader);

  // Re-insert the ticket region (now empty / cleared) so JS continues
  // to use the same selector.
  if (regionOld) {
    // Re-append skeleton children for SSR fallback
    skeletonChildren.forEach(function (n) { regionOld.appendChild(n); });
    page.appendChild(regionOld);
  }
  mainCol.appendChild(page);
  shell.appendChild(mainCol);

  // 3. Mount the whole shell into the existing page-main (so it ends
  //    up nested correctly under body, in front of the now-hidden
  //    public navbar).
  pageMain.appendChild(shell);

  // 4. Hamburger wiring (same as admin.js)
  wireStaffHamburger();
  // 5. Ctrl+K focus
  wireStaffSearchShortcut();
}

function wireStaffHamburger() {
  var btn = document.querySelector('[data-testid="admin-menu-btn"]');
  var sidebar = document.getElementById('admin-sidebar');
  if (!btn || !sidebar) return;
  btn.hidden = false;

  // The .admin-sidebar-scrim is created lazily so we don't need to add
  // a new element to ticket.html just for staff.
  var scrim = document.getElementById('admin-sidebar-scrim');
  if (!scrim) {
    scrim = document.createElement('div');
    scrim.className = 'admin-sidebar-scrim';
    scrim.id = 'admin-sidebar-scrim';
    scrim.setAttribute('aria-hidden', 'true');
    document.body.appendChild(scrim);
  }

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

function wireStaffSearchShortcut() {
  document.addEventListener('keydown', function (e) {
    var k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'k') {
      e.preventDefault();
      var input = document.getElementById('admin-search');
      if (input) input.focus();
    }
  });
}

// -------------------------------------------------------------------------
// Status update UI — 3-dot "More" menu
//
// Replaces the previous <select> + button pair with a small menu that
// reads more like the rest of the app. The source of truth is still the
// same set of four statuses; we just let the official click them
// directly. A hidden <select> is also kept so the existing
// onStatusUpdate() handler is untouched — and the form is still
// accessible via keyboard (Enter on a row triggers the same handler).
// -------------------------------------------------------------------------

function buildStatusUpdater() {
  if (!state.official) return null;

  var wrap = document.createElement('div');
  wrap.className = 'status-update';
  wrap.setAttribute('data-testid', 'status-update');

  // The "primary" action is the next logical status (the one the official
  // is most likely to want). The menu surfaces all four.
  var current = state.ticket.status;
  var nextByStatus = {
    pending:    'in_process',
    in_process: 'solved',
    hold:       'in_process',
    solved:     'in_process',
  };
  var primary = nextByStatus[current] || 'in_process';
  var primaryLabel = primary === 'in_process' ? 'Move to In Process' :
                     primary === 'solved'    ? 'Mark as Solved' :
                     primary === 'hold'      ? 'Put on Hold' :
                     'Mark as Pending';

  var primaryBtn = document.createElement('button');
  primaryBtn.type = 'button';
  primaryBtn.className = 'btn btn-primary';
  primaryBtn.setAttribute('data-testid', 'status-primary');
  primaryBtn.appendChild(icon('arrow-right', { size: 14 }));
  var primarySpan = document.createElement('span');
  primarySpan.textContent = primaryLabel;
  primaryBtn.appendChild(primarySpan);
  primaryBtn.addEventListener('click', function () { onStatusUpdate(primary); });
  wrap.appendChild(primaryBtn);

  // Hidden <select> — kept for parity with existing onStatusUpdate() so
  // we don't have to refactor the RPC call.
  var sel = document.createElement('select');
  sel.className = 'select';
  sel.id = 'status-select';
  sel.setAttribute('aria-label', 'Change status');
  sel.style.position = 'absolute';
  sel.style.left = '-9999px';
  Object.keys(TICKET_STATUS_LABELS).forEach(function (k) {
    var opt = document.createElement('option');
    opt.value = k;
    opt.textContent = TICKET_STATUS_LABELS[k];
    if (k === state.ticket.status) opt.selected = true;
    sel.appendChild(opt);
  });
  wrap.appendChild(sel);

  // More (3-dot) menu
  var moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'btn btn-ghost icon-btn';
  moreBtn.setAttribute('aria-label', 'More status options');
  moreBtn.setAttribute('aria-haspopup', 'true');
  moreBtn.setAttribute('aria-expanded', 'false');
  moreBtn.setAttribute('data-testid', 'status-more');
  moreBtn.appendChild(icon('more', { size: 16 }));
  wrap.appendChild(moreBtn);

  // Menu content
  var menu = document.createElement('div');
  menu.className = 'status-update-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  menu.setAttribute('data-testid', 'status-menu');

  function menuItem(label, statusKey, key) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.className = 'status-update-menu-item';
    b.dataset.status = statusKey;
    b.dataset.key = key;
    b.textContent = label;
    if (statusKey === current) {
      b.classList.add('is-current');
      b.setAttribute('aria-disabled', 'true');
    }
    b.addEventListener('click', function () {
      closeMenu();
      if (statusKey !== current) onStatusUpdate(statusKey);
    });
    return b;
  }

  menu.appendChild(menuItem('Mark as pending', 'pending',    'p'));
  menu.appendChild(menuItem('Mark as in process', 'in_process', 'i'));
  menu.appendChild(menuItem('Mark as on hold', 'hold',       'h'));
  menu.appendChild(menuItem('Mark as solved', 'solved',     's'));
  wrap.appendChild(menu);

  moreBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (menu.hidden) openMenu(); else closeMenu();
  });

  function openMenu() {
    menu.hidden = false;
    moreBtn.setAttribute('aria-expanded', 'true');
    // Position the menu under the button (a popover-style menu).
    var rect = moreBtn.getBoundingClientRect();
    menu.style.position = 'absolute';
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    menu.style.left = 'auto';
    state.staffMenu = { menu: menu, moreBtn: moreBtn };
    // Outside-click + Escape close
    setTimeout(function () {
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onDocKey);
    }, 0);
  }
  function closeMenu() {
    menu.hidden = true;
    moreBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onDocKey);
    state.staffMenu = null;
  }
  function onDocClick(e) {
    if (state.staffMenu && !state.staffMenu.menu.contains(e.target) && e.target !== state.staffMenu.moreBtn) {
      closeMenu();
    }
  }
  function onDocKey(e) {
    if (e.key === 'Escape') { closeMenu(); state.staffMenu.moreBtn.focus(); }
  }

  return wrap;
}

/**
 * Status update handler — same as before but takes the target status
 * directly instead of reading from a <select>. The hidden <select> in
 * the new UI is kept in sync as a side-effect so any test that reads
 * #status-select still gets the right value.
 */
async function onStatusUpdate(newStatus) {
  if (state.statusPosting) return;
  if (newStatus === state.ticket.status) {
    toast('That is already the current status.', 'info', 1800);
    return;
  }
  state.statusPosting = true;
  // Keep hidden <select> in sync
  var sel = document.getElementById('status-select');
  if (sel) sel.value = newStatus;
  var busyBtn = document.querySelector('[data-testid="status-primary"]');
  var restore = busyBtn ? buttonBusy(busyBtn) : function () {};
  if (busyBtn) busyBtn.setAttribute('aria-busy', 'true');
  try {
    var c = await getClient();
    await unwrap(
      c.from(T.TICKETS).update({ status: newStatus }).eq('id', state.ticket.id)
    );
    // The DB trigger inserts a history row + a system comment. Realtime
    // channels will fire and re-render the header + comments thread.
    toast('Status updated to ' + ticketStatusLabel(newStatus), 'success', 1800);
  } catch (err) {
    toast(friendlyError(err), 'error', 6000);
  } finally {
    if (busyBtn) busyBtn.removeAttribute('aria-busy');
    restore();
    state.statusPosting = false;
  }
}

// -------------------------------------------------------------------------
// Comment submit
// -------------------------------------------------------------------------

async function onCommentSubmit(form, btn, ticket) {
  if (state.posting) return;
  state.posting = true;

  var bodyEl = form.querySelector('#c-body');
  var body = (bodyEl.value || '').trim();

  // ---------------------------------------------------------------------
  // Official branch — direct insert (RLS permits author_role='official').
  // The official's identity is derived server-side from auth.uid() and
  // current_official_name(); the client just supplies the body.
  // ---------------------------------------------------------------------
  if (state.official) {
    var firstInvalidOfficial = null;
    if (!body) {
      setFieldError('c-body', 'Please write something.');
      firstInvalidOfficial = bodyEl;
    } else if (body.length > MAX_COMMENT) {
      setFieldError('c-body', 'Comment is too long (max ' + MAX_COMMENT + ' characters).');
      firstInvalidOfficial = bodyEl;
    } else clearFieldError('c-body');

    if (firstInvalidOfficial) {
      firstInvalidOfficial.focus();
      state.posting = false;
      return;
    }

    btn.setAttribute('aria-busy', 'true');
    var restoreOff = buttonBusy(btn);
    try {
      var co = await getClient();
      await unwrap(
        co.from(T.TICKET_COMMENTS).insert({
          ticket_id: ticket.id,
          author_name: state.official.full_name,
          author_role: 'official',
          body: body,
        })
      );
      // Realtime channel will append the new comment — we don't insert
      // it manually.
      bodyEl.value = '';
      bodyEl.dispatchEvent(new Event('input'));
      toast('Official reply posted', 'success', 1800);
    } catch (err) {
      toast(friendlyError(err), 'error', 6000);
    } finally {
      btn.removeAttribute('aria-busy');
      restoreOff();
      state.posting = false;
    }
    return;
  }

  // ---------------------------------------------------------------------
  // Resident branch — verify name+phone against the ticket via the
  // post_resident_comment RPC.
  // ---------------------------------------------------------------------
  var nameEl = form.querySelector('#c-name');
  var phoneEl = form.querySelector('#c-phone');

  var name = (nameEl.value || '').trim();
  var phone = (phoneEl.value || '').replace(/\D/g, '');

  var firstInvalid = null;
  if (!name) { setFieldError('c-name', 'Please enter your name.'); firstInvalid = firstInvalid || nameEl; }
  else clearFieldError('c-name');
  if (!/^[0-9]{7,15}$/.test(phone)) {
    setFieldError('c-phone', 'Phone must be 7–15 digits.');
    firstInvalid = firstInvalid || phoneEl;
  } else clearFieldError('c-phone');
  if (!body) { setFieldError('c-body', 'Please write something.'); firstInvalid = firstInvalid || bodyEl; }
  else if (body.length > MAX_COMMENT) {
    setFieldError('c-body', 'Comment is too long (max ' + MAX_COMMENT + ' characters).');
    firstInvalid = firstInvalid || bodyEl;
  } else clearFieldError('c-body');

  if (firstInvalid) {
    firstInvalid.focus();
    state.posting = false;
    return;
  }

  btn.setAttribute('aria-busy', 'true');
  var restore = buttonBusy(btn);
  try {
    var c = await getClient();
    await c.rpc('post_resident_comment', {
      p_ticket_id: ticket.id,
      p_resident_name: name,
      p_resident_phone: phone,
      p_body: body,
    });
    // Success: cache identity and clear the form. The realtime channel
    // will append the new comment — we don't insert it manually.
    writeIdentity({ name: name, phone: phone });
    bodyEl.value = '';
    bodyEl.dispatchEvent(new Event('input'));
    toast('Comment posted', 'success', 1800);
  } catch (err) {
    // Server-side mismatch (42501): clear the cached phone so we don't
    // loop. Force a re-fill from the ticket row.
    var msg = friendlyError(err);
    if (/name and phone|do not match|42501/i.test(msg)) {
      setFieldError('c-phone', 'We couldn\'t verify your name and phone against this ticket. Please check and try again.');
      try { sessionStorage.removeItem(IDENTITY_KEY); } catch {}
      if (ticket.resident_name) nameEl.value = ticket.resident_name;
      if (ticket.resident_phone) phoneEl.value = ticket.resident_phone;
    } else {
      toast(msg, 'error', 6000);
    }
  } finally {
    btn.removeAttribute('aria-busy');
    restore();
    state.posting = false;
  }
}

// -------------------------------------------------------------------------
// Status update (official only) — the new menu-driven version is
// defined alongside the staff sidebar block further up in the file.
// -------------------------------------------------------------------------

// -------------------------------------------------------------------------
// Identity cache (sessionStorage, dies on tab close)
// -------------------------------------------------------------------------

function readIdentity() {
  try {
    var raw = sessionStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    var p = JSON.parse(raw);
    if (p && typeof p === 'object') return p;
  } catch {}
  return null;
}

function writeIdentity(p) {
  try { sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(p)); } catch {}
}

// -------------------------------------------------------------------------
// Field error helpers (small enough to inline)
// -------------------------------------------------------------------------

function setFieldError(id, message) {
  var errEl = document.getElementById('err-' + id);
  if (errEl) errEl.textContent = message;
  var input = document.getElementById(id);
  if (input) {
    var fieldEl = input.closest('.field');
    if (fieldEl) fieldEl.classList.add('invalid');
    input.setAttribute('aria-invalid', 'true');
  }
}

function clearFieldError(id) {
  var errEl = document.getElementById('err-' + id);
  if (errEl) errEl.textContent = '';
  var input = document.getElementById(id);
  if (input) {
    var fieldEl = input.closest('.field');
    if (fieldEl) fieldEl.classList.remove('invalid');
    input.removeAttribute('aria-invalid');
  }
}

// -------------------------------------------------------------------------
// URL + state screens
// -------------------------------------------------------------------------

function readIdFromQuery() {
  try {
    var p = new URLSearchParams(window.location.search);
    var raw = p.get('id');
    if (!raw) return null;
    return raw.trim().toUpperCase();
  } catch {
    return null;
  }
}

function showError(title, body) {
  if (!region) return;
  region.setAttribute('aria-busy', 'false');
  region.innerHTML = '';
  var el = document.createElement('div');
  el.className = 'notfound';
  el.appendChild(icon('alert', { size: 40 }));
  var t = document.createElement('div');
  t.className = 'notfound-title';
  t.textContent = title;
  el.appendChild(t);
  var s = document.createElement('p');
  s.className = 'notfound-text';
  s.textContent = body;
  el.appendChild(s);
  var a = document.createElement('a');
  a.className = 'btn btn-primary';
  a.href = 'track.html';
  a.appendChild(icon('search', { size: 14 }));
  var aLabel = document.createElement('span');
  aLabel.textContent = 'Back to tracking';
  a.appendChild(aLabel);
  el.appendChild(a);
  region.appendChild(el);
}

function show404() {
  showError(
    'Ticket not found',
    'We couldn\'t find a ticket with that ID. Double-check the format (CIV-XXXXXX) and try again.'
  );
}

// -------------------------------------------------------------------------
// Cleanup (realtime) — wired to pagehide for tab-close + bfcache safety.
// -------------------------------------------------------------------------

window.addEventListener('pagehide', function () {
  state.teardown.forEach(function (fn) {
    try { fn(); } catch {}
  });
  state.teardown = [];
});
